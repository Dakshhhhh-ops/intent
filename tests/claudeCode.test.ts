import { describe, it, expect } from 'vitest';
import { parseClaudeCode, _internal } from '../src/core/parse/claudeCode';
import { analyze } from '../src/core/analyze';
import { ClaudeLog } from './helpers/logs';

const CWD = '/home/dev/proj';
const parse = (log: ClaudeLog) => parseClaudeCode(log.toString());

describe('parseClaudeCode: session metadata', () => {
  it('reads id, cwd, model, version, branch and times', () => {
    const t = parse(new ClaudeLog().prompt('Fix the bug').text('On it.'));
    expect(t).toMatchObject({
      id: 'sess-123',
      source: 'claude-code',
      cwd: CWD,
      model: 'claude-test-1',
      agentVersion: 'Claude Code 2.0.1',
      gitBranch: 'main',
      title: 'Fix the bug',
    });
    expect(t.endedAt! - t.startedAt!).toBe(1000);
  });

  it('skips bookkeeping, and warns about unreadable lines', () => {
    const log = new ClaudeLog().raw({ type: 'file-history-snapshot', snapshot: {} }).prompt('hi');
    const t = parseClaudeCode(log.toString() + '{not json\n');
    expect(t.skippedRecords).toBe(1);
    expect(t.warnings[0]).toMatch(/1 line could not be read/);
    expect(t.steps).toHaveLength(1);
  });

  it('uses an ai-title record as the title', () => {
    const t = parse(new ClaudeLog().raw({ type: 'ai-title', aiTitle: 'Rounding fix' }).prompt('hi'));
    expect(t.title).toBe('Rounding fix');
  });
});

describe('parseClaudeCode: prompts and messages', () => {
  it('numbers turns by prompt and strips system reminders', () => {
    const t = parse(
      new ClaudeLog()
        .prompt('first <system-reminder>secret harness stuff</system-reminder>')
        .text('ok')
        .prompt('[Request interrupted by user]')
        .prompt('second'),
    );
    expect(t.steps.map((s) => [s.kind, s.text, s.turn])).toEqual([
      ['prompt', 'first', 1],
      ['message', 'ok', 1],
      ['prompt', 'second', 2],
    ]);
  });

  it('turns slash commands into a readable prompt', () => {
    expect(_internal.cleanPrompt('<command-name>/review</command-name><command-args>src/a.ts</command-args>')).toBe('/review src/a.ts');
  });

  it('keeps thinking, and uses the latest text as the intent of the next tool call', () => {
    const log = new ClaudeLog().prompt('go').thinking('hmm').text('I will check the config.');
    log.read(`${CWD}/config.json`, '{}');
    const t = parse(log);
    expect(t.steps[1].kind).toBe('thinking');
    expect(t.steps[3].intent).toBe('I will check the config.');
  });

  it('counts usage once per API message id', () => {
    const log = new ClaudeLog().prompt('go').text('a', 'msg-X').text('b', 'msg-X');
    const t = parse(log);
    expect(t.steps[1].usage).toEqual({ input: 12, output: 5, cached: 100 });
    expect(t.steps[2].usage).toBeUndefined();
  });
});

describe('parseClaudeCode: tools', () => {
  it('Read: full content, relative path', () => {
    const t = parse(new ClaudeLog().read(`${CWD}/src/a.ts`, 'const a = 1;\nconst b = 2;'));
    expect(t.steps[0]).toMatchObject({ kind: 'read', files: ['src/a.ts'], read: { path: 'src/a.ts', full: true, content: 'const a = 1;\nconst b = 2;' } });
  });

  it('Read with offset/limit is partial', () => {
    const t = parse(new ClaudeLog().read(`${CWD}/src/a.ts`, 'line 10', { offset: 10, limit: 1, startLine: 10, totalLines: 50 }));
    expect(t.steps[0].read).toMatchObject({ full: false, startLine: 10, numLines: 1 });
  });

  it('Edit: keeps string edits and converts the structured patch', () => {
    const log = new ClaudeLog().edit(`${CWD}/src/a.ts`, 'b = 2', 'b = 3', [
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' const a = 1;', '-const b = 2;', '+const b = 3;'] },
    ]);
    const s = parse(log).steps[0];
    expect(s.kind).toBe('edit');
    expect(s.edit).toMatchObject({ path: 'src/a.ts', op: 'update', edits: [{ oldString: 'b = 2', newString: 'b = 3', replaceAll: false }], added: 1, removed: 1 });
    expect(s.edit!.patch).toBe('@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;');
    expect(s.edit!.before).toBeUndefined(); // originalFile was null
  });

  it('a failed Edit becomes a plain tool step with no edit', () => {
    const log = new ClaudeLog();
    const id = log.toolUse('Edit', { file_path: `${CWD}/a.ts`, old_string: 'x', new_string: 'y' });
    log.toolResult(id, '<tool_use_error>String to replace not found in file.</tool_use_error>', 'Error: String to replace not found', true);
    const s = parse(log).steps[0];
    expect(s).toMatchObject({ kind: 'tool', error: true, title: 'Edit a.ts (failed)' });
    expect(s.edit).toBeUndefined();
    expect(s.output).toBe('String to replace not found in file.');
  });

  it('Write: create vs overwrite', () => {
    const log = new ClaudeLog().write(`${CWD}/new.ts`, 'x\ny').write(`${CWD}/old.ts`, 'z', 'update', 'w');
    const [a, b] = parse(log).steps;
    expect(a).toMatchObject({ kind: 'create', edit: { op: 'create', after: 'x\ny', added: 2 } });
    expect(b).toMatchObject({ kind: 'edit', title: 'Overwrite old.ts', edit: { op: 'update', after: 'z', before: 'w' } });
  });

  it('Bash success: exit 0, stdout as output, categories', () => {
    const s = parse(new ClaudeLog().bash('npm test', { stdout: 'Tests: 3 passed' }, 'Run tests')).steps[0];
    expect(s).toMatchObject({ kind: 'command', title: 'Run tests', command: { cmd: 'npm test', exitCode: 0, failed: false, output: 'Tests: 3 passed', categories: ['test'] } });
  });

  it('Bash failure: exit code from "Exit code N", prefix stripped from output', () => {
    const s = parse(new ClaudeLog().bash('npm test', { stdout: 'FAIL a.test.ts', exit: 1 })).steps[0];
    expect(s.command).toMatchObject({ exitCode: 1, failed: true, output: 'FAIL a.test.ts' });
    expect(s.error).toBe(true);
  });

  it('Bash that never got a result is marked interrupted', () => {
    const log = new ClaudeLog();
    log.toolUse('Bash', { command: 'npm run dev' });
    expect(parse(log).steps[0].command!.interrupted).toBe(true);
  });

  it('shell reads: every file is listed, cat is a full read and sed -n is partial', () => {
    const t = parse(new ClaudeLog().bash('cat a.ts b.ts', { stdout: '...' }).bash('cd x && sed -n 1,20p a.py', { stdout: '...' }));
    expect(t.steps[0].files).toEqual(['a.ts', 'b.ts']);
    expect(t.steps[0].read).toMatchObject({ path: 'a.ts', full: true, viaShell: true });
    expect(t.steps[1].read).toMatchObject({ path: 'a.py', full: false });
  });

  it('shell writes are recorded', () => {
    const s = parse(new ClaudeLog().bash('echo hi > notes.txt')).steps[0];
    expect(s.command!.writes).toEqual(['notes.txt']);
    expect(s.detail).toMatch(/may have changed files/);
  });

  it('redacts secrets in commands and output', () => {
    const s = parse(new ClaudeLog().bash('export GH=ghp_' + 'a'.repeat(36), { stdout: 'AKIAIOSFODNN7EXAMPLE' })).steps[0];
    expect(s.command!.cmd).not.toContain('ghp_');
    expect(s.command!.output).not.toContain('AKIA');
  });

  it('maps TodoWrite, Grep, Task and MCP tools', () => {
    const log = new ClaudeLog();
    for (const [name, input] of [
      ['TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] }],
      ['Grep', { pattern: 'TODO', path: `${CWD}/src` }],
      ['Task', { description: 'explore', prompt: 'look around' }],
      ['mcp__github__create_issue', { title: 'x' }],
    ] as const) {
      const id = log.toolUse(name, input);
      log.toolResult(id, 'ok');
    }
    const t = parse(log);
    expect(t.steps.map((s) => [s.kind, s.title])).toEqual([
      ['plan', 'Plan updated (1/2 done)'],
      ['search', 'Search TODO in src'],
      ['subagent', 'Sub-agent: explore'],
      ['tool', 'github · create_issue'],
    ]);
  });

  it('attachments become user-side reads', () => {
    const log = new ClaudeLog().raw({
      type: 'attachment',
      cwd: CWD,
      attachment: { type: 'file', filename: `${CWD}/README.md`, content: { file: { content: '# hi', numLines: 1, startLine: 1, totalLines: 1 } } },
    });
    expect(parse(log).steps[0]).toMatchObject({ kind: 'read', actor: 'user', read: { path: 'README.md', full: true, content: '# hi' } });
  });

  it('relativizes Windows paths', () => {
    const log = new ClaudeLog({ cwd: 'C:\\Users\\me\\proj' }).read('C:\\Users\\me\\proj\\src\\a.ts', 'x');
    expect(parse(log).steps[0].read!.path).toBe('src/a.ts');
  });
});

describe('Claude Code end to end', () => {
  it('reconstructs blame and fact-checks the closing summary', () => {
    const log = new ClaudeLog().prompt('Fix rounding');
    log.read(`${CWD}/src/math.ts`, 'export const round = (x: number) => Math.floor(x);');
    log.text('Floor is wrong here; switching to round.');
    log.edit(`${CWD}/src/math.ts`, 'Math.floor(x)', 'Math.round(x)', [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-export const round = (x: number) => Math.floor(x);', '+export const round = (x: number) => Math.round(x);'] },
    ]);
    log.bash('npm test', { stdout: 'Tests: 4 passed, 4 total' });
    log.text('Fixed. All tests pass and I only changed `src/math.ts`.');
    const t = parse(log);
    const a = analyze(t);
    const editStep = t.steps.find((s) => s.kind === 'edit')!;
    expect(editStep.intent).toBe('Floor is wrong here; switching to round.');
    expect(a.files[0]).toMatchObject({ path: 'src/math.ts', reconstructed: true, added: 1, removed: 1 });
    expect(a.files[0].final![0].step).toBe(editStep.id);
    expect(a.claims.map((c) => [c.kind, c.verdict])).toEqual([
      ['fixed', 'supported'],
      ['tests-pass', 'supported'],
      ['only-changed', 'supported'],
    ]);
    expect(a.verdict.level).toBe('clean');
    expect(a.stats).toMatchObject({ prompts: 1, commands: 1, commandsFailed: 0, filesChanged: 1, filesRead: 1 });
  });

  it('does not flag a blind edit when the file was read with `cd x && sed -n`', () => {
    const log = new ClaudeLog();
    log.bash('cd x && sed -n 1,20p a.py', { stdout: 'def f():\n    pass' });
    log.edit(`${CWD}/x/a.py`, '    pass', '    return 1');
    const a = analyze(parse(log));
    expect(a.findings.filter((f) => f.rule === 'blind-edit')).toEqual([]);
  });
});
