import { describe, it, expect } from 'vitest';
import { applyPatch, applyStringEdits, EXTERNAL, trackFiles, withContext } from '../src/core/analyze/files';
import { L, Run } from './helpers/run';

const blame = (run: Run, path: string) => {
  const f = trackFiles(run.steps).changed.find((x) => x.path === path);
  if (!f) throw new Error(`no change for ${path}`);
  return f;
};

describe('applyStringEdits', () => {
  it('replaces the first occurrence', () => {
    expect(applyStringEdits(L('a', 'b', 'b'), [{ oldString: 'b', newString: 'B' }])).toBe(L('a', 'B', 'b'));
  });

  it('replaces all occurrences with replaceAll', () => {
    expect(applyStringEdits(L('a', 'b', 'b'), [{ oldString: 'b', newString: 'B', replaceAll: true }])).toBe(L('a', 'B', 'B'));
  });

  it('applies several edits in order', () => {
    const out = applyStringEdits(L('x = 1', 'y = 2'), [
      { oldString: 'x = 1', newString: 'x = 10' },
      { oldString: 'x = 10\ny', newString: 'x = 10\nz' },
    ]);
    expect(out).toBe(L('x = 10', 'z = 2'));
  });

  it('returns null when the old string is missing', () => {
    expect(applyStringEdits('a', [{ oldString: 'nope', newString: 'x' }])).toBeNull();
    expect(applyStringEdits('a', [{ oldString: 'nope', newString: 'x', replaceAll: true }])).toBeNull();
  });

  it('appends when the old string is empty', () => {
    expect(applyStringEdits('a', [{ oldString: '', newString: 'b' }])).toBe(L('a', 'b'));
    expect(applyStringEdits('', [{ oldString: '', newString: 'b' }])).toBe('b');
  });

  it('normalizes CRLF in old/new strings', () => {
    expect(applyStringEdits(L('a', 'b', 'c'), [{ oldString: 'a\r\nb\r\n', newString: 'A\r\nB\r\n' }])).toBe(L('A', 'B', 'c'));
  });
});

describe('applyPatch', () => {
  const src = L('one', 'two', 'three', 'four', 'five');

  it('applies a unified diff hunk at its line number', () => {
    expect(applyPatch(src, L('@@ -2,2 +2,2 @@', ' two', '-three', '+THREE'))).toBe(L('one', 'two', 'THREE', 'four', 'five'));
  });

  it('applies an apply_patch body with no line numbers by searching context', () => {
    expect(applyPatch(src, L('@@', ' three', '-four', '+FOUR'))).toBe(L('one', 'two', 'three', 'FOUR', 'five'));
  });

  it('finds the hunk when the line number is off', () => {
    expect(applyPatch(src, L('@@ -1,1 +1,1 @@', '-five', '+5'))).toBe(L('one', 'two', 'three', 'four', '5'));
  });

  it('applies several hunks, tracking the line offset', () => {
    const patch = L('@@ -1,1 +1,2 @@', ' one', '+one-and-a-half', '@@ -4,1 +5,1 @@', '-four', '+FOUR');
    expect(applyPatch(src, patch)).toBe(L('one', 'one-and-a-half', 'two', 'three', 'FOUR', 'five'));
  });

  it('inserts a pure-addition hunk after its anchor line', () => {
    expect(applyPatch(src, L('@@ -2,0 +3,1 @@', '+inserted'))).toBe(L('one', 'two', 'inserted', 'three', 'four', 'five'));
  });

  it('tolerates trailing whitespace differences', () => {
    // Note: the loose match rewrites the context line with the patch's copy ('a', not 'a  ').
    expect(applyPatch(L('a  ', 'b'), L('@@', ' a', '-b', '+B'))?.split('\n')[1]).toBe('B');
  });

  it('ignores ---/+++ headers', () => {
    expect(applyPatch(src, L('--- a/f', '+++ b/f', '@@ -1,1 +1,1 @@', '-one', '+ONE'))).toBe(L('ONE', 'two', 'three', 'four', 'five'));
  });

  it('returns null when a hunk cannot be placed', () => {
    expect(applyPatch(src, L('@@', '-missing', '+x'))).toBeNull();
  });
});

describe('trackFiles: line attribution', () => {
  it('tags only the edited line with the edit step after a full read', () => {
    const r = new Run();
    r.read('src/a.ts', L('const a = 1;', 'const b = 2;', 'const c = 3;'));
    const e = r.edit('src/a.ts', 'const b = 2;', 'const b = 20;');
    const f = blame(r, 'src/a.ts');
    expect(f.reconstructed).toBe(true);
    expect(f.partial).toBe(false);
    expect(f.original).toBe(L('const a = 1;', 'const b = 2;', 'const c = 3;'));
    expect(f.final).toEqual([
      { text: 'const a = 1;', step: null },
      { text: 'const b = 20;', step: e },
      { text: 'const c = 3;', step: null },
    ]);
    expect(f.added).toBe(1);
    expect(f.removed).toBe(1);
  });

  it('moves blame to step B when B modifies a line written at step A', () => {
    const r = new Run();
    r.read('src/a.ts', L('top', 'bottom'));
    const a = r.edit('src/a.ts', 'top', L('top', 'added at A', 'also A'));
    const b = r.edit('src/a.ts', 'added at A', 'changed at B');
    const f = blame(r, 'src/a.ts');
    expect(f.final!.map((l) => [l.text, l.step])).toEqual([
      ['top', null],
      ['changed at B', b],
      ['also A', a],
      ['bottom', null],
    ]);
    // Rewriting the agent's own line counts as churn.
    expect(f.churned).toBe(1);
  });

  it('attributes deleted original lines to the step that removed them in the net diff', () => {
    const r = new Run();
    r.read('src/a.ts', L('keep', 'drop me', 'keep2'));
    const e = r.edit('src/a.ts', 'drop me\n', '');
    const f = blame(r, 'src/a.ts');
    const del = f.diff.find((d) => d.type === 'del');
    expect(del).toMatchObject({ text: 'drop me', step: e });
  });

  it('seeds from the edit\'s originalFile (before) when the file was never read', () => {
    const r = new Run();
    const e = r.edit('src/a.ts', 'b', 'B', { before: L('a', 'b') });
    const f = blame(r, 'src/a.ts');
    expect(f.reconstructed).toBe(true);
    expect(f.final).toEqual([{ text: 'a', step: null }, { text: 'B', step: e }]);
  });

  it('replays a patch on top of read content', () => {
    const r = new Run();
    r.read('app.py', L('def f():', '    return 1'));
    const p = r.patch('app.py', L('@@', ' def f():', '-    return 1', '+    return 2'));
    const f = blame(r, 'app.py');
    expect(f.reconstructed).toBe(true);
    expect(f.final!.at(-1)).toEqual({ text: '    return 2', step: p });
  });

  it('marks a created file as created with every line from the Write step', () => {
    const r = new Run();
    const w = r.write('src/new.ts', L('export const x = 1;', 'export const y = 2;'));
    const f = blame(r, 'src/new.ts');
    expect(f.created).toBe(true);
    expect(f.original).toBe('');
    expect(f.reconstructed).toBe(true);
    expect(f.final!.every((l) => l.step === w)).toBe(true);
    expect(f.added).toBe(2);
  });

  it('tags lines changed between the agent\'s edits and a later full read as external (-1)', () => {
    const r = new Run();
    r.read('a.ts', L('x', 'y'));
    r.edit('a.ts', 'x', 'X');
    r.read('a.ts', L('X', 'y', 'formatter added this'));
    const f = blame(r, 'a.ts');
    expect(f.final!.at(-1)).toEqual({ text: 'formatter added this', step: EXTERNAL });
  });
});

describe('trackFiles: fallbacks', () => {
  it('falls back to hunk attribution when content is unknown', () => {
    const r = new Run();
    const e = r.edit('src/a.ts', 'old line', 'new line');
    const f = blame(r, 'src/a.ts');
    expect(f.partial).toBe(true);
    expect(f.reconstructed).toBe(false);
    expect(f.final).toBeNull();
    expect(f.diff.map((d) => [d.type, d.text, d.step])).toEqual([
      ['hunk', 'Edit src/a.ts', e],
      ['del', 'old line', e],
      ['add', 'new line', e],
    ]);
  });

  it('falls back to hunks from a patch when content is unknown (Codex)', () => {
    const r = new Run();
    const p = r.patch('a.js', L('@@ -1,2 +1,2 @@', ' ctx', '-x', '+y'));
    const f = blame(r, 'a.js');
    expect(f.partial).toBe(true);
    expect(f.diff.filter((d) => d.type !== 'hunk').map((d) => [d.type, d.text, d.step])).toEqual([
      ['ctx', 'ctx', null],
      ['del', 'x', p],
      ['add', 'y', p],
    ]);
    expect(f.added).toBe(1);
    expect(f.removed).toBe(1);
  });

  it('falls back when the old string is not in the known content', () => {
    const r = new Run();
    r.read('a.ts', 'something else');
    r.edit('a.ts', 'not there', 'x');
    const f = blame(r, 'a.ts');
    expect(f.partial).toBe(true);
    expect(f.reconstructed).toBe(false);
  });

  it('does not reconstruct from a partial read', () => {
    const r = new Run();
    r.read('a.ts', 'line 10', false);
    r.edit('a.ts', 'line 10', 'line ten');
    expect(blame(r, 'a.ts').partial).toBe(true);
  });

  it('marks opaque edits (notebooks, shell) as partial', () => {
    const r = new Run();
    r.read('nb.ipynb', '{}');
    r.opaque('nb.ipynb');
    expect(blame(r, 'nb.ipynb').partial).toBe(true);
  });

  it('forgets known content after a shell write and marks later edits partial', () => {
    const r = new Run();
    r.read('a.ts', L('a', 'b'));
    r.edit('a.ts', 'a', 'A');
    r.cmd("sed -i 's/b/B/' a.ts");
    const f = blame(r, 'a.ts');
    expect(f.final).toBeNull();
    expect(f.partial).toBe(true);
    expect(f.reconstructed).toBe(false);
  });

  it('records deletes', () => {
    const r = new Run();
    r.read('old.ts', 'x');
    r.del('old.ts');
    const f = blame(r, 'old.ts');
    expect(f.deleted).toBe(true);
    expect(f.final).toEqual([]);
  });
});

describe('trackFiles: churn, reads and touched', () => {
  it('counts lines the agent wrote and later removed', () => {
    const r = new Run();
    r.write('scratch.ts', L('a', 'b', 'c'));
    r.write('scratch.ts', L('a', 'z'), 'update');
    const f = blame(r, 'scratch.ts');
    expect(f.churned).toBe(2);
    expect(f.edits).toHaveLength(2);
  });

  it('does not count removing original lines as churn', () => {
    const r = new Run();
    r.read('a.ts', L('a', 'b', 'c'));
    r.edit('a.ts', 'b\nc', 'B');
    expect(blame(r, 'a.ts').churned).toBe(0);
  });

  it('reports net +/- for reconstructed files even when the agent undid itself', () => {
    const r = new Run();
    r.read('a.ts', 'a');
    r.edit('a.ts', 'a', L('a', 'temp'));
    r.edit('a.ts', L('a', 'temp'), 'a');
    const f = blame(r, 'a.ts');
    expect(f.added).toBe(0);
    expect(f.removed).toBe(0);
    expect(f.churned).toBe(1);
  });

  it('counts every file a shell command reads, and readBefore respects order', () => {
    const r = new Run();
    const c = r.cmd('cat a.ts b.ts');
    const e = r.edit('b.ts', 'x', 'y');
    const t = trackFiles(r.steps);
    expect(t.touched.find((x) => x.path === 'a.ts')!.reads).toEqual([c]);
    expect(t.readBefore(e)).toEqual(new Set(['a.ts', 'b.ts']));
    expect(t.readBefore(c).size).toBe(0);
  });

  it('ignores reads from a failed shell command', () => {
    const r = new Run();
    r.cmd('cat missing.ts', { exit: 1 });
    expect(trackFiles(r.steps).touched).toEqual([]);
  });

  it('only lists edited files as changed, ordered by first edit', () => {
    const r = new Run();
    r.read('only-read.ts', 'x');
    r.edit('z.ts', 'a', 'b');
    r.edit('a.ts', 'a', 'b');
    const t = trackFiles(r.steps);
    expect(t.changed.map((f) => f.path)).toEqual(['z.ts', 'a.ts']);
    expect(t.changed[0].isTest).toBe(false);
  });
});

describe('withContext', () => {
  it('keeps n lines around changes and inserts hunk separators', () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ type: 'ctx' as const, text: `l${i}`, step: null, newNo: i + 1 }));
    lines[10] = { type: 'add' as never, text: 'new', step: 3 as never, newNo: 11 };
    const out = withContext(lines, 2);
    expect(out[0].type).toBe('hunk');
    expect(out.slice(1).map((l) => l.text)).toEqual(['l8', 'l9', 'new', 'l11', 'l12']);
  });
});
