import type { Claim, ClaimKind, CommandCategory, FileChange, Step } from '../types';
import { basename, isDocFile, isTestFile, truncate } from '../util';
import { failureHeadline, isVerify, outputLooksFailed, partialTestFilter } from './commands';

// Fact-checks what the agent said at the end of each turn against what the log shows.
// Claims are found with patterns, not a model, so every verdict is reproducible.

interface Pattern {
  kind: ClaimKind;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { kind: 'tests-pass', re: /\b(?:all\s+)?(?:the\s+)?(?:\d+\s+)?(?:unit\s+|e2e\s+|integration\s+)?(?:tests?|test suite|specs?)\b[^.;\n]{0,60}?\b(?:pass(?:es|ing|ed)?|green|succeed(?:s|ed)?|are ok|all ok)\b/i },
  { kind: 'tests-pass', re: /\b\d+\s*(?:\/\s*\d+\s*)?(?:tests?\s+)?passed\b|\bpassing tests?\b|\btests? (?:are|is) (?:now )?(?:passing|green)\b/i },
  { kind: 'build-pass', re: /\b(?:the\s+)?(?:build|compil(?:e|es|ation))\b[^.;\n]{0,40}?\b(?:pass(?:es)?|succeed(?:s|ed)?|works|clean(?:ly)?|green|successful(?:ly)?|is fine)\b|\bbuilds (?:cleanly|successfully|fine)\b|\bcompiles (?:cleanly|successfully|fine|without errors)\b/i },
  { kind: 'typecheck-pass', re: /\b(?:type-?check(?:s|ing|er)?|tsc|mypy|pyright|types?)\b[^.;\n]{0,40}?\b(?:pass(?:es)?|clean|no (?:type )?errors|succeeds?)\b/i },
  { kind: 'lint-pass', re: /\blint(?:s|ing|er)?\b[^.;\n]{0,40}?\b(?:pass(?:es)?|clean|no (?:errors|warnings|issues))\b/i },
  { kind: 'no-test-changes', re: /\b(?:did\s*n['’]?t|did not|without|no(?:t)?)\s+(?:change|modify|touch|edit|alter)(?:ing|ed)?\s+(?:any\s+)?(?:of\s+)?(?:the\s+)?(?:existing\s+)?tests?\b|\btests? (?:are|were) (?:left )?unchanged\b/i },
  { kind: 'only-changed', re: /\bonly\s+(?:changed|modified|touched|edited|updated)\s+(.+)$/i },
  {
    kind: 'fixed',
    re: /\b(?:I|I['’]ve|I have|we|we['’]ve|we have)\s+(?:now\s+)?(?:fixed|resolved|solved)\b|\b(?:is|are|was|were|has been|have been|now)\s+(?:fixed|resolved)\b|^(?:Fixed|Resolved)\b(?!\s*:)|\bnow (?:works|passes|returns|handles|rounds)\b/i,
  },
];

const NEGATION = /(?:\b(?:not|unable|cannot|still fail(?:s|ing)?|fail(?:ed|s|ing)?|broken|except)\b|n['’]t\b)/i;
// Noun phrases like "the previously failing tests" describe what was fixed, not a failure.
const FAILING_NOUN = /\b(?:(?:previously|formerly|originally|the|a|two|three|\d+|all)\s+)?(?:failing|broken|flaky)\s+(?:tests?|specs?|cases?|checks?|builds?)\b/gi;

export function sentencesOf(text: string): string[] {
  const noCode = text.replace(/```[\s\S]*?```/g, ' ');
  const out: string[] = [];
  for (const rawLine of noCode.split(/\n+/)) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/[*_#>]+/g, '').trim();
    if (!line) continue;
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z`"'(])/)) {
      const t = s.trim();
      if (t.length > 3) out.push(t);
    }
  }
  return out;
}

export function findClaimsInText(text: string): { kind: ClaimKind; sentence: string; match: RegExpMatchArray }[] {
  const found: { kind: ClaimKind; sentence: string; match: RegExpMatchArray }[] = [];
  for (const sentence of sentencesOf(text)) {
    if (sentence.endsWith('?') || sentence.endsWith(':')) continue;
    if (/\bbeing (fixed|resolved)\b|\b(will|to|should|can|could|would|let me|i['’]ll|going to|need to|make sure)\s+(\w+\s+){0,4}(fix|run|pass)\b/i.test(sentence)) continue;
    const kinds = new Set<ClaimKind>();
    for (const p of PATTERNS) {
      const m = sentence.match(p.re);
      if (!m) continue;
      if (kinds.has(p.kind)) continue;
      const cleaned = sentence.replace(/\b0\s+(failed|failing|failures|errors)\b/gi, '').replace(FAILING_NOUN, ' tests ');
      if (p.kind !== 'no-test-changes' && p.kind !== 'only-changed' && NEGATION.test(cleaned)) continue;
      if (p.kind === 'fixed' && (kinds.has('tests-pass') || kinds.has('build-pass'))) continue;
      if (p.kind === 'only-changed' && !extractFileRefs(m[1] ?? '').length) continue;
      kinds.add(p.kind);
      found.push({ kind: p.kind, sentence, match: m });
    }
  }
  return found;
}

/** Messages that summarize a turn: those after the turn's last action. */
export function summaryMessages(steps: Step[]): Step[] {
  const byTurn = new Map<number, Step[]>();
  for (const s of steps) {
    const list = byTurn.get(s.turn) ?? [];
    list.push(s);
    byTurn.set(s.turn, list);
  }
  const out: Step[] = [];
  for (const list of byTurn.values()) {
    let lastAction = -1;
    list.forEach((s, i) => {
      if (s.kind !== 'message' && s.kind !== 'thinking' && s.kind !== 'prompt') lastAction = i;
    });
    if (lastAction < 0) continue; // a turn with no actions makes no checkable claims
    for (const s of list.slice(lastAction + 1)) if (s.kind === 'message' && s.actor !== 'subagent') out.push(s);
  }
  return out;
}

export function checkClaims(steps: Step[], files: FileChange[]): Claim[] {
  const claims: Claim[] = [];
  const msgs = summaryMessages(steps);
  const seen = new Set<string>();
  for (const m of msgs) {
    for (const f of findClaimsInText(m.text ?? '')) {
      const key = `${m.turn}|${f.kind}|${f.sentence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const verdict = evaluate(f.kind, f.match, m.id, steps, files);
      claims.push({
        id: `c${claims.length}`,
        kind: f.kind,
        text: truncate(f.sentence, 240),
        step: m.id,
        ...verdict,
      });
    }
  }
  return claims;
}

const CATEGORY: Partial<Record<ClaimKind, CommandCategory>> = {
  'tests-pass': 'test',
  'build-pass': 'build',
  'typecheck-pass': 'typecheck',
  'lint-pass': 'lint',
};

const NOUN: Partial<Record<ClaimKind, string>> = {
  'tests-pass': 'test',
  'build-pass': 'build',
  'typecheck-pass': 'type check',
  'lint-pass': 'lint',
};

function commandFailed(s: Step): boolean {
  const c = s.command!;
  return c.failed || outputLooksFailed(c.output);
}

function evaluate(
  kind: ClaimKind,
  match: RegExpMatchArray,
  at: number,
  steps: Step[],
  files: FileChange[],
): Pick<Claim, 'verdict' | 'explanation' | 'evidence'> {
  const before = steps.slice(0, at);
  const codeEdits = before.filter((s) => s.edit && !isDocFile(s.edit.path));
  const lastEdit = codeEdits[codeEdits.length - 1];

  const cat = CATEGORY[kind];
  if (cat) {
    // Typecheck claims are also satisfied by a build that runs tsc, etc.
    const runs = before.filter((s) => s.command && (s.command.categories.includes(cat) || (cat === 'typecheck' && s.command.categories.includes('build'))));
    const noun = NOUN[kind]!;
    if (!runs.length) {
      return { verdict: 'unverified', explanation: `No ${noun} command ran before this claim.`, evidence: [] };
    }
    const last = runs[runs.length - 1];
    const c = last.command!;
    if (c.exitCode === null && !c.output) {
      return { verdict: 'unverified', explanation: `The last ${noun} run (step ${last.id + 1}) has no recorded result.`, evidence: [last.id] };
    }
    if (commandFailed(last)) {
      const head = failureHeadline(c.output);
      const masked = !c.failed ? ' Its exit code was hidden, but the output reports failures.' : '';
      return {
        verdict: 'contradicted',
        explanation: `The last ${noun} run (step ${last.id + 1}) failed${c.exitCode ? ` with exit code ${c.exitCode}` : ''}.${masked}${head ? ` “${truncate(head, 140)}”` : ''}`,
        evidence: [last.id],
      };
    }
    const filter = cat === 'test' ? partialTestFilter(c.cmd) : null;
    if (filter) {
      // The last run was a subset. What did the last full run say?
      const full = runs.filter((s) => !partialTestFilter(s.command!.cmd));
      const lastFull = full[full.length - 1];
      if (lastFull && commandFailed(lastFull)) {
        return {
          verdict: 'contradicted',
          explanation: `The last full test run (step ${lastFull.id + 1}) failed. After that the agent only ran ${filter} (step ${last.id + 1}), which passed.`,
          evidence: [lastFull.id, last.id],
        };
      }
      return {
        verdict: 'unverified',
        explanation: `The last test run (step ${last.id + 1}) only ran ${filter}, not the whole suite.`,
        evidence: [last.id],
      };
    }
    if (lastEdit && lastEdit.id > last.id) {
      return {
        verdict: 'stale',
        explanation: `The ${noun} passed at step ${last.id + 1}, but ${lastEdit.edit!.path} was changed afterwards (step ${lastEdit.id + 1}) and it wasn't run again.`,
        evidence: [last.id, lastEdit.id],
      };
    }
    return {
      verdict: 'supported',
      explanation: `Step ${last.id + 1} ran \`${truncate(c.cmd, 80)}\` after the last change and it passed.`,
      evidence: [last.id],
    };
  }

  if (kind === 'fixed') {
    const verifies = before.filter((s) => s.command && isVerify(s.command.categories) && (!lastEdit || s.id > lastEdit.id));
    if (!verifies.length) {
      return {
        verdict: 'unverified',
        explanation: lastEdit
          ? `Nothing was tested, built or checked after the last change (step ${lastEdit.id + 1}).`
          : 'No test, build or check ran in this session.',
        evidence: lastEdit ? [lastEdit.id] : [],
      };
    }
    const last = verifies[verifies.length - 1];
    if (commandFailed(last)) {
      return { verdict: 'contradicted', explanation: `The last check after the change (step ${last.id + 1}) failed.`, evidence: [last.id] };
    }
    const filter = last.command!.categories.includes('test') ? partialTestFilter(last.command!.cmd) : null;
    if (filter) {
      const fullRuns = before.filter((s) => s.command?.categories.includes('test') && !partialTestFilter(s.command.cmd));
      const lastFull = fullRuns[fullRuns.length - 1];
      if (lastFull && commandFailed(lastFull)) {
        return {
          verdict: 'contradicted',
          explanation: `The full test suite last failed at step ${lastFull.id + 1}; the only check after the change ran ${filter}.`,
          evidence: [lastFull.id, last.id],
        };
      }
      return { verdict: 'unverified', explanation: `The only check after the change ran ${filter}.`, evidence: [last.id] };
    }
    return { verdict: 'supported', explanation: `Step ${last.id + 1} checked the change and passed.`, evidence: [last.id] };
  }

  const changedBefore = files.filter((f) => f.edits.some((e) => e < at));

  if (kind === 'no-test-changes') {
    const tests = changedBefore.filter((f) => f.isTest || isTestFile(f.path));
    if (tests.length) {
      return {
        verdict: 'contradicted',
        explanation: `The agent changed ${tests.length === 1 ? 'a test file' : `${tests.length} test files`}: ${tests.map((t) => t.path).join(', ')}.`,
        evidence: tests.flatMap((t) => t.edits.filter((e) => e < at)),
      };
    }
    return { verdict: 'supported', explanation: 'No test files were changed in this session.', evidence: [] };
  }

  if (kind === 'only-changed') {
    const mentioned = extractFileRefs(match[1] ?? '');
    if (!mentioned.length) return { verdict: 'unverified', explanation: 'Could not tell which files the claim refers to.', evidence: [] };
    const extra = changedBefore.filter((f) => !mentioned.some((m) => basename(f.path).toLowerCase() === m.toLowerCase() || f.path.toLowerCase().endsWith(m.toLowerCase())));
    if (extra.length) {
      return {
        verdict: 'contradicted',
        explanation: `It also changed ${extra.map((f) => f.path).join(', ')}.`,
        evidence: extra.flatMap((f) => f.edits.filter((e) => e < at)),
      };
    }
    return { verdict: 'supported', explanation: `Only ${mentioned.join(', ')} changed.`, evidence: [] };
  }

  return { verdict: 'unverified', explanation: 'Nothing in the run supports or refutes this.', evidence: [] };
}

export function extractFileRefs(s: string): string[] {
  const refs = new Set<string>();
  for (const m of s.matchAll(/`([^`]+)`/g)) refs.add(basename(m[1].trim()));
  for (const m of s.matchAll(/\b([\w.-]+\/)*[\w-]+\.[a-zA-Z]{1,6}\b/g)) refs.add(basename(m[0]));
  return [...refs].filter((r) => /\.[a-zA-Z]{1,6}$/.test(r));
}
