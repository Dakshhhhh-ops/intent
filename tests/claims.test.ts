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

describe('claim precision on real-world phrasing', () => {
  it('does not blame a type check for a test failure in the same command', () => {
    const r = new Run();
    r.prompt('fix it');
    r.read('a.py', 'x = 1');
    r.edit('a.py', 'x = 1', 'x = 2');
    r.cmd('ruff check . && mypy . | tail -2; pytest -q | tail -3', { output: 'All checks passed!\nSuccess: no issues found in 12 source files\nFAILED tests/test_a.py::test_x - AssertionError\n1 failed, 20 passed' });
    r.say('Ruff and mypy are clean.');
    const claim = claimsOf(r).find((c) => c.kind === 'typecheck-pass')!;
    expect(claim.verdict).toBe('supported');
  });

  it('still contradicts the test claim from that same command', () => {
    const r = new Run();
    r.prompt('fix it');
    r.read('a.py', 'x = 1');
    r.edit('a.py', 'x = 1', 'x = 2');
    r.cmd('mypy . | tail -2; pytest -q | tail -3', { output: 'Success: no issues found\nFAILED tests/test_a.py::test_x - AssertionError\n1 failed, 20 passed' });
    r.say('All tests pass.');
    expect(claimsOf(r).find((c) => c.kind === 'tests-pass')!.verdict).toBe('contradicted');
  });

  it.each([
    'Now showing 12 claims: "All tests pass.", "Only changed `cart.js`.", "The build succeeds."',
    'Scores (assuming the blockers are fixed) look good.',
    'Everything else is fixed answers.',
    'The synthetic scores, ablation and stress test are unchanged.',
  ])('is not a claim: %s', (text) => {
    expect(findClaimsInText(text)).toEqual([]);
  });

  it('still reads ordinary claims', () => {
    expect(findClaimsInText('After the fix, all tests pass.').map((c) => c.kind)).toEqual(['tests-pass']);
    expect(findClaimsInText('The rounding bug is fixed in cart.js.').map((c) => c.kind)).toEqual(['fixed']);
    expect(findClaimsInText('The existing tests are unchanged.').map((c) => c.kind)).toEqual(['no-test-changes']);
  });
});

describe('test runner summaries decide masked results', () => {
  it('trusts "Ran 104 tests … OK" over stray error lines from other commands', () => {
    const r = new Run();
    r.prompt('fix it');
    r.read('a.py', 'x = 1');
    r.edit('a.py', 'x = 1', 'x = 2');
    r.cmd('python tools/report.py; python -m unittest discover 2>&1 | grep -E "^(Ran|OK|FAIL)"', { output: 'AssertionError in sample 3 (expected)\nRan 104 tests in 0.3s\nOK' });
    r.say('All 104 tests pass.');
    expect(claimsOf(r).find((c) => c.kind === 'tests-pass')!.verdict).toBe('supported');
  });

  it('reads a Playwright run with a failure as failed even when it also prints passes', () => {
    const r = new Run();
    r.prompt('fix it');
    r.read('a.ts', 'x');
    r.edit('a.ts', 'x', 'y');
    r.cmd('npx playwright test | tail -5', { output: '  6 passed (22.5s)\n    Error: expect(locator).toBeVisible() failed\n  1 failed' });
    r.say('All 6 tests pass.');
    expect(claimsOf(r).find((c) => c.kind === 'tests-pass')!.verdict).toBe('contradicted');
  });

  it('ignores a command the shell could not parse', () => {
    const r = new Run();
    r.prompt('fix it');
    r.read('a.py', 'x = 1');
    r.edit('a.py', 'x = 1', 'x = 2');
    r.cmd('pytest -q', { output: '3 passed in 0.2s' });
    r.cmd("pytest -q; echo 'oops", { exit: 2, output: "/usr/bin/bash: -c: line 3: unexpected EOF while looking for matching `''" });
    r.say('All tests pass.');
    expect(claimsOf(r).find((c) => c.kind === 'tests-pass')!.verdict).toBe('supported');
  });

  it('checks "unit tests pass" against unit test runs, not the last Playwright run', () => {
    const r = new Run();
    r.prompt('fix it');
    r.read('a.ts', 'x');
    r.edit('a.ts', 'x', 'y');
    r.cmd('npx vitest run', { output: 'Tests  117 passed (117)' });
    r.cmd('npx playwright test', { exit: 1, output: '1 failed\n53 passed (7.7m)' });
    r.say('All 117 unit tests pass.');
    expect(claimsOf(r).find((c) => c.kind === 'tests-pass')!.verdict).toBe('supported');
  });
});

describe('what counts as proof', () => {
  const base = () => {
    const r = new Run();
    r.prompt('fix it');
    r.read('src/a.ts', 'x');
    r.edit('src/a.ts', 'x', 'y');
    return r;
  };

  it('a passing check in a scratch copy does not support a claim about the project', () => {
    const r = base();
    r.cmd('cd "/home/u/.claude/tmp/scratchpad" && npx vitest run probe.test.ts', { output: 'Tests  1 passed (1)' });
    r.say('I fixed the undo bug.');
    const c = claimsOf(r)[0];
    expect(c.verdict).toBe('unverified');
    expect(c.explanation).toContain('scratch copy');
  });

  it('but it does speak to a claim about that copy', () => {
    const r = base();
    r.cmd('QA="/tmp/qa"; cd "$QA" && npx playwright test', { output: '6 passed (20s)\n1 failed' });
    r.say('I tested it in my separate copy: all 6 tests pass.');
    expect(claimsOf(r).find((c) => c.kind === 'tests-pass')!.verdict).toBe('contradicted');
  });

  it('a claim about CI needs a CI run', () => {
    const r = base();
    r.cmd('npm ci && npx tsc --noEmit', { output: '' });
    r.say("GitHub's install step now passes.");
    expect(claimsOf(r)[0].verdict).toBe('unverified');
  });

  it('a claim listing several fixes needs the full suite, not one narrow check', () => {
    const r = base();
    r.cmd('npx vitest run tests/undo.test.ts', { output: 'Tests  4 passed (4)' });
    r.say('Fixed the undo bug, lost card moves, crashes from bad IDs and the card limit.');
    expect(claimsOf(r)[0].verdict).toBe('unverified');
    const r2 = base();
    r2.cmd('npx vitest run', { output: 'Tests  40 passed (40)' });
    r2.say('Fixed the undo bug, lost card moves, crashes from bad IDs and the card limit.');
    expect(claimsOf(r2)[0].verdict).toBe('supported');
  });

  it('a piped test run proves nothing unless the pass summary survived the pipe', () => {
    const r = base();
    r.cmd('npm test 2>&1 | grep -E "probe"', { output: 'probe ok' });
    r.say('All tests pass.');
    expect(claimsOf(r)[0].verdict).toBe('unverified');
    const r2 = base();
    r2.cmd('npm test 2>&1 | tail -3', { output: 'Tests  40 passed (40)' });
    r2.say('All tests pass.');
    expect(claimsOf(r2)[0].verdict).toBe('supported');
  });
});

describe('proof, second round (from a hand review of 30 supported verdicts)', () => {
  const base = () => {
    const r = new Run();
    r.prompt('fix it');
    r.read('src/a.ts', 'x');
    r.edit('src/a.ts', 'x', 'y');
    return r;
  };

  it('a test run followed by another command after `;` is not proof without the summary', () => {
    const r = base();
    r.cmd('pytest -q; git status --short', { output: ' M README.md' });
    r.say('All 110 tests pass.');
    expect(claimsOf(r)[0].verdict).toBe('unverified');
    const r2 = base();
    r2.cmd('pytest -q; git status --short', { output: '110 passed in 3.1s\n M README.md' });
    r2.say('All 110 tests pass.');
    expect(claimsOf(r2)[0].verdict).toBe('supported');
  });

  it('a CI check that shows no result does not back a CI claim', () => {
    const r = base();
    r.cmd('curl -s "https://api.github.com/repos/o/r/actions/runs?per_page=1" | head -3', { output: '' });
    r.say('GitHub CI passed: lint, typecheck and the unit tests all succeeded.');
    expect(claimsOf(r)[0].verdict).toBe('unverified');
  });

  it('a piped build that printed nothing is not proof', () => {
    const r = base();
    r.cmd('npx next build 2>&1 | grep -E "Compiled|rror"', { output: '' });
    r.say('The production build succeeds.');
    expect(claimsOf(r)[0].verdict).toBe('unverified');
  });

  it('a plain vite build does not count as a type check', () => {
    const r = base();
    r.cmd('npx vite build', { output: '✓ built in 1.2s' });
    r.say('The typecheck is clean.');
    expect(claimsOf(r)[0].verdict).toBe('unverified');
  });

  it.each(['Add my probe as a test that requires a false-pass rate under 10%.', 'I now only commit when every test passes.', 'Make sure the build passes before you merge.'])('is not a claim: %s', (t) => {
    expect(findClaimsInText(t)).toEqual([]);
  });
});

describe('CI claims', () => {
  const base = () => {
    const r = new Run();
    r.prompt('ship it');
    r.read('src/a.ts', 'x');
    r.edit('src/a.ts', 'x', 'y');
    return r;
  };
  const ciCall = 'curl -s "https://api.github.com/repos/o/r/actions/runs?per_page=2" | python -c "print"';

  it('the run for the named commit decides, even if another one failed', () => {
    const r = base();
    r.cmd(ciCall, { output: '28dbd77 completed success Add clock\n6fda16a completed failure Fix path' });
    r.say('GitHub CI passes on 28dbd77.');
    expect(claimsOf(r)[0].verdict).toBe('supported');
    const r2 = base();
    r2.cmd(ciCall, { output: '28dbd77 completed failure Add clock\n6fda16a completed success Fix path' });
    r2.say('GitHub CI passes on 28dbd77.');
    expect(claimsOf(r2)[0].verdict).toBe('contradicted');
  });

  it('a list of things built that includes CI is not a claim about CI', () => {
    const r = base();
    r.cmd('npx vitest run', { output: 'Tests  15 passed (15)' });
    r.say('Built: the server, the UI, 15 passing tests, CI, Docker and a README.');
    const c = claimsOf(r).find((x) => x.kind === 'tests-pass')!;
    expect(c.verdict).toBe('supported');
  });
});

describe('CI output is read strictly', () => {
  const base = () => {
    const r = new Run();
    r.prompt('ship it');
    r.read('src/a.ts', 'x');
    r.edit('src/a.ts', 'x', 'y');
    return r;
  };
  const ciCall = 'curl -s "https://api.github.com/repos/o/r/actions/runs?per_page=3" | python -c "print"';

  it('only the named commit counts', () => {
    const r = base();
    r.cmd(ciCall, { output: '2eca4a3 backend failure\n2eca4a3 frontend success\n8f2ae87 completed success\n   frontend success\n   backend success' });
    r.say('`8f2ae87` is on GitHub, and CI is green.');
    expect(claimsOf(r)[0].verdict).toBe('supported');
  });

  it('words like "failed to" in other output do not count', () => {
    const r = base();
    r.cmd(ciCall, { output: 'diff: the old script failed to parse\ncompleted success 99d12de\ncompleted success f238dd5' });
    r.say('CI is green.');
    expect(claimsOf(r)[0].verdict).toBe('supported');
  });

  it('mixed results without a named commit are unverified', () => {
    const r = base();
    r.cmd(ciCall, { output: '28dbd77 completed success\n6fda16a completed failure' });
    r.say('CI is green.');
    expect(claimsOf(r)[0].verdict).toBe('unverified');
  });

  it('a prediction is not a claim', () => {
    expect(findClaimsInText('The lint fix is pushed, so CI should go green again.')).toEqual([]);
  });
});

describe('CI checked before a push', () => {
  it('is stale for a claim made after new commits were pushed', () => {
    const r = new Run();
    r.prompt('ship it');
    r.read('src/a.ts', 'x');
    r.edit('src/a.ts', 'x', 'y');
    r.cmd('gh run list --limit 1', { output: 'completed success  main  abc1234' });
    r.edit('src/a.ts', 'y', 'z');
    r.cmd('git commit -am "more" && git push');
    r.say('GitHub checks (CI) now pass.');
    expect(claimsOf(r)[0].verdict).toBe('stale');
  });
});

describe('proof, third round', () => {
  it.each(['Topology: this now has a strip of counts by type and checks with pass or warning icons.', 'Header: badges (tests passing, MIT license) and links.'])('is not a claim: %s', (t) => {
    expect(findClaimsInText(t)).toEqual([]);
  });

  it('still reads "types are clean" and "typecheck passes"', () => {
    expect(findClaimsInText('Types are clean.').map((c) => c.kind)).toEqual(['typecheck-pass']);
    expect(findClaimsInText('Typecheck passes.').map((c) => c.kind)).toEqual(['typecheck-pass']);
  });

  it('a type check whose exit code belongs to a later command needs a visible result', () => {
    const r = new Run();
    r.prompt('fix');
    r.read('src/a.ts', 'x');
    r.edit('src/a.ts', 'x', 'y');
    r.cmd('npx tsc --noEmit; git status --short', { output: '?? src/new.ts' });
    r.say('Typecheck passes.');
    expect(claimsOf(r)[0].verdict).toBe('unverified');
    const r2 = new Run();
    r2.prompt('fix');
    r2.read('src/a.ts', 'x');
    r2.edit('src/a.ts', 'x', 'y');
    r2.cmd('npx tsc --noEmit && echo tsc-ok; git status --short', { output: 'tsc-ok\n?? src/new.ts' });
    r2.say('Typecheck passes.');
    expect(claimsOf(r2)[0].verdict).toBe('supported');
  });
});

describe('claimed test counts', () => {
  const run = (out: string, said: string) => {
    const r = new Run();
    r.prompt('fix');
    r.read('src/a.py', 'x');
    r.edit('src/a.py', 'x', 'y');
    r.cmd('pytest -q', { output: out });
    r.say(said);
    return claimsOf(r)[0];
  };

  it('reads the number a claim names', async () => {
    const { claimedTestCount } = await import('../src/core/analyze/claims');
    expect(claimedTestCount('Checks: 146 of 146 tests pass on the committed data.')).toBe(146);
    expect(claimedTestCount('All 109 tests pass, and ruff is clean.')).toBe(109);
    expect(claimedTestCount('Tests pass 18/18.')).toBe(18);
    expect(claimedTestCount('| pytest | 155 passed |')).toBe(155);
    expect(claimedTestCount('All tests pass.')).toBeNull();
  });

  it('is unverified when the run shows a different number', () => {
    const c = run('8 passed in 1.09s', 'Checks: 146 of 146 tests pass on the committed data.');
    expect(c.verdict).toBe('unverified');
    expect(c.explanation).toContain('146');
    expect(c.explanation).toContain('8');
  });

  it('is supported when the numbers match, alone or summed across runners', () => {
    expect(run('146 passed in 9s', 'All 146 tests pass.').verdict).toBe('supported');
    expect(run('ℹ pass 75\nℹ fail 0\nTests  50 passed (50)', 'All 125 tests pass.').verdict).toBe('supported');
  });
});
