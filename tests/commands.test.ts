import { describe, it, expect } from 'vitest';
import {
  classifyCommand,
  failureHeadline,
  masksExitCode,
  shellCode,
  outputLooksFailed,
  shellReadTargets,
  shellWriteTargets,
} from '../src/core/analyze/commands';

describe('classifyCommand', () => {
  it.each([
    ['npm test', 'test'],
    ['npm run test:unit', 'test'],
    ['npx vitest run', 'test'],
    ['pytest -q tests/', 'test'],
    ['go test ./...', 'test'],
    ['cargo test', 'test'],
    ['make test', 'test'],
    ['npx tsc --noEmit', 'typecheck'],
    ['mypy src', 'typecheck'],
    ['npm run build', 'build'],
    ['eslint .', 'lint'],
    ['npm install zod', 'install'],
    ['pip install requests', 'install'],
    ['git status', 'git'],
    ['node scripts/gen.js', 'run'],
    ['cat src/a.ts', 'read'],
    ['rg TODO src', 'search'],
    ['echo hello', 'other'],
  ])('%s → %s', (cmd, cat) => {
    expect(classifyCommand(cmd)).toContain(cat);
  });

  it('gives chained commands every matching category', () => {
    const cats = classifyCommand('npm run build && npm test');
    expect(cats).toEqual(expect.arrayContaining(['build', 'test']));
  });

  it('treats `make test` as a test, not a build', () => {
    expect(classifyCommand('make test')).not.toContain('build');
  });

  it('does not call a piped read a "run"', () => {
    expect(classifyCommand('cat package.json | grep version')).toEqual(['read']);
  });
});

describe('shellReadTargets', () => {
  it('finds every file in `cat a b`', () => {
    expect(shellReadTargets('cat a.ts b.ts')).toEqual(['a.ts', 'b.ts']);
  });

  it('looks inside `cd x && sed -n 1,20p a.py`', () => {
    expect(shellReadTargets('cd x && sed -n 1,20p a.py')).toEqual(['a.py']);
  });

  it('skips the numeric argument of head -n', () => {
    expect(shellReadTargets('head -n 20 src/app.ts')).toEqual(['src/app.ts']);
  });

  it('handles PowerShell Get-Content -Path', () => {
    expect(shellReadTargets('Get-Content -Path src\\a.ts -Raw')).toEqual(['src\\a.ts']);
  });

  it('counts grep in explicit files, and only the read side of a pipe', () => {
    expect(shellReadTargets('grep -n foo src/a.ts')).toEqual(['src/a.ts']);
    expect(shellReadTargets('cat a.ts | grep foo b.ts')).toEqual(['a.ts']);
  });

  it('collects reads across ; and && segments without duplicates', () => {
    expect(shellReadTargets('cat a.ts; tail -5 b.ts && cat a.ts')).toEqual(['a.ts', 'b.ts']);
  });

  it('returns nothing for non-read commands and globs', () => {
    expect(shellReadTargets('npm test')).toEqual([]);
    expect(shellReadTargets('ls src')).toEqual([]);
    expect(shellReadTargets('cat src/*.ts')).toEqual([]);
  });
});

describe('shellWriteTargets', () => {
  it('finds > and >> redirects', () => {
    expect(shellWriteTargets('echo hi > out.txt')).toEqual(['out.txt']);
    expect(shellWriteTargets('echo hi >> notes/log.md')).toEqual(['notes/log.md']);
  });

  it('ignores /dev/null, fd redirects and arrows', () => {
    expect(shellWriteTargets('npm test 2>/dev/null')).toEqual([]);
    expect(shellWriteTargets('npm test > /dev/null 2>&1')).toEqual([]);
    expect(shellWriteTargets('node -e "x => x"')).toEqual([]);
  });

  it('finds sed -i, tee and Set-Content targets', () => {
    expect(shellWriteTargets("sed -i 's/a/b/' src/a.ts")).toEqual(['src/a.ts']);
    expect(shellWriteTargets('npm test | tee test.log')).toEqual(['test.log']);
    expect(shellWriteTargets('Set-Content -Path config.json -Value "{}"')).toEqual(['config.json']);
  });
});

describe('outputLooksFailed', () => {
  it.each([
    ['Tests: 1 failed, 4 passed, 5 total'],
    ['# tests 3\n# pass 2\n# fail 1'],
    ['FAIL src/math.test.ts > adds'],
    ["src/a.ts(3,5): error TS2322: Type 'string' is not assignable"],
    ['Traceback (most recent call last):\n  File "x.py"'],
    ['test result: FAILED. 1 passed; 1 failed'],
  ])('flags %j', (out) => {
    expect(outputLooksFailed(out)).toBe(true);
  });

  it.each([[''], ['Tests: 5 passed, 0 failed'], ['# pass 3\n# fail 0'], ['Build complete in 1.2s']])('does not flag %j', (out) => {
    expect(outputLooksFailed(out)).toBe(false);
  });
});

describe('masksExitCode', () => {
  it('detects pipes and || true', () => {
    expect(masksExitCode('npm test | tail -5')).toBe(true);
    expect(masksExitCode('npm test 2>&1 | head -40')).toBe(true);
    expect(masksExitCode('pytest || true')).toBe(true);
  });

  it('leaves plain commands alone', () => {
    expect(masksExitCode('npm test')).toBe(false);
    expect(masksExitCode('npm test 2>&1')).toBe(false);
    expect(masksExitCode('npm run build && npm test')).toBe(false);
  });
});

describe('failureHeadline', () => {
  it('picks the line that explains the failure', () => {
    expect(failureHeadline('> vitest\n\nAssertionError: expected 3 to be 4\n  at x')).toBe('AssertionError: expected 3 to be 4');
  });
});

describe('shellCode', () => {
  it('drops heredoc bodies but keeps the command around them', () => {
    expect(shellCode("python - <<'EOF'\nprint('npm test')\nEOF\necho done")).toBe("python - <<HEREDOC\necho done");
    expect(shellCode('cat > a.py <<EOF\nx = 1\nEOF')).toBe('cat > a.py <<HEREDOC');
  });

  it('drops commit messages', () => {
    expect(shellCode('git commit -m "run pytest | tail" && git push')).toBe('git commit -m "" && git push');
  });

  it('does not count a script in a heredoc as a test run', () => {
    expect(classifyCommand("python - <<'EOF'\nimport subprocess\nsubprocess.run(['pytest'])\nEOF")).not.toContain('test');
  });
});
