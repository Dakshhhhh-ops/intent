import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalMessageClaims, installHook, readTranscript, runStopHook } from '../cli/hook';
import { ClaudeLog } from './helpers/logs';

const dir = mkdtempSync(join(tmpdir(), 'ir-hook-'));
let n = 0;
const save = (log: ClaudeLog) => {
  const p = join(dir, `t${n++}.jsonl`);
  writeFileSync(p, log.toString());
  return p;
};

/** Edit, then a test run whose failure is hidden by a pipe. */
const hiddenFailure = () =>
  new ClaudeLog()
    .prompt('Fix the rounding bug')
    .read('/home/dev/proj/src/math.ts', 'export const round = (x) => Math.floor(x);')
    .edit('/home/dev/proj/src/math.ts', 'Math.floor(x)', 'Math.round(x)')
    .bash('npm test 2>&1 | tail -3', { stdout: 'Tests: 1 failed, 5 passed, 6 total', exit: 0 });

const passing = () =>
  new ClaudeLog()
    .prompt('Fix the rounding bug')
    .read('/home/dev/proj/src/math.ts', 'export const round = (x) => Math.floor(x);')
    .edit('/home/dev/proj/src/math.ts', 'Math.floor(x)', 'Math.round(x)')
    .bash('npm test', { stdout: 'Tests: 6 passed, 6 total', exit: 0 });

const stop = (path: string, last: string, active = false) =>
  runStopHook({ hook_event_name: 'Stop', transcript_path: path, last_assistant_message: last, stop_hook_active: active }, readTranscript);

describe('Stop hook', () => {
  it('sends the agent back when its final message is contradicted (final message not yet in the transcript)', () => {
    const r = stop(save(hiddenFailure()), 'Fixed the rounding bug. All 6 tests pass.');
    expect(r.exit).toBe(2);
    expect(r.stderr).toContain('All 6 tests pass');
    expect(r.stderr).toMatch(/fail/i);
    expect(r.stderr).toMatch(/Fix the problem/);
  });

  it('does not count the final message twice when the transcript already has it', () => {
    const said = 'Fixed the rounding bug. All 6 tests pass.';
    const written = finalMessageClaims(readTranscript(save(hiddenFailure().text(said))), said).map((c) => c.kind);
    const notYet = finalMessageClaims(readTranscript(save(hiddenFailure())), said).map((c) => c.kind);
    expect(written).toEqual(['fixed', 'tests-pass']);
    expect(notYet).toEqual(written);
  });

  it('lets a supported claim through', () => {
    expect(stop(save(passing()), 'Fixed it. All 6 tests pass.')).toEqual({ exit: 0 });
  });

  it('lets a message without claims through', () => {
    expect(stop(save(hiddenFailure()), 'I changed Math.floor to Math.round; one test still fails, see above.')).toEqual({ exit: 0 });
  });

  it('only checks the final message, not earlier ones', () => {
    const path = save(hiddenFailure().text('All 6 tests pass.').prompt('thanks').text('You are welcome.'));
    expect(stop(path, 'You are welcome.')).toEqual({ exit: 0 });
  });

  it('never blocks twice in a row: with stop_hook_active it only tells the person', () => {
    const r = stop(save(hiddenFailure()), 'All 6 tests pass.', true);
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout!).systemMessage).toMatch(/still makes a claim/);
  });

  it('never blocks on its own problems', () => {
    expect(runStopHook({ hook_event_name: 'Stop', transcript_path: join(dir, 'missing.jsonl') }, readTranscript)).toEqual({ exit: 0 });
    expect(runStopHook({ hook_event_name: 'Stop', transcript_path: save(passing()) }, () => { throw new Error('boom'); })).toEqual({ exit: 0 });
    expect(runStopHook({ hook_event_name: 'PreToolUse', transcript_path: save(hiddenFailure()) }, readTranscript)).toEqual({ exit: 0 });
  });
});

describe('hook install', () => {
  it('adds the Stop hook once and keeps other settings', () => {
    const path = join(dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }], PreToolUse: [] } }));
    const first = installHook('/opt/intent/dist-cli/intent-replay.mjs', path);
    const again = installHook('/opt/intent/dist-cli/intent-replay.mjs', path);
    expect(first.changed).toBe(true);
    expect(again.changed).toBe(false);
    const s = JSON.parse(readFileSync(path, 'utf8'));
    expect(s.model).toBe('opus');
    expect(s.hooks.PreToolUse).toEqual([]);
    const commands = s.hooks.Stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe('say done');
    expect(commands[1]).toMatch(/^node ".*\/opt\/intent\/dist-cli\/intent-replay\.mjs" hook$/);
  });

  it('replaces an older Intent Replay entry instead of adding a second', () => {
    const path = join(dir, 'settings2.json');
    installHook('/old/place/intent-replay.mjs', path);
    installHook('/new/place/intent-replay.mjs', path);
    const s = JSON.parse(readFileSync(path, 'utf8'));
    expect(s.hooks.Stop).toHaveLength(1);
    expect(s.hooks.Stop[0].hooks[0].command).toContain('/new/place/');
  });

  it('refuses to overwrite a settings file it cannot read', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ "model": ');
    expect(() => installHook('/x/intent-replay.mjs', path)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{ "model": ');
  });
});
