import { describe, it, expect } from 'vitest';
import { parseApplyPatch, parseCodex } from '../src/core/parse/codex';
import { analyze } from '../src/core/analyze';
import { CodexLog } from './helpers/logs';

const parse = (log: CodexLog) => parseCodex(log.toString());

describe('parseCodex: newer item_completed format', () => {
  it('reads session metadata and the model', () => {
    const t = parse(new CodexLog().meta('/work/app', 'abc', '0.50.0').context('gpt-test').user('Fix it'));
    expect(t).toMatchObject({ id: 'abc', source: 'codex', cwd: '/work/app', model: 'gpt-test', agentVersion: 'Codex CLI 0.50.0', title: 'Fix it' });
  });

  it('maps user and agent messages, skipping environment context', () => {
    const t = parse(new CodexLog().meta().user('<environment_context>cwd</environment_context>').user('Fix it').agent('Done.'));
    expect(t.steps.map((s) => [s.kind, s.text, s.turn])).toEqual([
      ['prompt', 'Fix it', 1],
      ['message', 'Done.', 1],
    ]);
  });

  it('turns a read-only command into a read step', () => {
    const t = parse(new CodexLog().meta().exec('cat src/a.js', { parsed: [{ type: 'read', cmd: 'cat src/a.js', path: 'src/a.js' }], output: 'x' }));
    expect(t.steps[0]).toMatchObject({ kind: 'read', files: ['src/a.js'], read: { path: 'src/a.js', full: true, viaShell: true } });
  });

  it('marks sed -n reads as partial', () => {
    const t = parse(new CodexLog().meta().exec('sed -n 1,40p src/a.js', { parsed: [{ type: 'read', cmd: 'sed -n 1,40p src/a.js', path: 'src/a.js' }] }));
    expect(t.steps[0].read!.full).toBe(false);
  });

  it('turns searches into search steps', () => {
    const t = parse(new CodexLog().meta().exec('rg TODO', { parsed: [{ type: 'search', cmd: 'rg TODO', query: 'TODO' }], output: 'a.js:1: TODO' }));
    expect(t.steps[0]).toMatchObject({ kind: 'search', search: { pattern: 'TODO', output: 'a.js:1: TODO' } });
  });

  it('records commands with exit code, failure, categories and duration', () => {
    const t = parse(new CodexLog().meta().exec('npm test', { exit: 1, output: '1 failed', secs: 2 }));
    expect(t.steps[0]).toMatchObject({
      kind: 'command',
      error: true,
      command: { cmd: 'npm test', exitCode: 1, failed: true, output: '1 failed', categories: ['test'], durationMs: 2500 },
    });
  });

  it('maps FileChange updates to edits with relative paths and patch counts', () => {
    const t = parse(
      new CodexLog().meta('/work/app').fileChange({ '/work/app/src/a.js': { type: 'update', unified_diff: '@@ -1,2 +1,2 @@\n ctx\n-x\n+y\n', move_path: null } }),
    );
    expect(t.steps[0]).toMatchObject({ kind: 'edit', title: 'Edit src/a.js', edit: { path: 'src/a.js', op: 'update', added: 1, removed: 1 } });
  });

  it('relativizes Windows paths in FileChange keys', () => {
    const t = parse(new CodexLog().meta('C:\\work\\app').fileChange({ 'C:\\work\\app\\src\\a.js': { type: 'update', unified_diff: '@@\n-x\n+y' } }));
    expect(t.steps[0].edit!.path).toBe('src/a.js');
  });

  // Was a bug (codex.ts fileChange), now fixed: real Codex logs store new/deleted files as {type:'add', content:'<raw text>'}
  // (no '+' prefixes, no unified_diff). The parser treats the raw content as a diff, so `after`
  // becomes '' and +/- counts are wrong (CSS lines like "--bg: #000" even count as removals).
  it('reads the content of an added file from `content`', () => {
    const t = parse(new CodexLog().meta('/work/app').fileChange({ '/work/app/src/new.css': { type: 'add', content: ':root {\n--bg: #000;\n}\n' } }));
    expect(t.steps[0].edit).toMatchObject({ op: 'create', after: ':root {\n--bg: #000;\n}\n', added: 3, removed: 0 });
  });

  it('builds `after` for added files given as a +diff', () => {
    const t = parse(new CodexLog().meta('/work/app').fileChange({ '/work/app/b.js': { type: 'add', unified_diff: '+line 1\n+line 2' } }));
    expect(t.steps[0]).toMatchObject({ kind: 'create', edit: { op: 'create', after: 'line 1\nline 2', added: 2 } });
  });
});

describe('parseCodex: older response_item format', () => {
  it('pairs shell function calls with their output and exit code', () => {
    const log = new CodexLog()
      .meta()
      .responseItem({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'run tests' }] })
      .responseItem({ type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }), call_id: 'c1' })
      .responseItem({ type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: '1 failed', metadata: { exit_code: 1, duration_seconds: 1.5 } }) })
      .responseItem({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tests fail.' }] });
    const t = parse(log);
    expect(t.steps.map((s) => s.kind)).toEqual(['prompt', 'command', 'message']);
    expect(t.steps[1].command).toMatchObject({ cmd: 'npm test', exitCode: 1, failed: true, output: '1 failed', durationMs: 1500 });
  });

  it('parses apply_patch custom tool calls into edits', () => {
    const t = parse(
      new CodexLog().meta().responseItem({ type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: a.js\n@@\n-x\n+y\n*** End Patch' }),
    );
    expect(t.steps[0]).toMatchObject({ kind: 'edit', edit: { path: 'a.js', patch: '@@\n-x\n+y', added: 1, removed: 1 } });
  });

  it('a command with no output record keeps exitCode null', () => {
    const t = parse(new CodexLog().meta().responseItem({ type: 'function_call', name: 'shell', arguments: '{"command":["npm","test"]}', call_id: 'c9' }));
    expect(t.steps[0].command!.exitCode).toBeNull();
  });

  it('skips response_items for turns that also have item events (no duplicates)', () => {
    const log = new CodexLog('T1')
      .meta()
      .responseItem({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix it' }], internal_chat_message_metadata_passthrough: { turn_id: 'T1' } })
      .user('Fix it');
    const t = parse(log);
    expect(t.steps.filter((s) => s.kind === 'prompt')).toHaveLength(1);
  });
});

describe('parseApplyPatch', () => {
  it('splits a multi-file patch with add, update+move and delete', () => {
    const files = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Add File: new.txt',
        '+hello',
        '*** Update File: src/a.js',
        '*** Move to: src/b.js',
        '@@',
        '-x',
        '+y',
        '*** Delete File: old.txt',
        '*** End Patch',
      ].join('\n'),
    );
    expect(files).toEqual([
      { path: 'new.txt', kind: 'add', diff: '+hello' },
      { path: 'src/a.js', kind: 'update', diff: '@@\n-x\n+y', movePath: 'src/b.js' },
      { path: 'old.txt', kind: 'delete', diff: '' },
    ]);
  });
});

describe('Codex end to end', () => {
  it('attributes patch-only edits at hunk level and catches a failing test claim', () => {
    const log = new CodexLog()
      .meta('/work/app')
      .user('Fix the parser')
      .exec('cat src/parse.js', { parsed: [{ type: 'read', cmd: 'cat src/parse.js', path: 'src/parse.js' }], output: 'a\nb' })
      .fileChange({ '/work/app/src/parse.js': { type: 'update', unified_diff: '@@ -1,2 +1,2 @@\n a\n-b\n+B\n' } })
      .exec('npm test', { exit: 1, output: 'FAIL parse.test.js' })
      .agent('All tests pass now.');
    const a = analyze(parse(log));
    const f = a.files[0];
    expect(f.path).toBe('src/parse.js');
    expect(f.partial).toBe(true); // Codex reads have no captured content
    expect(f.diff.find((d) => d.type === 'add')).toMatchObject({ text: 'B', step: 2 });
    expect(a.findings.filter((x) => x.rule === 'blind-edit')).toEqual([]);
    expect(a.claims[0]).toMatchObject({ kind: 'tests-pass', verdict: 'contradicted', evidence: [3] });
    expect(a.verdict.level).toBe('risky');
  });
});
