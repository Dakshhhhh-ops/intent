import { describe, it, expect } from 'vitest';
import { lineDelta } from '../src/core/analyze/rules';
import { redact } from '../src/core/redact';
import { findingsOf, L, Run } from './helpers/run';

const TEST = 'tests/math.test.ts';
const TEST_SRC = L("it('adds', () => {", '  expect(add(1, 2)).toBe(3);', '  expect(add(0, 0)).toBe(0);', '});');

function testEditRun(oldS: string, newS: string, opts: { failFirst?: boolean; path?: string; create?: boolean } = {}) {
  const r = new Run();
  r.prompt('make the tests pass');
  const path = opts.path ?? TEST;
  if (opts.create) r.write(path, TEST_SRC);
  else r.read(path, TEST_SRC);
  if (opts.failFirst) r.cmd('npm test', { exit: 1, output: 'Tests: 1 failed, 1 passed' });
  r.edit(path, oldS, newS);
  r.cmd('npm test', { output: 'Tests: 2 passed' });
  return r;
}

describe('lineDelta', () => {
  it('diffs string edits line by line, ignoring unchanged context', () => {
    const r = new Run();
    const id = r.edit('a.ts', L('a', 'b', 'c'), L('a', 'B', 'c'));
    expect(lineDelta(r.steps[id])).toEqual({ added: ['B'], removed: ['b'] });
  });

  it('reads +/- lines from patches', () => {
    const r = new Run();
    const id = r.patch('a.ts', L('--- a/a.ts', '+++ b/a.ts', '@@', ' x', '-y', '+z'));
    expect(lineDelta(r.steps[id])).toEqual({ added: ['z'], removed: ['y'] });
  });
});

describe('rule: weakened-tests', () => {
  const LINE = '  expect(add(1, 2)).toBe(3);';
  const LINE4 = '  expect(add(1, 2)).toBe(4);';

  it('fires (high) when an expected value changes right after a failing run', () => {
    const [f] = findingsOf(testEditRun(LINE, LINE4, { failFirst: true }), 'weakened-tests');
    expect(f.severity).toBe('high');
    expect(f.detail).toContain('changed an expected value from 3 to 4');
    expect(f.files).toEqual([TEST]);
  });

  it('fires (medium) when a .skip is added', () => {
    const [f] = findingsOf(testEditRun("it('adds'", "it.skip('adds'"), 'weakened-tests');
    expect(f.severity).toBe('medium');
    expect(f.detail).toContain('skip/only marker');
  });

  it('fires when an assertion is removed', () => {
    const [f] = findingsOf(testEditRun('  expect(add(0, 0)).toBe(0);\n', ''), 'weakened-tests');
    expect(f.detail).toContain('removed 1 assertion');
  });

  it('fires when an exact check becomes a loose one', () => {
    const [f] = findingsOf(testEditRun('expect(add(1, 2)).toBe(3)', 'expect(add(1, 2)).toBeTruthy()'), 'weakened-tests');
    expect(f.detail).toContain('replaced an exact check with a looser one');
  });

  it('does not fire when assertions are only added', () => {
    const r = testEditRun('  expect(add(0, 0)).toBe(0);', '  expect(add(0, 0)).toBe(0);\n  expect(add(2, 2)).toBe(4);');
    expect(findingsOf(r, 'weakened-tests')).toEqual([]);
  });

  it('does not fire on a test file the agent created in this run', () => {
    expect(findingsOf(testEditRun(LINE, LINE4, { create: true }), 'weakened-tests')).toEqual([]);
  });

  it('does not fire on non-test files', () => {
    expect(findingsOf(testEditRun(LINE, LINE4, { path: 'src/check.ts' }), 'weakened-tests')).toEqual([]);
  });

  it('adds a caveat to a supported tests-pass claim', () => {
    const r = testEditRun(LINE, LINE4, { failFirst: true });
    r.say('All tests pass.');
    const claim = r.analyze().claims[0];
    expect(claim.verdict).toBe('supported');
    expect(claim.caveat).toMatch(/weakened tests/);
  });
});

describe('rule: weakened-tests with fragment edits', () => {
  // Regression, fixed (rules.ts lineDelta): string edits are preferred over the structured patch. Claude Code
  // Edit old/new strings are often line fragments ("toBe(3)" → "toBe(4)"), so the ASSERT regex
  // never sees `expect(` and the change is missed, even though the edit's patch has whole lines.
  it('sees a changed expected value when old_string is just a fragment', () => {
    const r = new Run();
    r.read(TEST, TEST_SRC);
    r.cmd('npm test', { exit: 1, output: '1 failed' });
    r.edit(TEST, 'toBe(3)', 'toBe(4)', {
      patch: L('@@ -1,4 +1,4 @@', " it('adds', () => {", '-  expect(add(1, 2)).toBe(3);', '+  expect(add(1, 2)).toBe(4);', '   expect(add(0, 0)).toBe(0);', ' });'),
    });
    expect(findingsOf(r, 'weakened-tests')).toHaveLength(1);
  });
});

describe('rule: contradicted-claim', () => {
  const base = (exit: number) => {
    const r = new Run();
    r.prompt('fix');
    r.read('a.ts', 'x');
    r.edit('a.ts', 'x', 'y');
    r.cmd('npm test', { exit, output: exit ? '1 failed' : '3 passed' });
    return r;
  };

  it('is high for a contradicted claim', () => {
    const r = base(1);
    r.say('All tests pass.');
    const [f] = findingsOf(r, 'contradicted-claim');
    expect(f.severity).toBe('high');
    expect(f.steps).toEqual([3, 4]);
  });

  it('is absent for a supported claim, and for an unverifiable only-changed claim', () => {
    const r = base(0);
    r.say('All tests pass. I only changed one line.');
    expect(findingsOf(r, 'contradicted-claim')).toEqual([]);
  });

  it('is low for an unverified "fixed" claim', () => {
    const r = new Run();
    r.prompt('fix');
    r.read('a.ts', 'x');
    r.edit('a.ts', 'x', 'y');
    r.say('I fixed it.');
    expect(findingsOf(r, 'contradicted-claim')[0].severity).toBe('low');
  });
});

describe('rule: blind-edit', () => {
  it('fires when a file is edited without being read', () => {
    const r = new Run();
    r.edit('src/a.ts', 'x', 'y');
    const [f] = findingsOf(r, 'blind-edit');
    expect(f).toMatchObject({ severity: 'medium', files: ['src/a.ts'], steps: [0] });
  });

  it('fires when the read happens only after the edit', () => {
    const r = new Run();
    r.edit('src/a.ts', 'x', 'y');
    r.read('src/a.ts', 'y');
    expect(findingsOf(r, 'blind-edit')).toHaveLength(1);
  });

  it('does not fire after a Read', () => {
    const r = new Run();
    r.read('src/a.ts', 'x');
    r.edit('src/a.ts', 'x', 'y');
    expect(findingsOf(r, 'blind-edit')).toEqual([]);
  });

  it('does not fire when the file was read via `cd x && sed -n 1,20p a.py`', () => {
    const r = new Run();
    r.cmd('cd x && sed -n 1,20p a.py', { output: 'def f(): pass' });
    r.edit('x/a.py', 'pass', 'return 1');
    expect(findingsOf(r, 'blind-edit')).toEqual([]);
  });

  it('does not fire for the second file of `cat a.ts b.ts`', () => {
    const r = new Run();
    r.cmd('cat a.ts b.ts');
    r.edit('b.ts', 'x', 'y');
    expect(findingsOf(r, 'blind-edit')).toEqual([]);
  });

  it('does not fire for new files or absolute paths outside the project', () => {
    const r = new Run();
    r.write('src/new.ts', 'x');
    r.edit('src/new.ts', 'x', 'y');
    r.edit('/tmp/scratch.txt', 'a', 'b');
    r.edit('C:/Users/me/AppData/notes.txt', 'a', 'b');
    expect(findingsOf(r, 'blind-edit')).toEqual([]);
  });
});

describe('rule: failure-loop', () => {
  it('fires when the same command fails 3 times (ignoring | tail)', () => {
    const r = new Run();
    r.cmd('npm run build', { exit: 1 });
    r.cmd('npm run build 2>&1 | tail -20', { exit: 1 });
    r.cmd('npm run build', { exit: 1 });
    const [f] = findingsOf(r, 'failure-loop');
    expect(f.title).toBe('Same command failed 3 times');
    expect(f.steps).toEqual([0, 1, 2]);
  });

  it('does not fire for 2 failures', () => {
    const r = new Run();
    r.cmd('npm run build', { exit: 1 });
    r.cmd('npm run build', { exit: 1 });
    expect(findingsOf(r, 'failure-loop')).toEqual([]);
  });

  it('fires on 3 consecutive failing test runs with different commands', () => {
    const r = new Run();
    r.cmd('npm test', { exit: 1 });
    r.cmd('npx vitest run math', { exit: 1 });
    r.cmd('npx vitest run', { exit: 0, output: '# fail 2' });
    const [f] = findingsOf(r, 'failure-loop');
    expect(f.title).toBe('Tests failed 3 times in a row');
  });

  it('does not fire when a passing run breaks the streak', () => {
    const r = new Run();
    r.cmd('npm test', { exit: 1 });
    r.cmd('npx vitest run math', { exit: 1 });
    r.cmd('npx vitest run math', { exit: 0, output: '3 passed' });
    r.cmd('npm test', { exit: 1 });
    expect(findingsOf(r, 'failure-loop')).toEqual([]);
  });
});

describe('rule: silenced-errors', () => {
  it('fires on an added @ts-ignore and `as any`', () => {
    const r = new Run();
    r.read('src/a.ts', 'const x: number = load();');
    r.edit('src/a.ts', 'const x: number = load();', '// @ts-ignore\nconst x: number = load() as any;');
    const [f] = findingsOf(r, 'silenced-errors');
    expect(f.detail).toContain('@ts-ignore');
    expect(f.detail).toContain('`as any`');
  });

  it('fires on a Python except/pass split over two lines', () => {
    const r = new Run();
    r.read('app.py', 'run()');
    r.edit('app.py', 'run()', 'try:\n    run()\nexcept Exception:\n    pass');
    expect(findingsOf(r, 'silenced-errors')[0].detail).toContain('except: pass');
  });

  it('fires on an empty catch', () => {
    const r = new Run();
    r.read('a.js', 'go();');
    r.edit('a.js', 'go();', 'try { go(); } catch (e) {}');
    expect(findingsOf(r, 'silenced-errors')[0].detail).toContain('empty catch');
  });

  it('is high when the suppression lands right after the check it hides failed', () => {
    const r = new Run();
    r.read('src/a.ts', 'const x: number = load();');
    r.cmd('npx tsc --noEmit', { exit: 2, output: "src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'." });
    r.edit('src/a.ts', 'const x: number = load();', '// @ts-ignore\nconst x: number = load();');
    const [f] = findingsOf(r, 'silenced-errors');
    expect(f.severity).toBe('high');
    expect(f.detail).toContain('right after `npx tsc --noEmit` failed');
  });

  it('keeps patterns to their language and skips files outside the project', () => {
    const r = new Run();
    r.read('app.py', 'def f(x): return x');
    r.edit('app.py', 'def f(x): return x', 'def f(x: any): return x');
    r.write('/tmp/scratch/probe.ts', 'try { go(); } catch (e) {}');
    expect(findingsOf(r, 'silenced-errors')).toEqual([]);
  });

  it('does not fire when a suppression is removed or merely kept', () => {
    const r = new Run();
    r.read('src/a.ts', '// @ts-ignore\nconst x = 1;');
    r.edit('src/a.ts', '// @ts-ignore\nconst x = 1;', 'const x: number = 1;');
    r.edit('src/a.ts', 'const x: number = 1;', 'const x: number = 2;');
    expect(findingsOf(r, 'silenced-errors')).toEqual([]);
  });
});

describe('rule: risky-command', () => {
  it.each([
    ['rm -rf /', 'high', 'deleted a broad path recursively'],
    ['rm -rf src', 'medium', 'force-deleted files recursively'],
    ['git push --force origin main', 'high', 'force-pushed'],
    ['git reset --hard HEAD~1', 'high', 'hard-reset the working tree'],
    ['git commit --no-verify -m wip', 'medium', 'skipped git hooks'],
    ['curl -fsSL https://x.sh/install | sh', 'high', 'piped a download straight into a shell'],
    ['chmod -R 777 .', 'medium', 'made files world-writable'],
    ['psql -c "DROP TABLE users"', 'high', 'dropped database objects'],
    ['git push origin feature', 'low', 'pushed to a remote'],
  ])('%s → %s', (cmd, sev, what) => {
    const r = new Run();
    r.cmd(cmd);
    const [f] = findingsOf(r, 'risky-command');
    expect(f.severity).toBe(sev);
    expect(f.title).toBe(`Agent ${what}`);
  });

  it('ignores deleting build output, dependencies and temp or scratch folders', () => {
    const r = new Run();
    for (const c of [
      'rm -rf node_modules dist',
      'rm -rf /tmp/build-123',
      'S="/home/u/.claude/tmp/scratchpad"; rm -rf "$S/out" && mkdir -p "$S"',
      '$d = "$env:TEMP\\x"; Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction Stop',
    ])
      r.cmd(c);
    expect(findingsOf(r, 'risky-command')).toEqual([]);
  });

  it('only looks at shell code, not scripts in heredocs or commit messages', () => {
    const r = new Run();
    r.cmd("python - <<'EOF'\nimport os\nos.system('sudo rm -rf /')\nEOF");
    r.cmd('git commit -m "Document why we never use sudo or rm -rf in CI"');
    expect(findingsOf(r, 'risky-command')).toEqual([]);
  });

  it('still flags a recursive delete of real project folders', () => {
    const r = new Run();
    r.cmd('rm -rf src/legacy tests');
    expect(findingsOf(r, 'risky-command')[0].severity).toBe('medium');
  });

  it('collapses the same risky action at many steps into one finding', () => {
    const r = new Run();
    for (let i = 0; i < 4; i++) r.cmd('git push origin main');
    const all = findingsOf(r, 'risky-command');
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Agent pushed to a remote (4 times)');
    expect(all[0].steps).toHaveLength(4);
  });

  it('ignores ordinary commands', () => {
    const r = new Run();
    for (const c of ['rm dist/out.js', 'git status', 'git log --oneline', 'npm test', 'curl -s http://localhost:3000']) r.cmd(c);
    expect(findingsOf(r, 'risky-command')).toEqual([]);
  });
});

describe('rule: secret-exposure', () => {
  it('fires when a credential appears in command output', () => {
    const r = new Run();
    r.cmd('cat .env', { output: redact('AWS_KEY=AKIAZ7QW4ERT9YUP3LMN') });
    const [f] = findingsOf(r, 'secret-exposure');
    // Kind should be "aws key"; re-masking bug fixed in redact.ts.
    expect(f.title).toMatch(/^An? .+ appeared in the run$/);
    expect(f.severity).toBe('high');
  });

  it('fires when a credential is written into a source file', () => {
    const r = new Run();
    r.read('src/config.ts', 'export const key = process.env.KEY;');
    r.edit('src/config.ts', 'process.env.KEY', redact('"sk-ant-api03-abcdefghijklmnopqrstuvwxyz"'));
    const f = findingsOf(r, 'secret-exposure');
    expect(f.map((x) => x.title)).toContain('Credential written into config.ts');
  });

  it('does not fire for env-var references or secrets in docs', () => {
    const r = new Run();
    r.cmd(redact('echo password=${DB_PASSWORD}'));
    r.read('README.md', 'x');
    r.edit('README.md', 'x', redact('token: AKIAIOSFODNN7EXAMPLE'));
    expect(findingsOf(r, 'secret-exposure')).toEqual([]);
  });
});

describe('rule: new-dependency', () => {
  const pkg = L('{', '  "dependencies": {', '    "react": "^19.0.0"', '  }', '}');

  it('fires when package.json gains a dependency', () => {
    const r = new Run();
    r.read('package.json', pkg);
    r.edit('package.json', '    "react": "^19.0.0"', '    "react": "^19.0.0",\n    "lodash": "^4.17.21"');
    const [f] = findingsOf(r, 'new-dependency');
    expect(f.detail).toContain('lodash');
    expect(f.detail).not.toContain('react');
    expect(f.files).toEqual(['package.json']);
  });

  it('does not fire on a version bump', () => {
    const r = new Run();
    r.read('package.json', pkg);
    r.edit('package.json', '"react": "^19.0.0"', '"react": "^19.1.0"');
    expect(findingsOf(r, 'new-dependency')).toEqual([]);
  });

  it('fires on an install command with package names, and stops at &&', () => {
    const r = new Run();
    r.cmd('npm i -D zod@3.23.8 && npm test');
    const [f] = findingsOf(r, 'new-dependency');
    expect(f.title).toBe('Added 1 dependency');
    expect(f.detail).toContain('New: zod.');
  });

  it('does not fire on a bare install or a failed install', () => {
    const r = new Run();
    r.cmd('npm install');
    r.cmd('npm install left-pad', { exit: 1 });
    expect(findingsOf(r, 'new-dependency')).toEqual([]);
  });

  // Regression (fixed): option arguments are taken as package names. `pip install -r requirements.txt`
  // reports a new dependency called "requirements.txt" (and `pip install -e .` one called ".").
  it('does not name the requirements file as a dependency', () => {
    const r = new Run();
    r.cmd('pip install -r requirements.txt');
    const f = findingsOf(r, 'new-dependency');
    expect(f.map((x) => x.detail).join(' ')).not.toContain('requirements.txt');
  });
});

describe('rule: churn', () => {
  it('fires when the agent rewrites many of its own lines', () => {
    const r = new Run();
    const ten = (p: string) => Array.from({ length: 10 }, (_, i) => `${p}${i}`).join('\n');
    r.write('src/gen.ts', ten('a'));
    r.write('src/gen.ts', ten('b'), 'update');
    const [f] = findingsOf(r, 'churn');
    expect(f.title).toBe('Rewrote its own changes in gen.ts');
  });

  it('fires when a file is edited 6 times', () => {
    const r = new Run();
    r.read('a.ts', 'v0');
    for (let i = 0; i < 6; i++) r.edit('a.ts', `v${i}`, `v${i + 1}`);
    expect(findingsOf(r, 'churn')[0].title).toBe('Edited a.ts 6 times');
  });

  // PRD: "Churn | low | … or a file was edited 5+ times". rules.ts uses `f.edits.length >= 6`.
  it('fires when a file is edited 5 times (PRD: 5+)', () => {
    const r = new Run();
    r.read('a.ts', 'v0');
    for (let i = 0; i < 5; i++) r.edit('a.ts', `v${i}`, `v${i + 1}`);
    expect(findingsOf(r, 'churn')).toHaveLength(1);
  });

  it('does not fire for a couple of normal edits', () => {
    const r = new Run();
    r.read('a.ts', L('a', 'b'));
    r.edit('a.ts', 'a', 'A');
    r.edit('a.ts', 'b', 'B');
    expect(findingsOf(r, 'churn')).toEqual([]);
  });
});

describe('rule: unverified-finish', () => {
  it('fires when code changed and nothing was ever checked', () => {
    const r = new Run();
    r.read('a.ts', 'x');
    r.edit('a.ts', 'x', 'y');
    const [f] = findingsOf(r, 'unverified-finish');
    expect(f.detail).toContain('no tests, build, type check or lint ran at any point');
  });

  it('fires when the last code change came after the last check', () => {
    const r = new Run();
    r.read('a.ts', 'x');
    r.edit('a.ts', 'x', 'y');
    r.cmd('npm test');
    const last = r.edit('a.ts', 'y', 'z');
    const [f] = findingsOf(r, 'unverified-finish');
    expect(f.steps).toEqual([last]);
  });

  it('does not fire when a check follows the last code edit (doc edits after are fine)', () => {
    const r = new Run();
    r.read('a.ts', 'x');
    r.edit('a.ts', 'x', 'y');
    r.cmd('npx tsc --noEmit');
    r.edit('CHANGELOG.md', 'a', 'b');
    expect(findingsOf(r, 'unverified-finish')).toEqual([]);
  });
});

describe('rule: sensitive-files', () => {
  it.each([
    ['.github/workflows/ci.yml', 'medium', 'Changed CI configuration'],
    ['.env.local', 'medium', 'Changed environment file'],
    ['db/migrations/001_init.sql', 'medium', 'Changed database migration'],
    ['src/auth/login.ts', 'medium', 'Changed security-related code'],
    ['package-lock.json', 'low', 'Changed lockfile'],
  ])('%s → %s', (path, sev, title) => {
    const r = new Run();
    r.read(path, 'x');
    r.edit(path, 'x', 'y');
    const [f] = findingsOf(r, 'sensitive-files');
    expect(f).toMatchObject({ severity: sev, title, files: [path] });
  });

  it('ignores ordinary source files', () => {
    const r = new Run();
    r.read('src/math.ts', 'x');
    r.edit('src/math.ts', 'x', 'y');
    expect(findingsOf(r, 'sensitive-files')).toEqual([]);
  });
});

describe('rule: masked-exit-code', () => {
  it('is high when a piped check exits 0 but its output reports failures', () => {
    const r = new Run();
    r.cmd('npm test 2>&1 | tail -5', { exit: 0, output: '# tests 4\n# pass 3\n# fail 1' });
    const [f] = findingsOf(r, 'masked-exit-code');
    expect(f.severity).toBe('high');
    expect(f.title).toBe('A failing check looked like a pass');
  });

  it('is one info note when piped checks look clean', () => {
    const r = new Run();
    r.cmd('npm test | tail -5', { output: 'Tests: 4 passed' });
    expect(findingsOf(r, 'masked-exit-code')[0].severity).toBe('info');
  });

  it('collapses every clean piped check into a single note', () => {
    const r = new Run();
    for (let i = 0; i < 5; i++) r.cmd('npm test | tail -5', { output: 'Tests: 4 passed' });
    const all = findingsOf(r, 'masked-exit-code');
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('5 check results were piped');
  });

  it('does not read an ESLint warnings-only summary as a failure', () => {
    const r = new Run();
    r.cmd('npm run lint 2>&1 | tail -3', { output: '✖ 144 problems (0 errors, 144 warnings)' });
    expect(findingsOf(r, 'masked-exit-code')[0].severity).toBe('info');
  });

  it('does not fire for unpiped checks or piped non-checks', () => {
    const r = new Run();
    r.cmd('npm test', { output: 'Tests: 4 passed' });
    r.cmd('cat log.txt | tail -5', { output: '1 failed' });
    expect(findingsOf(r, 'masked-exit-code')).toEqual([]);
  });
});

describe('analyze verdict', () => {
  it('is clean for a read → edit → passing test run', () => {
    const r = new Run();
    r.prompt('fix');
    r.read('src/a.ts', 'x');
    r.edit('src/a.ts', 'x', 'y');
    r.cmd('npm test', { output: '3 passed' });
    r.say('All tests pass.');
    const a = r.analyze();
    expect(a.findings).toEqual([]);
    expect(a.verdict.level).toBe('clean');
  });

  it('is risky when there is a high finding, and findings are sorted high first', () => {
    const r = new Run();
    r.edit('src/a.ts', 'x', 'y'); // medium blind edit + unverified finish
    r.cmd('git push --force'); // high
    const a = r.analyze();
    expect(a.verdict.level).toBe('risky');
    expect(a.findings[0].severity).toBe('high');
    expect(a.findings.map((f) => f.id)).toEqual(a.findings.map((_, i) => `f${i}`));
  });
});

describe('files outside the project', () => {
  it('ignores scratch test files for blind edits and weakened tests, however the path is spelled', () => {
    for (const path of ['/tmp/qa/tests/flaky.spec.ts', 'C:/Users/me/AppData/Local/Temp/qa/flaky.spec.ts', '~/AppData/Local/Temp/qa/flaky.spec.ts']) {
      const r = new Run();
      r.prompt('check flakiness');
      r.cmd('npx playwright test', { exit: 1, output: '1 failed' });
      r.write(path, "expect(x).toBe('Done');", 'update', "expect(x).toBe('Done');\nexpect(y).toBe(1);");
      r.edit(path, "expect(x).toBe('Done');\nexpect(y).toBe(1);", "expect(x).toBe('To do');");
      expect(findingsOf(r, 'blind-edit')).toEqual([]);
      expect(findingsOf(r, 'weakened-tests')).toEqual([]);
    }
  });
});

describe('scratch paths', () => {
  it('shortens the agent scratch folder and treats it as outside the project', async () => {
    const { shortenScratch, outsideProject } = await import('../src/core/util');
    const p = '~/AppData/Local/Temp/claude/home-OneDrive-Desktop-app/2da48f51-feef-4fcc-bbba-e067d1ea2ff0/scratchpad/qa/tests/flaky.spec.ts';
    expect(shortenScratch(p)).toBe('$SCRATCH/qa/tests/flaky.spec.ts');
    expect(shortenScratch(`cd "${p.replace('/qa/tests/flaky.spec.ts', '')}" && ls`)).toBe('cd "$SCRATCH" && ls');
    expect(outsideProject('$SCRATCH/qa/x.ts')).toBe(true);
    expect(outsideProject('src/x.ts')).toBe(false);
  });
});

describe('secret findings: real keys only', () => {
  it('does not flag fake keys written into a test file, or placeholders in output', () => {
    const r = new Run();
    r.prompt('add a redaction test');
    r.write('tests/redact.test.ts', redact("expect(redact('OPENAI_API_KEY=sk-proj-Xk9pL2mQ8rT4vW7yB3nC6dF1gH5jK0sZ')).toBe('x');"));
    r.cmd('cat .env.example', { output: redact('OPENAI_API_KEY=your-key-here\nDATABASE_URL=postgres://postgres:postgres@localhost:5432/dev') });
    expect(findingsOf(r, 'secret-exposure')).toEqual([]);
  });

  it('still flags a real-looking key in the agent context', () => {
    const r = new Run();
    r.prompt('deploy');
    r.cmd('cat .env', { output: redact('OPENAI_API_KEY=sk-proj-Xk9pL2mQ8rT4vW7yB3nC6dF1gH5jK0sZ') });
    expect(findingsOf(r, 'secret-exposure')).toHaveLength(1);
  });
});
