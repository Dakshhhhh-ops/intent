import type { Phase, PhaseKind, Step } from '../types';
import { outsideProject } from '../util';
import { isVerify, outputLooksFailed } from './commands';

// The run told as chapters. The web Brief and the Markdown report both use this, so they agree.

export const PHASE_TITLE: Record<PhaseKind, string> = {
  ask: 'Ask',
  explore: 'Explore',
  change: 'Change',
  verify: 'Verify',
  repair: 'Repair',
  report: 'Report',
};

export interface Chapter {
  kind: PhaseKind;
  label: string;
  from: number;
  to: number;
  summary: string;
  segs: { kind: PhaseKind; len: number }[];
}

const LOOP = new Set<PhaseKind>(['change', 'verify', 'repair']);

/**
 * Phases as chapters. Three or more change/check phases in a row become one "Change ↔ check"
 * chapter, and on long runs chapters are grouped per instruction.
 */
export function chapters(phases: Phase[], steps: Step[]): Chapter[] {
  const base: Chapter[] = [];
  for (let i = 0; i < phases.length; ) {
    let j = i;
    while (j < phases.length && LOOP.has(phases[j].kind)) j++;
    if (j - i >= 3) {
      const group = phases.slice(i, j);
      const from = group[0].from;
      const to = group[group.length - 1].to;
      const span = steps.slice(from, to + 1);
      const files = new Set(span.filter((s) => s.edit && !outsideProject(s.edit.path)).map((s) => s.edit!.path)).size;
      const checks = span.filter((s) => s.command && isVerify(s.command.categories));
      const failed = checks.filter((s) => s.command!.failed || outputLooksFailed(s.command!.output)).length;
      const cycles = Math.max(1, group.filter((p) => p.kind === 'verify').length);
      base.push({
        kind: 'change',
        label: `Change ↔ check ×${cycles}`,
        from,
        to,
        summary: `${files ? `Edited ${files} project file${files === 1 ? '' : 's'}` : 'Worked in scratch files only'} and ran ${checks.length} check${checks.length === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`,
        segs: group.map((p) => ({ kind: p.kind, len: p.to - p.from + 1 })),
      });
      i = j;
    } else {
      const p = phases[i];
      base.push({ kind: p.kind, label: PHASE_TITLE[p.kind], from: p.from, to: p.to, summary: p.summary, segs: [{ kind: p.kind, len: p.to - p.from + 1 }] });
      i++;
    }
  }
  if (base.length <= 14) return base;
  const out: Chapter[] = [];
  let cur: Chapter | null = null;
  for (const c of base) {
    if (c.kind === 'ask' || !cur) {
      const prompt = steps[c.from]?.kind === 'prompt' ? steps[c.from] : undefined;
      cur = { kind: 'ask', label: `Instruction ${out.length + 1}`, from: c.from, to: c.to, summary: prompt ? prompt.title : c.summary, segs: [] };
      out.push(cur);
    }
    cur.to = c.to;
    cur.segs.push(...c.segs);
  }
  for (const c of out) {
    const edits = steps.slice(c.from, c.to + 1).filter((s) => s.edit && !outsideProject(s.edit.path)).length;
    const fails = steps.slice(c.from, c.to + 1).filter((s) => s.command?.failed).length;
    c.summary = `“${c.summary}” · ${c.to - c.from + 1} steps${edits ? `, ${edits} edits` : ''}${fails ? `, ${fails} failed` : ''}`;
  }
  return out;
}
