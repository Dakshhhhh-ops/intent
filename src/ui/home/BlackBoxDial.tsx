import { useEffect, useMemo, useRef, useState } from 'react';
import type { Claim, Phase, PhaseKind, Step } from '../../core/types';

// The hero instrument: a flight-recorder dial built from a real run.
// Outer arcs = chapters, tick ring = every step coloured by kind, the needle sweeps the run,
// and when it reaches the end the agent's claim gets stamped.

const PHASE_COLOR: Record<PhaseKind, string> = {
  ask: '#e796f3',
  explore: '#70b8ff',
  change: '#ffc53d',
  verify: '#0bd8b6',
  repair: '#ff801f',
  report: '#1fd8a4',
};

function stepColor(s: Step): string {
  if (s.command?.failed || s.error) return '#ec5d5e';
  switch (s.kind) {
    case 'read':
    case 'search':
      return '#70b8ff';
    case 'edit':
      return '#ffc53d';
    case 'create':
      return '#1fd8a4';
    case 'command':
      return '#0bd8b6';
    case 'prompt':
      return '#e796f3';
    default:
      return '#5a6169';
  }
}

const KIND_LABEL: Record<string, string> = {
  prompt: 'TASK',
  message: 'SAID',
  thinking: 'THOUGHT',
  read: 'READ',
  search: 'SEARCH',
  edit: 'EDIT',
  create: 'CREATE',
  command: 'RUN',
  plan: 'PLAN',
  web: 'WEB',
  tool: 'TOOL',
  subagent: 'AGENT',
  delete: 'DELETE',
};

const SIZE = 600;
const C = SIZE / 2;
const SWEEP_MS = 9000;
const HOLD_MS = 3800;

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};

function arc(r: number, from: number, to: number): string {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function BlackBoxDial({ steps, phases, claim, onOpen }: { steps: Step[]; phases: Phase[]; claim?: Claim; onOpen?: () => void }) {
  const n = Math.max(1, steps.length);
  const [progress, setProgress] = useState(0); // 0..1 sweep, >1 = holding the verdict
  const paused = useRef(false);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1.2);
      return;
    }
    let raf = 0;
    let t0 = performance.now();
    let pausedAt = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (paused.current) {
        if (!pausedAt) pausedAt = t;
        return;
      }
      if (pausedAt) {
        t0 += t - pausedAt;
        pausedAt = 0;
      }
      const e = t - t0;
      if (e > SWEEP_MS + HOLD_MS) t0 = t;
      setProgress(e <= SWEEP_MS ? e / SWEEP_MS : 1 + (e - SWEEP_MS) / HOLD_MS);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sweep = Math.min(1, progress);
  const angle = sweep * 360;
  const current = Math.min(n - 1, Math.floor(sweep * n));
  const step = steps[current];
  const done = progress >= 1;

  const ticks = useMemo(() => {
    const out: { deg: number; color: string; major: boolean; idx: number }[] = [];
    const total = 144;
    for (let i = 0; i < total; i++) {
      const idx = Math.min(n - 1, Math.floor((i / total) * n));
      const s = steps[idx];
      const first = Math.floor(((i - 1) / total) * n) !== idx;
      out.push({ deg: (i / total) * 360, color: stepColor(s), major: first, idx });
    }
    return out;
  }, [steps, n]);

  return (
    <div
      className={`bbd ${done ? 'done' : ''}`}
      onPointerEnter={() => (paused.current = true)}
      onPointerLeave={() => (paused.current = false)}
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => e.key === 'Enter' && onOpen?.()}
      aria-label="A sample agent run, replayed on a dial. Opens the run."
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="bbd-svg" aria-hidden="true">
        <defs>
          <radialGradient id="bbd-face" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#17181c" />
            <stop offset="70%" stopColor="#0c0d10" />
            <stop offset="100%" stopColor="#08090a" />
          </radialGradient>
          <filter id="bbd-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="bbd-needle" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff801f" stopOpacity="0" />
            <stop offset="1" stopColor="#ff801f" />
          </linearGradient>
        </defs>

        <circle cx={C} cy={C} r={286} fill="none" stroke="rgba(255,255,255,0.06)" />
        <circle cx={C} cy={C} r={270} fill="url(#bbd-face)" stroke="rgba(255,255,255,0.08)" />

        {/* chapters */}
        <g filter="url(#bbd-glow)">
          {phases.map((p, i) => {
            const from = (p.from / n) * 360 + 1.2;
            const to = ((p.to + 1) / n) * 360 - 1.2;
            if (to <= from || angle <= from + 0.5) return null;
            return <path key={i} d={arc(254, from, Math.min(to, angle))} stroke={PHASE_COLOR[p.kind]} strokeWidth={5} fill="none" strokeLinecap="round" />;
          })}
        </g>
        {phases.map((p, i) => {
          const from = (p.from / n) * 360 + 1.2;
          const to = ((p.to + 1) / n) * 360 - 1.2;
          return to > from ? <path key={`g${i}`} d={arc(254, from, to)} stroke={PHASE_COLOR[p.kind]} strokeOpacity={0.18} strokeWidth={5} fill="none" strokeLinecap="round" /> : null;
        })}

        {/* step ticks */}
        {ticks.map((t, i) => {
          const passed = t.deg <= angle;
          const [x1, y1] = polar(t.major ? 222 : 228, t.deg);
          const [x2, y2] = polar(238, t.deg);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={passed ? t.color : 'rgba(255,255,255,0.13)'} strokeWidth={t.major ? 2.2 : 1.2} strokeLinecap="round" />;
        })}

        {/* inner rings */}
        <circle cx={C} cy={C} r={204} fill="none" stroke="rgba(255,255,255,0.07)" strokeDasharray="2 6" className="bbd-spin" />
        <circle cx={C} cy={C} r={150} fill="none" stroke="rgba(255,255,255,0.05)" />

        {/* degree labels */}
        {[0, 90, 180, 270].map((d) => {
          const [x, y] = polar(214, d);
          return (
            <text key={d} x={x} y={y} className="bbd-deg" textAnchor="middle" dominantBaseline="middle">
              {String(Math.round((d / 360) * n) + 1).padStart(2, '0')}
            </text>
          );
        })}

        {/* needle */}
        <g transform={`rotate(${angle} ${C} ${C})`}>
          <line x1={C} y1={C - 160} x2={C} y2={C - 262} stroke="url(#bbd-needle)" strokeWidth={2} />
          <circle cx={C} cy={C - 262} r={5} fill="#ff801f" filter="url(#bbd-glow)" />
        </g>
      </svg>

      <div className="bbd-center">
        {!done && step ? (
          <>
            <div className="bbd-count">
              STEP {String(current + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
            </div>
            <div className="bbd-kind" style={{ color: stepColor(step) }}>
              {KIND_LABEL[step.kind] ?? step.kind.toUpperCase()}
              {step.command?.failed ? ' · FAILED' : ''}
            </div>
            <div className="bbd-title">{step.title}</div>
          </>
        ) : (
          <>
            <div className="bbd-count">THE AGENT SAID</div>
            <div className="bbd-claim">“{claim ? claim.text.replace(/`/g, '') : 'All tests pass.'}”</div>
            <span className="bbd-stamp">{claim ? claim.verdict : 'contradicted'}</span>
          </>
        )}
      </div>
    </div>
  );
}
