import { describe, it, expect } from 'vitest';
import { formatDuration, toMarkdown } from '../src/core/report/markdown';
import { buildPhases, labelSteps } from '../src/core/analyze/phases';
import { Run } from './helpers/run';

function sampleRun() {
  const r = new Run();
  r.prompt('Fix the | rounding bug');
  r.read('src/math.ts', 'Math.floor(x)');
  r.edit('src/math.ts', 'Math.floor(x)', 'Math.round(x)');
  r.cmd('npm test', { exit: 1, output: '1 failed' });
  r.edit('src/math.ts', 'Math.round(x)', 'Math.round(x) || 0');
  r.say('All tests pass.');
  return r;
}

describe('toMarkdown', () => {
  it('renders verdict, claims, findings, files and phases', () => {
    const r = sampleRun();
    const t = r.trace();
    const md = toMarkdown(t, r.analyze(), { link: 'https://example.test/replay' });
    expect(md).toMatch(/^## 🔴 Intent Replay: Needs review/);
    expect(md).toContain('**Task:** test run');
    expect(md).toContain('### Claim check');
    expect(md).toContain('❌ Contradicted');
    expect(md).toContain('### Findings');
    // File table uses the net diff (+1 −1); the header stats line sums per-edit counts (+2 −2).
    expect(md).toContain('| `src/math.ts` | +1 −1 | 2 | yes |');
    expect(md).toContain('1 file changed (+2 −2)');
    expect(md).toContain('<details><summary>How the run unfolded</summary>');
    expect(md).toContain('[open the replay](https://example.test/replay)');
  });

  it('escapes pipes in table cells', () => {
    const r = new Run();
    r.prompt('x');
    r.read('a.ts', 'x');
    r.edit('a.ts', 'x', 'y');
    r.say('I only changed a.ts | b.ts.');
    const md = toMarkdown(r.trace(), r.analyze());
    expect(md).toContain('a.ts \\| b.ts');
  });

  it('says "Looks clean" for a run with no changes', () => {
    const r = new Run();
    r.prompt('what does this do?');
    r.read('a.ts', 'x');
    r.say('It adds numbers.');
    const md = toMarkdown(r.trace(), r.analyze());
    expect(md).toMatch(/^## 🟢 Intent Replay: Looks clean/);
    expect(md).not.toContain('### Files changed');
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(4_400)).toBe('4s');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(3_660_000)).toBe('1h 1m');
  });
});

describe('phases', () => {
  it('labels ask → explore → change → verify → repair → report', () => {
    const r = sampleRun();
    expect(labelSteps(r.steps)).toEqual(['ask', 'explore', 'change', 'verify', 'repair', 'report']);
  });

  it('gives an intent message the phase of the action it introduces', () => {
    const r = new Run();
    r.prompt('go');
    r.read('a.ts', 'x');
    r.say('Now I will change it.');
    r.edit('a.ts', 'x', 'y');
    expect(labelSteps(r.steps)[2]).toBe('change');
  });

  it('merges consecutive steps into chapters with summaries', () => {
    const r = sampleRun();
    const phases = buildPhases(r.steps, labelSteps(r.steps));
    expect(phases.map((p) => [p.kind, p.from, p.to])).toEqual([
      ['ask', 0, 0],
      ['explore', 1, 1],
      ['change', 2, 2],
      ['verify', 3, 3],
      ['repair', 4, 4],
      ['report', 5, 5],
    ]);
    expect(phases[3].summary).toBe('Ran 1 check: 1 failed');
    expect(phases[5].summary).toBe('Reported: “All tests pass.”');
  });
});
