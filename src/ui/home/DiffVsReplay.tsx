import { useEffect, useRef, useState } from 'react';
import type { Analysis, DiffLine, Trace } from '../../core/types';
import { Icon } from '../Icon';
import { Rich } from '../Rich';

// The pitch in one component: drag the divider. Left of it is the diff you normally review;
// right of it is the same diff as Intent Replay shows it — who wrote each line, why, and what
// the agent claimed afterwards.

interface Row {
  kind: 'file' | 'add' | 'del' | 'ctx';
  text: string;
  path?: string;
  step?: number | null;
}

function rowsOf(analysis: Analysis): Row[] {
  const out: Row[] = [];
  for (const f of analysis.files) {
    out.push({ kind: 'file', text: f.path, path: f.path });
    const lines = f.diff.filter((l: DiffLine) => l.type !== 'hunk');
    const changed = lines.map((l, i) => (l.type === 'ctx' ? -1 : i)).filter((i) => i >= 0);
    const keep = new Set<number>();
    for (const i of changed) for (let k = i - 1; k <= i + 1; k++) keep.add(k);
    lines.forEach((l, i) => {
      if (keep.has(i)) out.push({ kind: l.type as Row['kind'], text: l.text, step: l.step });
    });
  }
  return out.slice(0, 26);
}

export function DiffVsReplay({ trace, analysis }: { trace: Trace; analysis: Analysis }) {
  const box = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(62);
  const [hinted, setHinted] = useState(false);
  const dragging = useRef(false);
  const rows = rowsOf(analysis);
  const claim = analysis.claims.find((c) => c.kind === 'tests-pass' && c.verdict === 'contradicted') ?? analysis.claims[0];
  const findingFor = (path: string) => analysis.findings.find((f) => f.files.includes(path));

  // A small automatic sweep the first time it scrolls into view, so people know it moves.
  useEffect(() => {
    const el = box.current;
    if (!el || hinted || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setHinted(true);
        const t0 = performance.now();
        const anim = (t: number) => {
          if (dragging.current) return;
          const k = Math.min(1, (t - t0) / 2200);
          setX(62 - Math.sin(k * Math.PI) * 30);
          if (k < 1) requestAnimationFrame(anim);
        };
        requestAnimationFrame(anim);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hinted]);

  const setFrom = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    setX(Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100)));
  };

  const pane = (rich: boolean) => (
    <div className={`dvr-pane ${rich ? 'rich' : 'plain'}`} aria-hidden={!rich}>
      <div className="dvr-head">
        {rich ? (
          <>
            <span className="dvr-badge">Intent Replay</span>
            {claim && (
              <span className="dvr-claim">
                Agent said <q>{claim.text.replace(/`/g, '').slice(0, 42)}</q>
                <span className="dvr-stamp">{claim.verdict}</span>
              </span>
            )}
          </>
        ) : (
          <>
            <span className="dvr-badge plain">git diff</span>
            <span className="dvr-plain-msg">“Fixed the rounding bug. All tests pass.” ✓</span>
          </>
        )}
      </div>
      <div className="dvr-body">
        {rows.map((r, i) => {
          if (r.kind === 'file') {
            const f = analysis.files.find((x) => x.path === r.path)!;
            const fd = findingFor(r.path!);
            return (
              <div key={i} className="dvr-file">
                <span>{rich ? r.text : `diff --git a/${r.text} b/${r.text}`}</span>
                {rich && (
                  <span className="dvr-file-meta">
                    {f.reads.length && f.reads[0] < f.edits[0] ? (
                      <span className="ok">
                        <Icon name="check" size={11} /> read first
                      </span>
                    ) : (
                      <span className="bad">
                        <Icon name="alert" size={11} /> never read
                      </span>
                    )}
                    {fd && <span className="bad">{fd.rule === 'weakened-tests' ? 'weakened after a failing run' : fd.rule === 'blind-edit' ? 'blind edit' : fd.rule}</span>}
                  </span>
                )}
              </div>
            );
          }
          const st = r.step !== null && r.step !== undefined && r.step >= 0 ? trace.steps[r.step] : undefined;
          return (
            <div key={i} className={`dvr-line ${r.kind}`}>
              {rich && <span className="dvr-blame">{st && r.kind !== 'ctx' ? `#${st.id + 1}` : ''}</span>}
              <span className="dvr-sg">{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}</span>
              <span className="dvr-tx">{r.text || ' '}</span>
              {rich && st && r.kind === 'add' && st.intent && (
                <span className="dvr-why">
                  <Rich text={st.intent.length > 64 ? st.intent.slice(0, 62) + '…' : st.intent} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className="dvr"
      ref={box}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setFrom(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && setFrom(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
    >
      <div className="dvr-labels" aria-hidden="true">
        <span>What you review</span>
        <span>What actually happened</span>
      </div>
      <div className="dvr-stack">
        {pane(false)}
        <div className="dvr-over" style={{ clipPath: `inset(0 0 0 ${x}%)` }}>
          {pane(true)}
        </div>
        <div className="dvr-handle" style={{ left: `${x}%` }}>
          <span
            className="dvr-knob"
            role="slider"
            tabIndex={0}
            aria-label="Compare the plain diff with the replay"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(x)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setX((v) => Math.max(4, v - 4));
              if (e.key === 'ArrowRight') setX((v) => Math.min(96, v + 4));
            }}
          >
            <Icon name="prev" size={14} />
            <Icon name="next" size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}
