import { useEffect, useMemo, useRef, useState } from 'react';
import type { Step } from '../core/types';
import { useRun } from './model';

// The tape: every step on four lanes, chapters as a colored band, findings as markers,
// and a playhead you can drag. X is step order (time compresses too much to read).

const LANES = [
  { id: 'talk', label: 'Talk' },
  { id: 'read', label: 'Read' },
  { id: 'change', label: 'Change' },
  { id: 'run', label: 'Run' },
] as const;

function laneOf(s: Step): number {
  switch (s.kind) {
    case 'prompt':
    case 'message':
    case 'thinking':
    case 'plan':
      return 0;
    case 'read':
    case 'search':
    case 'web':
      return 1;
    case 'edit':
    case 'create':
    case 'delete':
      return 2;
    default:
      return 3;
  }
}

function colorOf(s: Step): string {
  if (s.command?.failed || s.error) return 'var(--fail)';
  switch (s.kind) {
    case 'prompt':
      return 'var(--prompt)';
    case 'message':
    case 'thinking':
    case 'plan':
      return 'var(--talk)';
    case 'read':
    case 'search':
    case 'web':
      return 'var(--read)';
    case 'edit':
      return 'var(--edit)';
    case 'create':
      return 'var(--create)';
    case 'delete':
      return 'var(--fail)';
    default:
      return 'var(--verify)';
  }
}

const PHASE_COLOR: Record<string, string> = {
  ask: 'var(--prompt)',
  explore: 'var(--read)',
  change: 'var(--edit)',
  verify: 'var(--verify)',
  repair: 'var(--repair)',
  report: 'var(--create)',
};

const LEFT = 52;
const RIGHT = 8;
const TOP = 16;
const BAND = 5;
const LANE_H = 15;

export function Tape({ step, onStep }: { step: number; onStep: (s: number) => void }) {
  const run = useRun();
  const steps = run.trace.steps;
  const n = steps.length;
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(10, w - LEFT - RIGHT);
  const sw = inner / Math.max(1, n);
  const x = (i: number) => LEFT + (i + 0.5) * sw;
  const height = TOP + BAND + 6 + LANES.length * LANE_H + 4;
  const laneY = (l: number) => TOP + BAND + 6 + l * LANE_H;

  const marks = useMemo(
    () =>
      steps.map((s) => {
        const l = laneOf(s);
        return { id: s.id, l, c: colorOf(s), tall: s.kind === 'prompt' || !!s.edit || !!s.command?.failed };
      }),
    [steps],
  );

  const findingMarks = useMemo(() => {
    const out: { id: number; sev: string }[] = [];
    for (const [id, fs] of run.findingsByStep) {
      const sev = fs.some((f) => f.severity === 'high') ? 'high' : fs.some((f) => f.severity === 'medium') ? 'medium' : 'low';
      if (sev !== 'low') out.push({ id, sev });
    }
    return out;
  }, [run.findingsByStep]);

  const toStep = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - LEFT) / sw);
    return Math.min(n - 1, Math.max(0, i));
  };

  const hx = hover !== null ? x(hover) : 0;
  return (
    <div
      className="tape"
      ref={ref}
      role="slider"
      aria-label="Run timeline"
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={step + 1}
      aria-valuetext={`Step ${step + 1}: ${steps[step]?.title ?? ''}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          onStep(Math.min(n - 1, step + 1));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          onStep(Math.max(0, step - 1));
        }
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        onStep(toStep(e.clientX));
      }}
      onPointerMove={(e) => {
        const i = toStep(e.clientX);
        setHover(i);
        if (dragging.current) onStep(i);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => {
        setHover(null);
      }}
    >
      <svg height={height} width={w} role="presentation">
        {LANES.map((l, i) => (
          <g key={l.id}>
            <text className="lane-label" x={0} y={laneY(i) + LANE_H - 5}>
              {l.label}
            </text>
            <line x1={LEFT} x2={w - RIGHT} y1={laneY(i) + LANE_H / 2} y2={laneY(i) + LANE_H / 2} stroke="var(--border)" strokeWidth={1} />
          </g>
        ))}
        {run.analysis.phases.map((p, i) => (
          <rect key={i} x={LEFT + p.from * sw} y={TOP} width={Math.max(1, (p.to - p.from + 1) * sw - (sw > 3 ? 1 : 0))} height={BAND} rx={2} fill={PHASE_COLOR[p.kind]} opacity={0.75}>
            <title>{`${p.kind}: ${p.summary}`}</title>
          </rect>
        ))}
        {marks.map((m) => {
          const y = laneY(m.l);
          const h = m.tall ? LANE_H - 2 : LANE_H - 6;
          return (
            <rect
              key={m.id}
              x={LEFT + m.id * sw + (sw > 3 ? 0.5 : 0)}
              y={y + (LANE_H - h) / 2}
              width={Math.max(1, sw - (sw > 3 ? 1 : 0))}
              height={h}
              rx={sw > 4 ? 1.5 : 0}
              fill={m.c}
              opacity={m.id <= step ? 0.95 : 0.4}
            />
          );
        })}
        {findingMarks.map((f) => (
          <path key={f.id} d={`M${x(f.id) - 4} 2 L${x(f.id) + 4} 2 L${x(f.id)} 9 Z`} fill={f.sev === 'high' ? 'var(--high)' : 'var(--medium)'}>
            <title>{run.findingsByStep.get(f.id)?.map((x) => x.title).join('\n')}</title>
          </path>
        ))}
        {hover !== null && <line x1={hx} x2={hx} y1={TOP - 2} y2={height} stroke="var(--text-3)" strokeDasharray="2 3" />}
        <g style={{ transition: 'transform 0.12s ease-out' }} transform={`translate(${x(step)},0)`}>
          <line x1={0} x2={0} y1={TOP - 4} y2={height} stroke="var(--accent)" strokeWidth={2} />
          <circle cx={0} cy={TOP - 4} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        </g>
      </svg>
      {hover !== null && steps[hover] && (
        <div className="tape-tip" style={{ left: Math.min(Math.max(hx, 120), w - 120) }}>
          <span className="num" style={{ color: 'var(--text-3)' }}>
            #{hover + 1}
          </span>{' '}
          {steps[hover].title}
        </div>
      )}
    </div>
  );
}
