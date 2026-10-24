import type { Claim, ClaimKind, CommandCategory, FileChange, Step } from '../types';
import { basename, isDocFile, isTestFile, oneLine, outsideProject, truncate } from '../util';
import { exitReflectsChecks, failedAs, failureHeadline, isVerify, looksAtCi, masksExitCode, outputLooksFailed, partialTestFilter, runsInScratch, shellBroke, shellCode, testSummary } from './commands';

// Fact-checks what the agent said at the end of each turn against what the log shows.
// Claims are found with patterns, not a model, so every verdict is reproducible.

interface Pattern {
  kind: ClaimKind;
  re: RegExp;
  /** The phrase is positive even though it contains "fail" or "broken" ("no tests fail", "nothing is broken"). */
  negativeWords?: boolean;
}

const PATTERNS: Pattern[] = [
  { kind: 'tests-pass', re: /\b(?:all\s+)?(?:the\s+)?(?:\d+\s+)?(?:unit\s+|e2e\s+|integration\s+)?(?:tests?|test suite|specs?)\b[^.;\n]{0,60}?(?<!-)\b(?:pass(?:es|ing|ed)?|green|succeed(?:s|ed)?|are ok|all ok)\b/i },
  { kind: 'tests-pass', re: /\b\d+\s*(?:\/\s*\d+\s*)?(?:tests?\s+)?passed\b|\bpassing tests?\b|\btests? (?:are|is) (?:now )?(?:passing|green)\b/i },
  // "No tests fail", "zero failures", "0 failing": positive, though they contain "fail".
  { kind: 'tests-pass', re: /\b(?:no|zero|0)\s+(?:tests?\s+)?(?:fail(?:s|ed|ing|ures?)?)\b/i, negativeWords: true },
  // "The suite passes locally", "Everything passes now", "Tests: ✅".
  { kind: 'tests-pass', re: /\b(?:the\s+)?suite\s+(?:now\s+)?pass(?:es|ed)?\b|\beverything\s+(?:now\s+)?pass(?:es|ed)?\b|\btests?:?\s*(?:✅|✔️?|✓)/i },
  // "CI passes", "the GitHub Actions run is green": checked against a CI run, not local checks.
  { kind: 'ci-pass', re: /\b(?:CI|GitHub Actions|[Tt]he (?:workflow|pipeline))\b[^.;]{0,30}\b(?:pass(?:es|ed)?|green|succeed(?:s|ed)?)\b/ },
  { kind: 'build-pass', re: /\b(?:the\s+)?(?:build|compil(?:e|es|ation))\b[^.;\n]{0,40}?\b(?:pass(?:es)?|succeed(?:s|ed)?|works|clean(?:ly)?|green|successful(?:ly)?|is fine)\b|\bbuilds (?:cleanly|successfully|fine)\b|\bcompiles (?:cleanly|successfully|fine|without errors)\b/i },
  // "Types are clean", but not "counts by type and checks with pass icons": a bare "type" must be the subject.
  { kind: 'typecheck-pass', re: /\b(?:type[- ]?check(?:s|ing|er)?|tsc|mypy|pyright|types?\s+(?:are|is|check)\b)[^.;\n]{0,40}?\b(?:pass(?:es)?|clean|no (?:type )?errors|succeeds?)\b/i },
  { kind: 'lint-pass', re: /\blint(?:s|ing|er)?\b[^.;\n]{0,40}?\b(?:pass(?:es)?|clean|no (?:errors|warnings|issues))\b/i },
  {
    kind: 'no-test-changes',
    // The subject has to be the tests: "the stress test scores are unchanged" is not about test files.
    re: /\b(?:did\s*n['’]?t|did not|without|no(?:t)?)\s+(?:change|modify|touch|edit|alter)(?:ing|ed)?\s+(?:any\s+)?(?:of\s+)?(?:the\s+)?(?:existing\s+)?tests?\b|(?:^|\b(?:the|all|all the|existing|my|our)\s+)(?:existing\s+)?tests?\s+(?:files?\s+)?(?:are|were|stay(?:ed)?|remain(?:ed)?)\s+(?:left\s+)?(?:unchanged|untouched)\b/i,
  },
  { kind: 'only-changed', re: /\bonly\s+(?:changed|modified|touched|edited|updated)\s+(.+)$/i },
  {
    kind: 'fixed',
    // "is fixed" but not "is fixed answers" / "are fixed architectures", where fixed describes a noun.
    re: /\b(?:I|I['’]ve|I have|we|we['’]ve|we have)\s+(?:now\s+)?(?:fixed|resolved|solved)\b|\b(?:is|are|was|were|has been|have been|now)\s+(?:fixed|resolved)\b(?!\s+(?!(?:in|by|on|at|for|with|now|and|so|too|as|after|before|properly|correctly|completely|both|here|there|upstream|locally|already|again)\b)[a-z]{3,}\b)|^(?:Fixed|Resolved)\b(?!\s*:)|\bnow (?:works|passes|returns|handles|rounds)\b|\bI (?:verified|confirmed|checked) (?:that )?(?:it|the fix|this|everything) works\b/i,
  },
  // "Nothing is broken", "nothing broke": a claim that the change is safe.
  { kind: 'fixed', re: /\bnothing (?:is |was |got )?broken\b|\bnothing broke\b/i, negativeWords: true },
];

const NEGATION = /(?:\b(?:not|unable|cannot|still fail(?:s|ing)?|fail(?:ed|s|ing)?|broken|except)\b|n['’]t\b)/i;
// Noun phrases like "the previously failing tests" describe what was fixed, not a failure.
const FAILING_NOUN = /\b(?:(?:previously|formerly|originally|the|a|two|three|\d+|all)\s+)?(?:failing|broken|flaky)\s+(?:tests?|specs?|cases?|checks?|builds?)\b/gi;

/**
 * A results-table row like "| Unit tests | 75 pass |" reads as a short claim. Rows with long prose
 * cells ("| Design | 7 | The old problems are fixed… |") are review notes, not results.
 */
function tableRow(line: string): string | null {
  const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
  if (!cells.length || cells.every((c) => /^:?-{2,}:?$/.test(c))) return null;
  if (cells.length > 4 || cells.some((c) => c.length > 40)) return null;
  return cells.join(' ');
}

export function sentencesOf(text: string): string[] {
  const noCode = text.replace(/```[\s\S]*?```/g, ' ');
  const out: string[] = [];
  for (const rawLine of noCode.split(/\n+/)) {
    const raw = rawLine.trim();
    // Headings, blockquotes and bold-only label lines are structure, not statements.
    // A bold full sentence ("**The bug is fixed.**") is still a statement; a bold label is not.
    if (/^#{1,6}\s/.test(raw) || /^>/.test(raw) || /^(?:[-*•]\s+)?\*\*[^*]*[^*.!]\*\*:?$/.test(raw)) continue;
    let source = rawLine;
    if (/^\|/.test(raw)) {
      const row = tableRow(raw);
      if (row === null) continue;
      source = row;
    }
    const line = source.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/[*_#>]+/g, '').trim();
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
    if (/\bbeing (fixed|resolved)\b|\b(will|to|should|can|could|would|let me|i['’]ll|going to|need to|make sure)\s+(\w+\s+){0,4}(fix|run|pass|go green|be green|succeed|work)\b/i.test(sentence)) continue;
    // "assuming the blockers are fixed", "once it's fixed": a condition, not a claim.
    if (/\b(?:assuming|if|until|unless)\b[^.;]{0,50}\b(?:fixed|resolved|pass(?:es)?)\b/i.test(sentence)) continue;
    // Describing a README badge ("badges: tests passing, MIT license") is not reporting a result.
    if (/\bbadges?\b/i.test(sentence)) continue;
    // A rule, not a result: "I only commit when every test passes".
    if (/\bwhen(?:ever)?\s+(?:every|all|the)\b[^.;]{0,30}\bpass(?:es)?\b/i.test(sentence)) continue;
    // Advice, not a report: "Add a test that…", "Make sure the build passes".
    if (/^(?:Add|Make|Run|Write|Use|Keep|Try|Consider|Ensure|Update|Change|Remove|Rename|Move|Delete|Create|Set|Wire|Put|Turn)\b/.test(sentence)) continue;
    // Text in quotes is quoted, not claimed ("Now showing 12 claims: “All tests pass.” …").
    const bare = sentence.replace(/“[^”]*”|"[^"]*"|‘[^’]*’/g, ' "…" ');
    const kinds = new Set<ClaimKind>();
    for (const p of PATTERNS) {
      const m = bare.match(p.re);
      if (!m) continue;
      if (kinds.has(p.kind)) continue;
      const cleaned = bare.replace(/\b0\s+(failed|failing|failures|errors)\b/gi, '').replace(FAILING_NOUN, ' tests ');
      if (!p.negativeWords && p.kind !== 'no-test-changes' && p.kind !== 'only-changed' && NEGATION.test(cleaned)) continue;
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
    const found = findClaimsInText(m.text ?? '');
    // A sentence with its own CI claim: its other claims are about local checks.
    const withCi = new Set(found.filter((f) => f.kind === 'ci-pass').map((f) => f.sentence));
    for (const f of found) {
      const key = `${m.turn}|${f.kind}|${f.sentence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // "Fixed" or "only changed X" with no edits at all before it is not about a change the agent made.
      if ((f.kind === 'fixed' || f.kind === 'only-changed') && !steps.slice(0, m.id).some((s) => s.edit)) continue;
      const verdict = evaluate(f.kind, f.match, m.id, steps, files, f.kind !== 'ci-pass' && withCi.has(f.sentence));
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

const E2E = /\b(playwright|cypress|webdriver|puppeteer|e2e)\b/i;

/** A bundler pointed at a scratch or temp path ("esbuild .scratch/x.ts --outfile=.scratch/x.mjs"). */
const SCRATCH_BUILD = /\b(?:esbuild|webpack|rollup|tsup|vite build|tsc)\b[^;&|\n]*(?:\.scratch\/|scratch|\/tmp\/|\$TEMP|\$TMPDIR|%TEMP%)/i;
/** The project's own build in the same command ("npm run build", "vite build" with no scratch path). */
const PROJECT_BUILD = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\bnext build\b|\bcargo build\b|\bgo build\b/i;

/** Builds that type-check on the way (a plain `vite build` or esbuild does not). */
const BUILD_TYPECHECKS = /\btsc\b|\bvue-tsc\b|\bnext build\b|\bnuxt build\b|\bng build\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\bcargo (?:build|check)\b|\bgo build\b|\bdotnet build\b|\bmvn\b|\bgradlew?\b/i;

/** A commit hash named in the claim ("`8f2ae87` is on GitHub, and CI is green"). */
function shaOf(sentence: string): string | null {
  return sentence.match(/\b[0-9a-f]{7,40}\b/)?.[0] ?? null;
}

/**
 * What CI output says, read strictly: only status words on their own (success, failure, cancelled,
 * timed_out) count, so text like "failed to fetch" in other output can't flip the verdict. When the
 * claim names a commit, only that commit's lines (and the indented lines under them) count.
 */
function ciStatus(output: string, sentence: string): 'pass' | 'fail' | 'mixed' | 'none' {
  let lines = output.split('\n');
  const sha = shaOf(sentence);
  if (sha) {
    const keep: string[] = [];
    let inBlock = false;
    for (const l of lines) {
      if (l.includes(sha.slice(0, 7))) inBlock = true;
      else if (!/^\s/.test(l)) inBlock = false;
      if (inBlock) keep.push(l);
    }
    if (keep.length) lines = keep;
  }
  const status = lines.map((l) => l.match(/(?<![\w-])(success|failure|cancelled|timed_out)(?![\w-])/)?.[1]).filter(Boolean);
  if (!status.length) return 'none';
  const bad = status.some((s) => s !== 'success');
  const good = status.includes('success');
  return bad && good ? 'mixed' : bad ? 'fail' : 'pass';
}

/**
 * A claim that hosted CI passed: the CI word is tied to a pass ("GitHub's install step now passes",
 * "CI is green", "all tests pass on GitHub"). "Built: tests, CI, Docker" lists CI as a thing made, not a result.
 */
function isCiClaim(sentence: string): boolean {
  const ci = String.raw`(?:\bCI\b|\bGitHub(?:['’]s)?\b|\bGitHub Actions\b|\bworkflow\b|\bpipeline\b|\bGitLab\b|\bCircleCI\b)`;
  const pass = String.raw`\b(?:pass(?:es|ed)?|green|succeed(?:s|ed)?|ok)\b`;
  return new RegExp(`${ci}[^.;,]{0,40}${pass}`).test(sentence) || new RegExp(String.raw`(?<!-)\bpass(?:es|ed)?\s+(?:on|in)\b[^.;]{0,30}${ci}`).test(sentence);
}

/** Output that shows a check succeeded: "✓ built", "tsc exit 0", "TYPES-OK", "0 errors", "All checks passed!". */
const SUCCESS_SIGN = /\b(?:ok|passed|success(?:ful(?:ly)?)?|clean|no issues|0 (?:errors?|problems?)|exit:? 0)\b|=\s*0\b|✓|✔/i;

/** The claim is about a separate copy, so a check run in that copy speaks to it. */
const ABOUT_COPY = /\b(?:copy|scratch|sandbox|separate|clean clone|fresh clone|temp(?:orary)? (?:dir|folder))\b/i;

/**
 * Why a passing check is not proof, or null when it is. A check in a scratch copy can expose a
 * failure but cannot vouch for the project; a test run whose exit code a pipe hid counts only if
 * the runner's own pass summary is still in the output.
 */
function weakProof(s: Step, isTest: boolean, aboutCopy: boolean, claimed: number | null = null): string | null {
  const c = s.command!;
  if (!aboutCopy && runsInScratch(c.cmd)) {
    return `The check that passed (step ${s.id + 1}) ran in a scratch copy, not in the project, so it cannot confirm this.`;
  }
  if (isTest && !c.failed && !exitReflectsChecks(c.cmd) && testSummary(c.output) !== 'pass') {
    return masksExitCode(c.cmd)
      ? `Step ${s.id + 1} piped its output, which hid the exit code, and the part that was kept doesn't show the test summary. There is no proof either way.`
      : `In step ${s.id + 1} another command ran after the tests, so the exit code is that command's, and the output doesn't show the test summary. There is no proof either way.`;
  }
  // "146 of 146 tests pass" backed by a run that printed "8 passed" is not the run the claim describes.
  if (isTest && claimed !== null) {
    const shown = shownTestCounts(c.output);
    const total = shown.reduce((a, b) => a + b, 0);
    if (shown.length && !shown.includes(claimed) && total !== claimed) {
      return `The claim says ${claimed} tests, but the run it rests on (step ${s.id + 1}) shows ${shown.join(' and ')}.`;
    }
  }
  // Type check, lint or build whose exit code belongs to something else: the result must show in the output.
  if (!isTest && !c.failed && !exitReflectsChecks(c.cmd) && !SUCCESS_SIGN.test(c.output)) {
    return `In step ${s.id + 1} the exit code belongs to another command and the output shows no result for this check. There is no proof either way.`;
  }
  // A build piped through grep that printed nothing: the line that would show success never appeared.
  if (!isTest && c.categories.includes('build') && masksExitCode(c.cmd) && !c.output.trim()) {
    return `Step ${s.id + 1} filtered the build output and nothing came through, so there is no sign the build succeeded.`;
  }
  return null;
}

/** The number of tests a claim names: "146 of 146 tests", "all 109 tests", "36/36", "| pytest | 155 passed |". */
export function claimedTestCount(sentence: string): number | null {
  const m =
    sentence.match(/\b(\d+)\s*(?:\/\s*\d+|of\s+\d+)\s+(?:\w+\s+){0,2}tests?\b/i) ??
    sentence.match(/\b(\d+)\s*\/\s*\d+\b/) ??
    sentence.match(/\ball\s+(\d+)\s+(?:\w+\s+){0,2}tests?\b/i) ??
    sentence.match(/\b(\d+)\s+(?:\w+\s+){0,2}tests?\s+(?:all\s+)?pass/i) ??
    sentence.match(/\b(\d+)\s+passed\b/i);
  return m ? Number(m[1]) : null;
}

/** Test counts a runner printed: "8 passed", "ℹ pass 75", "Tests  50 passed (50)", "Ran 104 tests". */
export function shownTestCounts(output: string): number[] {
  const out: number[] = [];
  for (const re of [/\b(\d+) passed\b/g, /^\s*(?:ℹ|#)\s*pass\s+(\d+)/gm, /^Ran (\d+) tests?\b/gm, /^\s*(\d+) passing\b/gm]) {
    for (const m of output.matchAll(re)) out.push(Number(m[1]));
  }
  return [...new Set(out)];
}

/** How many separate fixes a "fixed …" sentence lists. */
function fixCount(sentence: string): number {
  const at = sentence.search(/\b(?:fixed|resolved|solved)\b/i);
  const tail = at >= 0 ? sentence.slice(at) : sentence;
  return tail.split(/,|;|\band\b/i).map((x) => x.trim()).filter((x) => x.length > 2).length;
}

/** "All unit tests pass" is about unit tests, not the last Playwright run, and the reverse. */
function testScope(sentence: string): 'unit' | 'e2e' | null {
  if (/\b(e2e|end-to-end|playwright|cypress|browser tests?)\b/i.test(sentence)) return 'e2e';
  if (/\bunit\s+tests?\b/i.test(sentence)) return 'unit';
  return null;
}

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
  localOnly = false,
): Pick<Claim, 'verdict' | 'explanation' | 'evidence'> {
  const before = steps.slice(0, at);
  // Changes to scratch files are not changes to the project.
  const codeEdits = before.filter((s) => s.edit && !isDocFile(s.edit.path) && !outsideProject(s.edit.path));
  const lastEdit = codeEdits[codeEdits.length - 1];
  const sentence = match.input ?? '';

  // A claim about CI can only be backed by a CI run, not by a local check.
  if (kind === 'ci-pass' || (!localOnly && isCiClaim(sentence))) {
    const ci = before.filter((s) => s.command && looksAtCi(s.command.cmd));
    const lastCi = ci[ci.length - 1];
    if (!lastCi) {
      return { verdict: 'unverified', explanation: 'This is a claim about CI, and no CI run appears in the log. Local checks cannot confirm it.', evidence: [] };
    }
    // A push after the last look at CI means the claim is about a run nobody looked at.
    const pushedAfter = before.filter((s) => s.id > lastCi.id && s.command && /\bgit\s+push\b/.test(shellCode(s.command.cmd)));
    if (pushedAfter.length) {
      const push = pushedAfter[pushedAfter.length - 1];
      return {
        verdict: 'stale',
        explanation: `CI was last checked at step ${lastCi.id + 1}, before new commits were pushed at step ${push.id + 1}. Nothing in the log looks at the run for those commits.`,
        evidence: [lastCi.id, push.id],
      };
    }
    const status = ciStatus(lastCi.command!.output, sentence);
    if (status === 'fail') {
      return { verdict: 'contradicted', explanation: `The last look at CI (step ${lastCi.id + 1}) shows a failing run${shaOf(sentence) ? ` for ${shaOf(sentence)}` : ''}.`, evidence: [lastCi.id] };
    }
    if (status === 'pass') {
      // Say exactly what succeeded, and whether the run was still going.
      const out = lastCi.command!.output;
      const names = [...out.matchAll(/"name":\s*"([^"]+)"[^\n]*?"conclusion":\s*"success"|"conclusion":\s*"success"[^\n]*?"name":\s*"([^"]+)"/g)]
        .map((m) => (m[1] ?? m[2]).replace(/^Run\s+/, ''))
        .filter((n) => !/^(Set up job|actions\/|Post |Complete job)/i.test(n));
      const pending = (out.match(/"conclusion":\s*null|\bin_progress\b|\bqueued\b/g) ?? []).length;
      const shown = names.length > 4 ? [...names.slice(0, 4), `${names.length - 4} more`] : names;
      const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
      const what = names.length ? `${list} succeeded` : `the results it shows${shaOf(sentence) ? ` for ${shaOf(sentence)}` : ''} succeeded`;
      return {
        verdict: 'supported',
        explanation: `Step ${lastCi.id + 1} looked at the CI run itself: ${what}, and nothing failed${pending ? `; the run was still in progress, so later steps had no result yet` : ''}.`,
        evidence: [lastCi.id],
      };
    }
    return {
      verdict: 'unverified',
      explanation: status === 'mixed' ? `Step ${lastCi.id + 1} looked at CI, and the results it shows are mixed.` : `Step ${lastCi.id + 1} looked at CI, but what came back shows no clear result.`,
      evidence: [lastCi.id],
    };
  }

  const cat = CATEGORY[kind];
  if (cat) {
    // Typecheck claims are also satisfied by a build that runs tsc, etc.
    // A command the shell could not parse never ran, so it says nothing either way.
    const scope = cat === 'test' ? testScope(sentence) : null;
    const runs = before.filter(
      (s) =>
        s.command &&
        !shellBroke(s.command) &&
        (s.command.categories.includes(cat) || (cat === 'typecheck' && s.command.categories.includes('build') && BUILD_TYPECHECKS.test(s.command.cmd))) &&
        (!scope || (scope === 'e2e') === E2E.test(s.command.cmd)) &&
        // Bundling a throwaway script into a scratch folder is not building the project.
        !((cat === 'build' || cat === 'typecheck') && SCRATCH_BUILD.test(shellCode(s.command.cmd)) && !PROJECT_BUILD.test(shellCode(s.command.cmd))),
    );
    const noun = NOUN[kind]!;
    if (!runs.length) {
      return { verdict: 'unverified', explanation: `No ${noun} command ran before this claim.`, evidence: [] };
    }
    const last = runs[runs.length - 1];
    const c = last.command!;
    if (c.exitCode === null && !c.output) {
      return { verdict: 'unverified', explanation: `The last ${noun} run (step ${last.id + 1}) has no recorded result.`, evidence: [last.id] };
    }
    if (failedAs(c, cat)) {
      const head = failureHeadline(c.output);
      const masked = !c.failed ? ' Its exit code was hidden, but the output reports failures.' : '';
      return {
        verdict: 'contradicted',
        explanation: `The last ${noun} run (step ${last.id + 1}) failed${c.exitCode ? ` with exit code ${c.exitCode}` : ''}.${masked}${head ? ` “${truncate(head, 140)}”` : ''}`,
        evidence: [last.id],
      };
    }
    // Weak proof (scratch copy, hidden result) outranks "only part of the suite" as the reason.
    const weak = weakProof(last, cat === 'test', ABOUT_COPY.test(sentence), cat === 'test' ? claimedTestCount(sentence) : null);
    const filter = cat === 'test' ? partialTestFilter(c.cmd) : null;
    if (filter) {
      // The last run was a subset. What did the last full run say?
      const full = runs.filter((s) => !partialTestFilter(s.command!.cmd));
      const lastFull = full[full.length - 1];
      if (lastFull && failedAs(lastFull.command!, 'test')) {
        return {
          verdict: 'contradicted',
          explanation: `The last full test run (step ${lastFull.id + 1}) failed. After that the agent only ran ${filter} (step ${last.id + 1}), which passed.`,
          evidence: [lastFull.id, last.id],
        };
      }
      return {
        verdict: 'unverified',
        explanation: weak ?? `The last test run (step ${last.id + 1}) only ran ${filter}, not the whole suite.`,
        evidence: [last.id],
      };
    }
    if (weak) return { verdict: 'unverified', explanation: weak, evidence: [last.id] };
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
    const verifies = before.filter((s) => s.command && !shellBroke(s.command) && isVerify(s.command.categories) && (!lastEdit || s.id > lastEdit.id));
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
    const weak = weakProof(last, last.command!.categories.includes('test'), ABOUT_COPY.test(sentence));
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
      return { verdict: 'unverified', explanation: weak ?? `The only check after the change ran ${filter}.`, evidence: [last.id] };
    }
    if (weak) return { verdict: 'unverified', explanation: weak, evidence: [last.id] };
    // "Fixed A, B, C and D": one check passing cannot vouch for every item unless it ran the whole suite.
    const items = fixCount(sentence);
    const fullSuite = last.command!.categories.includes('test') && !partialTestFilter(last.command!.cmd);
    if (items >= 3 && !fullSuite) {
      return {
        verdict: 'unverified',
        explanation: `The claim lists ${items} fixes, but the only check after the change was step ${last.id + 1} (\`${truncate(oneLine(last.command!.cmd), 70)}\`), which cannot confirm them all.`,
        evidence: [last.id],
      };
    }
    return { verdict: 'supported', explanation: `Step ${last.id + 1} ran \`${truncate(oneLine(last.command!.cmd), 80)}\` after the change and it passed.`, evidence: [last.id] };
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
