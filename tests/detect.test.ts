import { describe, it, expect } from 'vitest';
import { detectFormat, parseTrace, UnsupportedFormatError } from '../src/core/parse/detect';
import { parseIntentTrace, toIntentTrace } from '../src/core/parse/intentTrace';
import { relPath, isTestFile } from '../src/core/util';
import { ClaudeLog, CodexLog } from './helpers/logs';

const claude = () => new ClaudeLog().prompt('hi').text('hello').toString();
const codex = () => new CodexLog().meta().user('hi').agent('hello').toString();

describe('detectFormat', () => {
  it('recognizes Claude Code JSONL', () => {
    expect(detectFormat(claude())).toBe('claude-code');
  });

  it('recognizes Codex rollout JSONL', () => {
    expect(detectFormat(codex())).toBe('codex');
  });

  it('recognizes Intent Trace JSON, compact or pretty-printed', () => {
    const trace = parseTrace(claude());
    const json = toIntentTrace(trace);
    expect(detectFormat(json)).toBe('intent-trace');
    expect(detectFormat(JSON.stringify(JSON.parse(json), null, 2))).toBe('intent-trace');
  });

  it('returns null for unrelated input and parseTrace throws', () => {
    expect(detectFormat('hello world')).toBeNull();
    expect(detectFormat('{"foo": 1}')).toBeNull();
    expect(() => parseTrace('not a log')).toThrow(UnsupportedFormatError);
  });
});

describe('Intent Trace round trip', () => {
  it('re-opens an exported trace with the same steps', () => {
    const t = parseTrace(new ClaudeLog().prompt('fix').bash('npm test', { stdout: 'ok' }).text('done').toString());
    const back = parseIntentTrace(toIntentTrace(t));
    expect(back.source).toBe('intent-trace');
    expect(back.steps.map((s) => [s.kind, s.title])).toEqual(t.steps.map((s) => [s.kind, s.title]));
    expect(back.steps[1].command).toMatchObject({ cmd: 'npm test', exitCode: 0, failed: false, categories: ['test'] });
  });

  it('fills defaults for minimal hand-written traces', () => {
    const t = parseIntentTrace(
      JSON.stringify({
        format: 'intent-trace',
        steps: [
          { kind: 'prompt', text: 'go' },
          { kind: 'command', command: { cmd: 'pytest', exitCode: 1 } },
          { kind: 'weird' },
        ],
      }),
    );
    expect(t.steps.map((s) => s.kind)).toEqual(['prompt', 'command', 'tool']);
    expect(t.steps[1].command).toMatchObject({ failed: true, categories: ['test'] });
    expect(t.steps[1].error).toBe(true);
    expect(t.title).toBe('go');
  });
});

describe('util', () => {
  it('relPath makes paths relative to cwd across separators, drive case and git-bash style', () => {
    expect(relPath('/home/u/proj/src/a.ts', '/home/u/proj')).toBe('src/a.ts');
    expect(relPath('C:\\Users\\U\\proj\\src\\a.ts', 'c:\\users\\u\\proj')).toBe('src/a.ts');
    expect(relPath('/c/Users/u/proj/src/a.ts', 'C:\\Users\\u\\proj')).toBe('src/a.ts');
    expect(relPath('./src/a.ts', '/x')).toBe('src/a.ts');
    expect(relPath('/elsewhere/a.ts', '/home/u/proj')).toBe('/elsewhere/a.ts');
  });

  it('isTestFile recognizes common conventions', () => {
    for (const p of ['tests/a.ts', 'src/a.test.ts', 'pkg/a_test.go', 'test_app.py', 'FooTest.java', 'spec/a_spec.rb']) expect(isTestFile(p)).toBe(true);
    for (const p of ['src/a.ts', 'src/testing.ts', 'contest.py']) expect(isTestFile(p)).toBe(false);
  });
});
