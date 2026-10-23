import { diffArrays } from 'diff';
import type { Claim, FileChange, Finding, RuleId, Severity, Step } from '../types';
import { secretKinds } from '../redact';
import { basename, isDocFile, isTestFile, oneLine, splitLines, truncate } from '../util';
import { isVerify, masksExitCode, outputLooksFailed } from './commands';

// Deterministic review rules. Each one looks at the normalized steps and the
// reconstructed files and returns plain-language findings linked to steps.

export interface RuleContext {
  steps: Step[];
  files: FileChange[];
  claims: Claim[];
  readBefore: (stepId: number) => Set<string>;
}

type Rule = (ctx: RuleContext) => Omit<Finding, 'id'>[];

const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
const stepRef = (id: number) => `step ${id + 1}`;

/** Lines removed and added by one edit step. */
export function lineDelta(s: Step): { added: string[]; removed: string[] } {
  const e = s.edit;
  if (!e) return { added: [], removed: [] };
  if (e.edits?.length) {
    const added: string[] = [];
    const removed: string[] = [];
    for (const ed of e.edits) {
      const a = splitLines(ed.oldString);
      const b = splitLines(ed.newString);
      for (const ch of diffArrays(a, b)) {
        if (ch.added) added.push(...ch.value);
        else if (ch.removed) removed.push(...ch.value);
      }
    }
    return { added, removed };
  }
  if (e.patch) {
    const added: string[] = [];
    const removed: string[] = [];
    for (const l of e.patch.split('\n')) {
      if (l.startsWith('+++') || l.startsWith('---')) continue;
      if (l.startsWith('+')) added.push(l.slice(1));
      else if (l.startsWith('-')) removed.push(l.slice(1));
    }
    return { added, removed };
  }
  if (e.after !== undefined) {
    const before = e.before !== undefined ? splitLines(e.before) : [];
    const added: string[] = [];
    const removed: string[] = [];
    for (const ch of diffArrays(before, splitLines(e.after))) {
      if (ch.added) added.push(...ch.value);
      else if (ch.removed) removed.push(...ch.value);
    }
    return { added, removed };
  }
  return { added: [], removed: [] };
}

// ------------------------------------------------------------ weakened tests

const ASSERT = /\b(expect|assert\w*|should\.|t\.(is|deepEqual|equal|true|false|throws)|require\.\w+|XCTAssert\w*)\b|\bassert\s/;
const SKIP = /\.(skip|todo)\s*\(|\bx(it|describe|test)\s*\(|@pytest\.mark\.(skip|xfail)|@unittest\.skip|\bt\.Skip\(|#\[ignore\]|@Disabled\b|@Ignore\b|\.only\s*\(/;
const STRICT = /\.(toBe|toEqual|toStrictEqual|toHaveLength|toThrow\(\s*['"`/])\s*\(|assertEqual|assert_eq!|assert\s+[^=]+==/;
const LOOSE = /\.(toBeTruthy|toBeDefined|toBeGreaterThan(OrEqual)?|toBeLessThan(OrEqual)?|toBeCloseTo|toContain|toMatch|toBeInstanceOf|toHaveBeenCalled)\s*\(|assertTrue|assertIsNotNone|assert\s+\w+\s*$|\bnot\.toThrow|pytest\.approx/;
const TEST_CASE = /\b(it|test)\s*\(\s*['"`]|\bdef test_\w+|\bfunc Test\w+|#\[test\]/;
const LITERAL = /(-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|`[^`]*`|\btrue\b|\bfalse\b|\bnull\b|\bNone\b)/g;

function skeleton(line: string): string {
  return line.replace(LITERAL, '§').replace(/\s+/g, '');
}

const weakenedTests: Rule = ({ steps, files }) => {
  const out: Omit<Finding, 'id'>[] = [];
  const createdHere = new Set(files.filter((f) => f.created).map((f) => f.path));
  const byFile = new Map<string, { steps: number[]; signals: string[]; afterFailure: boolean }>();

  let lastTestFailed = false;
  for (const s of steps) {
    if (s.command && s.command.categories.includes('test')) {
      lastTestFailed = s.command.failed || outputLooksFailed(s.command.output);
      continue;
    }
    if (!s.edit || !isTestFile(s.edit.path) || createdHere.has(s.edit.path)) continue;
    const { added, removed } = lineDelta(s);
    const signals: string[] = [];

    const skipsAdded = added.filter((l) => SKIP.test(l)).length - removed.filter((l) => SKIP.test(l)).length;
    if (skipsAdded > 0) signals.push(`added ${plural(skipsAdded, 'skip/only marker')}`);

    const aRemoved = removed.filter((l) => ASSERT.test(l)).length;
    const aAdded = added.filter((l) => ASSERT.test(l)).length;
    if (aRemoved > aAdded) signals.push(`removed ${plural(aRemoved - aAdded, 'assertion')}`);

    const casesRemoved = removed.filter((l) => TEST_CASE.test(l)).length - added.filter((l) => TEST_CASE.test(l)).length;
    if (casesRemoved > 0) signals.push(`deleted ${plural(casesRemoved, 'test case')}`);

    // Pair up assertion lines that kept their shape but changed expected values or got looser.
    const remA = removed.filter((l) => ASSERT.test(l));
    const addA = added.filter((l) => ASSERT.test(l));
    for (const r of remA) {
      const twin = addA.find((a) => skeleton(a) === skeleton(r) && a.trim() !== r.trim());
      if (twin) {
        const rv = [...r.matchAll(LITERAL)].map((m) => m[0]);
        const av = [...twin.matchAll(LITERAL)].map((m) => m[0]);
        const diffAt = rv.findIndex((v, i) => v !== av[i]);
        if (diffAt >= 0) signals.push(`changed an expected value from ${truncate(rv[diffAt], 30)} to ${truncate(av[diffAt] ?? '?', 30)}`);
        continue;
      }
      if (STRICT.test(r) && addA.some((a) => LOOSE.test(a) && !STRICT.test(a))) signals.push('replaced an exact check with a looser one');
    }

    if (!signals.length) continue;
    const entry = byFile.get(s.edit.path) ?? { steps: [], signals: [], afterFailure: false };
    entry.steps.push(s.id);
    for (const sig of signals) if (!entry.signals.includes(sig)) entry.signals.push(sig);
    entry.afterFailure ||= lastTestFailed;
    byFile.set(s.edit.path, entry);
  }

  for (const [path, e] of byFile) {
    out.push({
      rule: 'weakened-tests',
      severity: e.afterFailure ? 'high' : 'medium',
      title: `Tests in ${basename(path)} were weakened`,
      detail: `The agent ${e.signals.join('; ')} in ${path}${e.afterFailure ? ', right after a failing test run. The tests may now pass because they check less, not because the code is right.' : '.'}`,
      steps: e.steps,
      files: [path],
    });
  }
  return out;
};

// ------------------------------------------------------------ claims

const claimFindings: Rule = ({ claims }) =>
  claims
    .filter((c) => c.verdict !== 'supported')
    .filter((c) => c.verdict !== 'unverified' || c.kind !== 'only-changed')
    .map((c) => {
      const sev: Severity = c.verdict === 'contradicted' ? 'high' : c.verdict === 'stale' ? 'medium' : c.kind === 'fixed' ? 'low' : 'medium';
      const label = c.verdict === 'contradicted' ? 'Claim contradicted by the log' : c.verdict === 'stale' ? 'Claim based on an old result' : 'Claim never verified';
      return {
        rule: 'contradicted-claim' as RuleId,
        severity: sev,
        title: `${label}: “${truncate(c.text, 70)}”`,
        detail: c.explanation,
        steps: [c.step, ...c.evidence],
        files: [],
      };
    });

// ------------------------------------------------------------ blind edits

const norm = (p: string) => p.replace(/^\.\//, '').toLowerCase();

const blindEdit: Rule = ({ steps, files, readBefore }) => {
  const out: Omit<Finding, 'id'>[] = [];
  for (const f of files) {
    if (f.created) continue;
    // Absolute paths are outside the project (scratch files, temp dirs).
    if (/^([a-zA-Z]:)?\//.test(f.path)) continue;
    const firstEdit = steps[f.edits[0]];
    if (!firstEdit?.edit || firstEdit.edit.op === 'create') continue;
    const seen = readBefore(firstEdit.id);
    const target = norm(f.path);
    const wasRead = [...seen].some((p) => norm(p) === target || norm(p).endsWith('/' + target) || target.endsWith('/' + norm(p)));
    if (wasRead) continue;
    out.push({
      rule: 'blind-edit',
      severity: 'medium',
      title: `Edited ${basename(f.path)} without reading it first`,
      detail: `${f.path} was changed at ${stepRef(firstEdit.id)} but the agent never opened it earlier in the run, so it was editing from assumptions about its contents.`,
      steps: [firstEdit.id],
      files: [f.path],
    });
  }
  return out;
};

// ------------------------------------------------------------ failure loops

const failureLoop: Rule = ({ steps }) => {
  const out: Omit<Finding, 'id'>[] = [];
  const groups = new Map<string, number[]>();
  for (const s of steps) {
    if (!s.command || !s.command.failed) continue;
    const key = oneLine(s.command.cmd).replace(/\s*\|\s*(tail|head)\b.*$/, '').replace(/\s*2>&1\s*/g, ' ').trim();
    const list = groups.get(key) ?? [];
    list.push(s.id);
    groups.set(key, list);
  }
  for (const [cmd, ids] of groups) {
    if (ids.length < 3) continue;
    out.push({
      rule: 'failure-loop',
      severity: 'medium',
      title: `Same command failed ${ids.length} times`,
      detail: `\`${truncate(cmd, 100)}\` failed ${ids.length} times (${ids.map((i) => stepRef(i)).join(', ')}). Repeated retries usually mean the agent was guessing.`,
      steps: ids,
      files: [],
    });
  }
  // Consecutive failing test runs, even with different commands.
  let streak: number[] = [];
  const flush = () => {
    if (streak.length >= 3 && !out.some((f) => f.steps.join() === streak.join())) {
      out.push({
        rule: 'failure-loop',
        severity: 'medium',
        title: `Tests failed ${streak.length} times in a row`,
        detail: `Test runs at ${streak.map(stepRef).join(', ')} all failed before anything passed.`,
        steps: [...streak],
        files: [],
      });
    }
    streak = [];
  };
  for (const s of steps) {
    if (!s.command?.categories.includes('test')) continue;
    if (s.command.failed || outputLooksFailed(s.command.output)) streak.push(s.id);
    else flush();
  }
  flush();
  return out;
};

// ------------------------------------------------------------ silenced errors

const SILENCERS: [RegExp, string][] = [
  [/@ts-(ignore|nocheck)\b/, '@ts-ignore'],
  [/@ts-expect-error\b/, '@ts-expect-error'],
  [/eslint-disable/, 'eslint-disable'],
  [/#\s*type:\s*ignore/, '# type: ignore'],
  [/#\s*noqa\b/, '# noqa'],
  [/#\s*pylint:\s*disable/, 'pylint: disable'],
  [/\bexcept(\s+\w+(\s+as\s+\w+)?)?\s*:\s*pass\b/, 'except: pass'],
  [/\bcatch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/, 'empty catch'],
  [/\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|null|undefined)\s*\)/, 'swallowed promise error'],
  [/\bas\s+any\b/, '`as any`'],
  [/:\s*any\b/, '`any` type'],
  [/\/\/\s*nolint/, 'nolint'],
  [/#\[allow\(/, '#[allow]'],
  [/@SuppressWarnings/, '@SuppressWarnings'],
  [/continue-on-error:\s*true/, 'continue-on-error'],
  [/--passWithNoTests/, '--passWithNoTests'],
];

const silencedErrors: Rule = ({ steps }) => {
  const byFile = new Map<string, { steps: Set<number>; kinds: Set<string> }>();
  for (const s of steps) {
    if (!s.edit) continue;
    const { added, removed } = lineDelta(s);
    for (const [re, label] of SILENCERS) {
      const n = added.filter((l) => re.test(l)).length - removed.filter((l) => re.test(l)).length;
      if (n > 0) {
        const e = byFile.get(s.edit.path) ?? { steps: new Set(), kinds: new Set() };
        e.steps.add(s.id);
        e.kinds.add(label);
        byFile.set(s.edit.path, e);
      }
    }
    // Python: "except ...:" followed by "pass" on the next line.
    for (let i = 0; i < added.length - 1; i++) {
      if (/^\s*except\b.*:\s*$/.test(added[i]) && /^\s*pass\s*$/.test(added[i + 1])) {
        const e = byFile.get(s.edit.path) ?? { steps: new Set(), kinds: new Set() };
        e.steps.add(s.id);
        e.kinds.add('except: pass');
        byFile.set(s.edit.path, e);
      }
    }
  }
  return [...byFile].map(([path, e]) => ({
    rule: 'silenced-errors' as RuleId,
    severity: 'medium' as Severity,
    title: `Errors silenced in ${basename(path)}`,
    detail: `Added ${[...e.kinds].join(', ')} in ${path}. These make warnings or failures disappear without fixing them.`,
    steps: [...e.steps],
    files: [path],
  }));
};

// ------------------------------------------------------------ risky commands

const RISKY: [RegExp, Severity, string][] = [
  [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b\s+(\/|~|\*|\$HOME|\.\s*$)/, 'high', 'deleted a broad path recursively'],
  [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/, 'medium', 'force-deleted files recursively'],
  [/\bRemove-Item\b[^|;]*-Recurse\b[^|;]*-Force|\bRemove-Item\b[^|;]*-Force\b[^|;]*-Recurse/i, 'medium', 'force-deleted files recursively'],
  [/\bgit\s+push\b[^|;&]*(\s--force\b|\s-f\b|--force-with-lease)/, 'high', 'force-pushed'],
  [/\bgit\s+reset\s+--hard\b/, 'high', 'hard-reset the working tree'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'medium', 'deleted untracked files'],
  [/\bgit\s+checkout\s+(--\s+)?\.(\s|$)|\bgit\s+restore\s+\.(\s|$)/, 'medium', 'discarded local changes'],
  [/--no-verify\b/, 'medium', 'skipped git hooks'],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\biwr\b[^|]*\|\s*iex\b|Invoke-Expression/i, 'high', 'piped a download straight into a shell'],
  [/\bchmod\s+(-R\s+)?777\b/, 'medium', 'made files world-writable'],
  [/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b|\bTRUNCATE\s+TABLE\b/i, 'high', 'dropped database objects'],
  [/\bsudo\b/, 'medium', 'used sudo'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo publish\b|\btwine upload\b/, 'high', 'published a package'],
  [/\bgit\s+push\b/, 'low', 'pushed to a remote'],
  [/\bkubectl\s+(delete|apply)\b|\bterraform\s+(apply|destroy)\b/, 'high', 'changed live infrastructure'],
];

const riskyCommand: Rule = ({ steps }) => {
  const out: Omit<Finding, 'id'>[] = [];
  for (const s of steps) {
    if (!s.command) continue;
    const cmd = s.command.cmd;
    const hit = RISKY.find(([re]) => re.test(cmd));
    if (!hit) continue;
    out.push({
      rule: 'risky-command',
      severity: hit[1],
      title: `Agent ${hit[2]}`,
      detail: `${cap(stepRef(s.id))} ran \`${truncate(oneLine(cmd), 120)}\`${s.command.failed ? ' (it failed)' : ''}.`,
      steps: [s.id],
      files: [],
    });
  }
  return out;
};

// ------------------------------------------------------------ secrets

const secretExposure: Rule = ({ steps }) => {
  const out: Omit<Finding, 'id'>[] = [];
  const seen = new Map<string, number[]>();
  const written: { step: number; path: string; kinds: string[] }[] = [];
  for (const s of steps) {
    if (s.edit) {
      const { added } = lineDelta(s);
      const kinds = secretKinds(added.join('\n') + (s.edit.after ?? ''));
      if (kinds.length && !isDocFile(s.edit.path)) written.push({ step: s.id, path: s.edit.path, kinds });
    }
    const texts = [s.command?.cmd, s.command?.output, s.read?.content, s.output, s.search?.output, s.text];
    for (const k of secretKinds(texts.filter(Boolean).join('\n'))) {
      const list = seen.get(k) ?? [];
      list.push(s.id);
      seen.set(k, list);
    }
  }
  for (const w of written) {
    out.push({
      rule: 'secret-exposure',
      severity: 'high',
      title: `Credential written into ${basename(w.path)}`,
      detail: `${cap(stepRef(w.step))} put what looks like a ${w.kinds.join(', ')} into ${w.path}. It is masked here.`,
      steps: [w.step],
      files: [w.path],
    });
  }
  for (const [kind, ids] of seen) {
    const uniq = [...new Set(ids)];
    out.push({
      rule: 'secret-exposure',
      severity: 'high',
      title: `A ${kind.replace(/-/g, ' ')} appeared in the run`,
      detail: `It shows up in ${uniq.slice(0, 5).map(stepRef).join(', ')}${uniq.length > 5 ? ' and more' : ''}. It is masked in this view and in exports, but it was in the agent's context. Consider rotating it.`,
      steps: uniq,
      files: [],
    });
  }
  return out;
};

// ------------------------------------------------------------ dependencies

const MANIFEST = /(^|\/)(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|Cargo\.toml|go\.mod|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/;

function depNames(path: string, lines: string[]): string[] {
  const names: string[] = [];
  for (const l of lines) {
    let m: RegExpMatchArray | null = null;
    if (/package\.json$|composer\.json$/.test(path)) m = l.match(/^\s*"(@?[\w./-]+)"\s*:\s*"[\^~><=*]?\s*[\dx*]/);
    else if (/requirements|Pipfile/.test(path)) m = l.match(/^\s*([A-Za-z][\w.-]*)\s*([<>=~!]=?|$)/);
    else if (/pyproject\.toml$/.test(path)) m = l.match(/^\s*"([A-Za-z][\w.-]*)\s*[<>=~!]/) ?? l.match(/^\s*([A-Za-z][\w.-]*)\s*=\s*["{]/);
    else if (/Cargo\.toml$/.test(path)) m = l.match(/^\s*([A-Za-z][\w-]*)\s*=\s*["{]/);
    else if (/go\.mod$/.test(path)) m = l.match(/^\s*(?:require\s+)?([\w.-]+\/[\w./-]+)\s+v\d/);
    else if (/Gemfile$/.test(path)) m = l.match(/^\s*gem\s+['"]([\w-]+)/);
    if (m && !/^(name|version|description|main|type|scripts|license|private|edition|module|go)$/.test(m[1])) names.push(m[1]);
  }
  return names;
}

const newDependency: Rule = ({ steps }) => {
  const out: Omit<Finding, 'id'>[] = [];
  const added = new Map<string, number[]>();
  const files = new Set<string>();
  for (const s of steps) {
    if (s.edit && MANIFEST.test(s.edit.path)) {
      const d = lineDelta(s);
      const before = new Set(depNames(s.edit.path, d.removed));
      for (const n of depNames(s.edit.path, d.added)) {
        if (before.has(n)) continue;
        added.set(n, [...(added.get(n) ?? []), s.id]);
        files.add(s.edit.path);
      }
    }
    if (s.command?.categories.includes('install') && !s.command.failed) {
      const m = s.command.cmd.match(/\b(?:npm|pnpm|bun)\s+(?:install|i|add)\s+(.+)|\byarn add\s+(.+)|\bpip3?\s+install\s+(.+)|\buv add\s+(.+)|\bcargo add\s+(.+)|\bpoetry add\s+(.+)/);
      const list = m ? (m.slice(1).find(Boolean) ?? '') : '';
      for (const tok of list.split(/\s+/)) {
        if (!tok || tok.startsWith('-') || /^[&|;]/.test(tok)) {
          if (/^[&|;]/.test(tok)) break;
          continue;
        }
        const name = tok.replace(/@[\^~]?[\d.x*]+.*$/, '').replace(/[<>=~!].*$/, '');
        if (name) added.set(name, [...(added.get(name) ?? []), s.id]);
      }
    }
  }
  if (added.size) {
    const names = [...added.keys()];
    out.push({
      rule: 'new-dependency',
      severity: 'low',
      title: `Added ${plural(names.length, 'dependency', 'dependencies')}`,
      detail: `New: ${names.slice(0, 12).join(', ')}${names.length > 12 ? '…' : ''}. Worth checking each is needed, maintained and licensed for you.`,
      steps: [...new Set([...added.values()].flat())],
      files: [...files],
    });
  }
  return out;
};

// ------------------------------------------------------------ churn

const churn: Rule = ({ files }) => {
  const out: Omit<Finding, 'id'>[] = [];
  for (const f of files) {
    if (f.churned >= 8 && f.churned >= 0.25 * Math.max(1, f.added + f.churned)) {
      out.push({
        rule: 'churn',
        severity: 'low',
        title: `Rewrote its own changes in ${basename(f.path)}`,
        detail: `${plural(f.churned, 'line')} the agent wrote in ${f.path} were later removed again by the agent across ${plural(f.edits.length, 'edit')}. Churn often means trial and error.`,
        steps: f.edits,
        files: [f.path],
      });
    } else if (f.edits.length >= 6) {
      out.push({
        rule: 'churn',
        severity: 'low',
        title: `Edited ${basename(f.path)} ${f.edits.length} times`,
        detail: `${f.path} was changed in ${f.edits.length} separate steps.`,
        steps: f.edits,
        files: [f.path],
      });
    }
  }
  return out;
};

// ------------------------------------------------------------ unverified finish

const unverifiedFinish: Rule = ({ steps }) => {
  const codeEdits = steps.filter((s) => s.edit && !isDocFile(s.edit.path));
  if (!codeEdits.length) return [];
  const last = codeEdits[codeEdits.length - 1];
  const after = steps.filter((s) => s.id > last.id && s.command && isVerify(s.command.categories));
  if (after.length) return [];
  const everVerified = steps.some((s) => s.command && isVerify(s.command.categories));
  return [
    {
      rule: 'unverified-finish',
      severity: 'medium',
      title: 'Finished without checking the final change',
      detail: everVerified
        ? `The last code change (${stepRef(last.id)}, ${last.edit!.path}) was never followed by a test, build, type check or lint run.`
        : 'Code changed, but no tests, build, type check or lint ran at any point in this run.',
      steps: [last.id],
      files: [last.edit!.path],
    },
  ];
};

// ------------------------------------------------------------ sensitive files

const SENSITIVE: [RegExp, Severity, string][] = [
  [/(^|\/)\.github\/workflows\/|\.gitlab-ci\.ya?ml$|(^|\/)Jenkinsfile$|azure-pipelines|\.circleci\//, 'medium', 'CI configuration'],
  [/(^|\/)\.env(\.|$)/, 'medium', 'environment file'],
  [/(^|\/)(migrations?|migrate)\//, 'medium', 'database migration'],
  [/(^|\/)[^/]*(auth|security|permission|password|crypto|oauth|session|login)[^/]*$/i, 'medium', 'security-related code'],
  [/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|uv\.lock)$/, 'low', 'lockfile'],
  [/(^|\/)(Dockerfile|docker-compose\.ya?ml|\.npmrc|\.pypirc)$|\.tf$/, 'low', 'build/infra config'],
];

const sensitiveFiles: Rule = ({ files }) => {
  const hits = new Map<string, { sev: Severity; paths: string[]; steps: number[] }>();
  for (const f of files) {
    const hit = SENSITIVE.find(([re]) => re.test(f.path));
    if (!hit) continue;
    const e = hits.get(hit[2]) ?? { sev: hit[1], paths: [], steps: [] };
    e.paths.push(f.path);
    e.steps.push(...f.edits);
    hits.set(hit[2], e);
  }
  return [...hits].map(([label, e]) => ({
    rule: 'sensitive-files' as RuleId,
    severity: e.sev,
    title: `Changed ${label}`,
    detail: `${e.paths.join(', ')} ${e.paths.length === 1 ? 'deserves' : 'deserve'} a careful look: changes here have effects beyond the task.`,
    steps: e.steps,
    files: e.paths,
  }));
};

// ------------------------------------------------------------ masked exit codes

const maskedExit: Rule = ({ steps }) => {
  const out: Omit<Finding, 'id'>[] = [];
  for (const s of steps) {
    if (!s.command || !isVerify(s.command.categories) || !masksExitCode(s.command.cmd)) continue;
    const hidden = !s.command.failed && outputLooksFailed(s.command.output);
    out.push({
      rule: 'masked-exit-code',
      severity: hidden ? 'high' : 'low',
      title: hidden ? 'A failing check looked like a pass' : 'Check result piped through another command',
      detail: hidden
        ? `${cap(stepRef(s.id))} ran \`${truncate(oneLine(s.command.cmd), 100)}\`. The output reports failures, but the pipe hid the exit code, so the run looked successful.`
        : `${cap(stepRef(s.id))} ran \`${truncate(oneLine(s.command.cmd), 100)}\`. Piping hides the real exit code; the agent only saw part of the output.`,
      steps: [s.id],
      files: [],
    });
  }
  return out;
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const RULES: Record<RuleId, Rule> = {
  'weakened-tests': weakenedTests,
  'contradicted-claim': claimFindings,
  'blind-edit': blindEdit,
  'failure-loop': failureLoop,
  'silenced-errors': silencedErrors,
  'risky-command': riskyCommand,
  'secret-exposure': secretExposure,
  'new-dependency': newDependency,
  churn,
  'unverified-finish': unverifiedFinish,
  'sensitive-files': sensitiveFiles,
  'masked-exit-code': maskedExit,
};

export const RULE_INFO: Record<RuleId, { name: string; why: string }> = {
  'weakened-tests': { name: 'Weakened tests', why: 'Tests that check less can pass without the code being right.' },
  'contradicted-claim': { name: 'Claim check', why: 'What the agent said about its work does not match what ran.' },
  'blind-edit': { name: 'Blind edit', why: 'Editing a file it never read means it guessed at the contents.' },
  'failure-loop': { name: 'Failure loop', why: 'Retrying the same failing thing is a sign of guessing.' },
  'silenced-errors': { name: 'Silenced errors', why: 'Suppressing a warning hides the problem instead of fixing it.' },
  'risky-command': { name: 'Risky command', why: 'Commands with effects outside the task or hard to undo.' },
  'secret-exposure': { name: 'Secret exposure', why: 'Credentials in the agent context or written to files.' },
  'new-dependency': { name: 'New dependency', why: 'Every package added is code you now maintain and trust.' },
  churn: { name: 'Churn', why: 'Writing and rewriting the same code is trial and error.' },
  'unverified-finish': { name: 'Unverified finish', why: 'The final state was never tested or built.' },
  'sensitive-files': { name: 'Sensitive files', why: 'Changes to CI, auth, env or migrations reach beyond the task.' },
  'masked-exit-code': { name: 'Masked exit code', why: 'A pipe can make a failing check look like it passed.' },
};

export function runRules(ctx: RuleContext): Finding[] {
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const all: Omit<Finding, 'id'>[] = [];
  for (const rule of Object.values(RULES)) all.push(...rule(ctx));
  return all
    .sort((a, b) => order[a.severity] - order[b.severity] || (a.steps[0] ?? 0) - (b.steps[0] ?? 0))
    .map((f, i) => ({ ...f, id: `f${i}`, steps: [...new Set(f.steps)].sort((a, b) => a - b) }));
}
