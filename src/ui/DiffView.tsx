import { diffArrays } from 'diff';
import type { DiffLine, EditInfo, PhaseKind, Step } from '../core/types';
import { splitLines } from '../core/util';

/** Diff lines for a single edit step, best effort from whatever the log recorded. */
export function stepDiff(e: EditInfo, stepId: number): DiffLine[] {
  if (e.patch) {
    const out: DiffLine[] = [];
    let o = 0;
    let n = 0;
    for (const l of e.patch.split('\n')) {
      const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (h) {
        o = Number(h[1]);
        n = Number(h[2]);
        out.push({ type: 'hunk', text: l, step: null });
        continue;
      }
      if (l.startsWith('@@')) {
        out.push({ type: 'hunk', text: l, step: null });
        continue;
      }
      if (l.startsWith('+')) out.push({ type: 'add', text: l.slice(1), step: stepId, newNo: n ? n++ : undefined });
      else if (l.startsWith('-')) out.push({ type: 'del', text: l.slice(1), step: stepId, oldNo: o ? o++ : undefined });
      else out.push({ type: 'ctx', text: l.startsWith(' ') ? l.slice(1) : l, step: null, oldNo: o ? o++ : undefined, newNo: n ? n++ : undefined });
    }
    return out;
  }
  if (e.edits?.length) {
    const out: DiffLine[] = [];
    e.edits.forEach((ed, i) => {
      if (e.edits!.length > 1) out.push({ type: 'hunk', text: `change ${i + 1} of ${e.edits!.length}${ed.replaceAll ? ' (all occurrences)' : ''}`, step: null });
      for (const ch of diffArrays(splitLines(ed.oldString), splitLines(ed.newString))) {
        for (const v of ch.value) out.push({ type: ch.added ? 'add' : ch.removed ? 'del' : 'ctx', text: v, step: ch.added || ch.removed ? stepId : null });
      }
    });
    return out;
  }
  if (e.after !== undefined) {
    const before = e.before !== undefined ? splitLines(e.before) : [];
    const out: DiffLine[] = [];
    let o = 1;
    let n = 1;
    for (const ch of diffArrays(before, splitLines(e.after))) {
      for (const v of ch.value) {
        if (ch.added) out.push({ type: 'add', text: v, step: stepId, newNo: n++ });
        else if (ch.removed) out.push({ type: 'del', text: v, step: stepId, oldNo: o++ });
        else out.push({ type: 'ctx', text: v, step: null, oldNo: o++, newNo: n++ });
      }
    }
    return e.before !== undefined ? trimContext(out, 4) : out;
  }
  return [];
}

function trimContext(lines: DiffLine[], n: number): DiffLine[] {
  const keep = lines.map((l) => l.type !== 'ctx');
  const out: DiffLine[] = [];
  let gap = false;
  lines.forEach((l, i) => {
    let near = keep[i];
    for (let k = Math.max(0, i - n); !near && k <= Math.min(lines.length - 1, i + n); k++) near = keep[k];
    if (near) {
      if (gap) out.push({ type: 'hunk', text: '⋯', step: null });
      out.push(l);
      gap = false;
    } else gap = true;
  });
  return out;
}

export interface BlameInfo {
  steps: Step[];
  phaseOf: (id: number) => PhaseKind;
}

export function DiffView({
  lines,
  blame,
  selected,
  onSelect,
  highlightStep,
  max = 4000,
}: {
  lines: DiffLine[];
  blame?: BlameInfo;
  selected?: number | null;
  onSelect?: (index: number, line: DiffLine) => void;
  highlightStep?: number | null;
  max?: number;
}) {
  const shown = lines.slice(0, max);
  let prevStep: number | null | undefined;
  return (
    <div className="diff" style={blame ? ({ '--blame-w': '190px' } as React.CSSProperties) : undefined} role="table" aria-label="Diff">
      {shown.map((l, i) => {
        if (l.type === 'hunk') {
          prevStep = undefined;
          return (
            <div key={i} className="diff-line hunk" role="row">
              <span className="tx">{l.text}</span>
            </div>
          );
        }
        const clickable = !!onSelect && l.type !== 'ctx' && l.step !== null;
        const first = l.step !== prevStep;
        prevStep = l.step;
        const st = blame && l.step !== null && l.step >= 0 ? blame.steps[l.step] : undefined;
        return (
          <div
            key={i}
            role="row"
            className={`diff-line ${l.type} ${clickable ? 'selectable' : ''} ${selected === i ? 'selected' : ''} ${highlightStep !== null && highlightStep !== undefined && l.step === highlightStep && l.type !== 'ctx' ? 'same-step' : ''}`}
            onClick={clickable ? () => onSelect!(i, l) : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect!(i, l)) : undefined}
          >
            {blame ? (
              <span className={`blame ${first ? 'first' : ''} ${st ? `phase-${blame.phaseOf(st.id)}` : ''}`} title={st ? `Step ${st.id + 1}: ${st.title}` : l.step === -1 ? 'Changed outside the agent' : 'Already in the file'}>
                <span className="bar" />
                <span className="who">{first ? (st ? `#${st.id + 1} ${st.intent ? firstWords(st.intent) : st.title}` : l.step === -1 ? 'outside the agent' : l.type === 'del' ? '' : '') : ''}</span>
              </span>
            ) : (
              <span />
            )}
            <span className="ln num">{l.oldNo ?? ''}</span>
            <span className="ln num">{l.newNo ?? ''}</span>
            <span className="sg">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
            <span className="tx">{l.text || ' '}</span>
          </div>
        );
      })}
      {lines.length > max && <div className="note">{lines.length - max} more lines not shown.</div>}
    </div>
  );
}

function firstWords(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
}
