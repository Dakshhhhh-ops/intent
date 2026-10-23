import { describe, it, expect } from 'vitest';
import { checkClaims, extractFileRefs, findClaimsInText, summaryMessages } from '../src/core/analyze/claims';
import { trackFiles } from '../src/core/analyze/files';
import { Run } from './helpers/run';

const kinds = (text: string) => findClaimsInText(text).map((c) => c.kind);

const claimsOf = (r: Run) => checkClaims(r.steps, trackFiles(r.steps).changed);

/** read → edit src/math.ts, then run the given test outcome, then say `summary`. */
function fixRun(test: { cmd?: string; exit?: number | null; output?: string } | null, summary: string, extra?: (r: Run) => void) {
  const r = new Run();
  r.prompt('Fix the rounding bug');
  r.read('src/math.ts', 'export const round = (x) => Math.floor(x);');
  r.edit('src/math.ts', 'Math.floor(x)', 'Math.round(x)');
  if (test) r.cmd(test.cmd ?? 'npm test', { exit: test.exit === undefined ? 0 : test.exit, output: test.output ?? 'Tests: 4 passed, 4 total' });
  extra?.(r);
  r.say(summary);
  return r;
}

describe('findClaimsInText', () => {
  it.each([
    ['All tests pass.', 'tests-pass'],
    ['All 12 tests passed.', 'tests-pass'],
    ['The test suite is green now.', 'tests-pass'],
    ['The build succeeds.', 'build-pass'],
    ['tsc reports no errors.', 'typecheck-pass'],
    ['Lint is clean.', 'lint-pass'],
    ['I fixed the rounding bug in `round()`.', 'fixed'],
    ['The issue is resolved.', 'fixed'],
    ['I only changed `src/math.ts`.', 'only-changed'],
    ["I didn't modify any tests.", 'no-test-changes'],
    ['Tests were left unchanged.', 'no-test-changes'],
  ])('%s → %s', (text, kind) => {
    expect(kinds(text)).toContain(kind);
  });

  it.each([
    ['Tests are not passing yet.'],
    ['Most tests pass but 2 still fail.'],
    ['The tests still fail.'],
    ['All tests pass except the flaky e2e one.'],
    ['Let me run the tests to make sure they pass.'],
    ["I'll run the tests next."],
    ['Do the tests pass?'],
    ['Next steps:'],
    ['The bug is being fixed upstream.'],
    ['I was unable to get the build to succeed.'],
  ])('does not treat %j as a pass/fixed claim', (text) => {
    expect(kinds(text).filter((k) => k !== 'no-test-changes' && k !== 'only-changed')).toEqual([]);
  });

  it('ignores "0 failed" when checking for negation', () => {
    expect(kinds('All 12 tests passed, 0 failed.')).toEqual(['tests-pass']);
  });

  it('ignores claims inside code blocks', () => {
    expect(kinds('Output:\n```\nAll tests pass\n```\nDone.')).toEqual([]);
  });

  it('does not add a "fixed" claim on top of a tests-pass claim in the same sentence', () => {
    expect(kinds('Fixed the bug and all tests pass.')).toEqual(['tests-pass']);
  });

  it('finds claims in bullet lists, one per sentence', () => {
    expect(kinds('Summary:\n- The build succeeds.\n- Lint is clean.')).toEqual(['build-pass', 'lint-pass']);
  });

  // Regression (fixed): NEGATION is /\b(?:not|n['’]t|...)\b/ — there is no word boundary inside "don't"/"aren't",
  // so contractions never negate. "The tests don't pass" becomes a tests-pass claim.
  it('treats contracted negations ("don\'t", "aren\'t") as negations', () => {
    expect(kinds("The tests don't pass yet.")).toEqual([]);
    expect(kinds("The tests aren't passing.")).toEqual([]);
  });

  // Regression (fixed): any "fail…" word negates the sentence, so very common summaries are dropped.
  it('keeps claims that mention previously failing tests', () => {
    expect(kinds('The 2 previously failing tests now pass.')).toContain('tests-pass');
    expect(kinds('I fixed the failing test in math.test.ts.')).toContain('fixed');
  });
});

describe('extractFileRefs', () => {
  it('pulls file names from backticks and plain text', () => {
    expect(extractFileRefs('`src/math.ts` and utils/format.js')).toEqual(['math.ts', 'format.js']);
    expect(extractFileRefs('the rounding logic')).toEqual([]);
  });
});

describe('summaryMessages', () => {
  it('returns only messages after the last action of each turn', () => {
    const r = new Run();
    r.prompt('do it');
    r.say('I will read the file.');
    r.read('a.ts', 'x');
    const done = r.say('Done.');
    r.say('Sub-agent says hi', 'subagent');
    r.prompt('thanks');
    r.say('You are welcome.'); // turn with no actions
    expect(summaryMessages(r.steps).map((s) => s.id)).toEqual([done]);
  });
});

describe('checkClaims verdicts', () => {
  it('supported: tests ran after the last edit and passed', () => {
    const [c] = claimsOf(fixRun({}, 'All tests pass.'));
    expect(c).toMatchObject({ kind: 'tests-pass', verdict: 'supported', evidence: [3] });
  });

  it('contradicted: the last test run failed', () => {
    const [c] = claimsOf(fixRun({ exit: 1, output: 'FAIL src/math.test.ts\nAssertionError: expected 2 to be 3' }, 'All tests pass.'));
    expect(c.verdict).toBe('contradicted');
    expect(c.explanation).toContain('exit code 1');
    expect(c.explanation).toContain('FAIL src/math.test.ts');
  });

  it('contradicted: exit code 0 but the output reports failures (masked)', () => {
    const [c] = claimsOf(fixRun({ cmd: 'node --test | tail -5', exit: 0, output: '# tests 3\n# pass 2\n# fail 1' }, 'All tests pass.'));
    expect(c.verdict).toBe('contradicted');
    expect(c.explanation).toMatch(/exit code was hidden/);
  });

  it('stale: tests passed, then code changed and they were not rerun', () => {
    const r = fixRun({}, 'All tests pass.', (run) => run.edit('src/math.ts', 'Math.round(x)', 'Math.round(x) + 0'));
    const [c] = claimsOf(r);
    expect(c.verdict).toBe('stale');
    expect(c.evidence).toEqual([3, 4]);
  });

  it('a docs-only edit after the test run does not make the claim stale', () => {
    const r = fixRun({}, 'All tests pass.', (run) => run.edit('README.md', 'old', 'new'));
    expect(claimsOf(r)[0].verdict).toBe('supported');
  });

  it('unverified: no test command ran', () => {
    const [c] = claimsOf(fixRun(null, 'All tests pass.'));
    expect(c.verdict).toBe('unverified');
    expect(c.evidence).toEqual([]);
  });

  it('unverified: the last test run has no recorded result', () => {
    const [c] = claimsOf(fixRun({ exit: null, output: '' }, 'All tests pass.'));
    expect(c.verdict).toBe('unverified');
  });

  it('only the last matching run counts (fail then pass = supported)', () => {
    const r = fixRun({ exit: 1, output: '1 failed' }, 'Tests are passing now.', (run) => run.cmd('npm test', { output: '4 passed' }));
    expect(claimsOf(r)[0].verdict).toBe('supported');
  });

  it('build-pass is checked against build commands, not tests', () => {
    const r = fixRun({}, 'The build succeeds.');
    expect(claimsOf(r)[0]).toMatchObject({ kind: 'build-pass', verdict: 'unverified' });
  });

  it('a build run satisfies a typecheck claim', () => {
    const r = fixRun({ cmd: 'npm run build', output: 'built in 1s' }, 'Type checking passes.');
    expect(claimsOf(r)[0]).toMatchObject({ kind: 'typecheck-pass', verdict: 'supported' });
  });

  it('fixed: supported by a passing check after the change, unverified without one', () => {
    expect(claimsOf(fixRun({}, 'I fixed the rounding bug.'))[0]).toMatchObject({ kind: 'fixed', verdict: 'supported' });
    expect(claimsOf(fixRun(null, 'I fixed the rounding bug.'))[0]).toMatchObject({ kind: 'fixed', verdict: 'unverified', evidence: [2] });
  });

  it('fixed: contradicted when the check after the change failed', () => {
    const [c] = claimsOf(fixRun({ exit: 1, output: '1 failed' }, 'The bug is fixed.'));
    expect(c).toMatchObject({ kind: 'fixed', verdict: 'contradicted', evidence: [3] });
  });

  it('only-changed: supported when it matches, contradicted when other files changed', () => {
    expect(claimsOf(fixRun({}, 'I only changed `src/math.ts`.'))[0].verdict).toBe('supported');
    const r = fixRun({}, 'I only changed math.ts.', (run) => run.edit('src/other.ts', 'a', 'b'));
    const [c] = claimsOf(r);
    expect(c.verdict).toBe('contradicted');
    expect(c.explanation).toContain('src/other.ts');
  });

  it('only-changed: makes no claim when no file is named', () => {
    expect(claimsOf(fixRun({}, 'I only changed one line.')).filter((c) => c.kind === 'only-changed')).toEqual([]);
  });

  it('no-test-changes: contradicted when a test file was edited, supported otherwise', () => {
    expect(claimsOf(fixRun({}, "I didn't touch the tests."))[0].verdict).toBe('supported');
    const r = fixRun({}, "I didn't touch the tests.", (run) => run.edit('tests/math.test.ts', 'toBe(1)', 'toBe(2)'));
    const [c] = claimsOf(r);
    expect(c.verdict).toBe('contradicted');
    expect(c.evidence).toEqual([4]);
  });

  it('negated sentences produce no claim at all', () => {
    expect(claimsOf(fixRun({ exit: 1, output: '1 failed' }, 'Two tests still fail, the rest pass.'))).toEqual([]);
  });

  it('claims made before the last action are not checked', () => {
    const r = new Run();
    r.prompt('go');
    r.read('a.ts', 'x');
    r.say('All tests pass.');
    r.edit('a.ts', 'x', 'y');
    expect(claimsOf(r)).toEqual([]);
  });

  it('does not repeat the same claim sentence twice in a turn', () => {
    const r = fixRun({}, 'All tests pass.');
    r.say('All tests pass.');
    expect(claimsOf(r)).toHaveLength(1);
  });
});
