import { useEffect, useRef, useState } from 'react';

// An instrument panel: machined gauges whose needles sweep up when scrolled into view.

interface G {
  value: number;
  max: number;
  unit: string;
  label: string;
  sub: string;
  ticks: string[];
}

const GAUGES: G[] = [
  { value: 12, max: 12, unit: '', label: 'Checks', sub: 'on every run', ticks: ['0', '4', '8', '12'] },
  { value: 2, max: 3, unit: '', label: 'Agents', sub: 'Claude Code · Codex CLI', ticks: ['0', '1', '2', '3'] },
  { value: 530, max: 600, unit: 'MB', label: 'Largest log', sub: 'real session, opens in seconds', ticks: ['0', '200', '400', '600'] },
  { value: 0, max: 100, unit: 'B', label: 'Uploaded', sub: 'everything stays on your machine', ticks: ['0', '', '', ''] },
];

const START = -225;
const SWEEP = 270;

function polar(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
}

function Gauge({ g, on, delay }: { g: G; on: boolean; delay: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!on) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setV(g.value);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / 1600));
      // overshoot a little, like a real needle
      const e = k < 1 ? 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.06 : 1;
      setV(g.value * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, g.value, delay]);

  const frac = g.max ? v / g.max : 0;
  const ang = START + SWEEP * Math.min(1.03, frac);
  const [nx, ny] = polar(70, ang);
  const ticks = Array.from({ length: 41 }, (_, i) => {
    const d = START + (SWEEP * i) / 40;
    const major = i % 10 === 0;
    const [x1, y1] = polar(major ? 74 : 79, d);
    const [x2, y2] = polar(86, d);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'gt-major' : 'gt-minor'} />;
  });
  const arcEnd = polar(86, START + SWEEP * Math.min(1, frac));
  const [ax, ay] = polar(86, START);
  const large = SWEEP * Math.min(1, frac) > 180 ? 1 : 0;

  return (
    <div className="gauge">
      <span className="gauge-screw tl" />
      <span className="gauge-screw tr" />
      <span className="gauge-screw bl" />
      <span className="gauge-screw br" />
      <svg viewBox="0 0 200 200" className="gauge-svg" aria-hidden="true">
        <defs>
          <radialGradient id="gface" cx="50%" cy="40%" r="65%">
            <stop offset="0" stopColor="#1d1e22" />
            <stop offset="1" stopColor="#0b0c0e" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" className="g-bezel" />
        <circle cx="100" cy="100" r="90" fill="url(#gface)" />
        {frac > 0.001 && <path d={`M ${ax} ${ay} A 86 86 0 ${large} 1 ${arcEnd[0]} ${arcEnd[1]}`} className="g-arc" />}
        {ticks}
        {g.ticks.map((t, i) => {
          const [x, y] = polar(60, START + (SWEEP * i) / (g.ticks.length - 1));
          return t ? (
            <text key={i} x={x} y={y} className="g-num" textAnchor="middle" dominantBaseline="middle">
              {t}
            </text>
          ) : null;
        })}
        <line x1="100" y1="100" x2={nx} y2={ny} className="g-needle" />
        <circle cx="100" cy="100" r="8" className="g-hub" />
        <circle cx="100" cy="100" r="3" fill="#ff801f" />
      </svg>
      <div className="gauge-read">
        <b>
          {Math.round(v)}
          {g.unit && <small> {g.unit}</small>}
        </b>
        <span className="gauge-label">{g.label}</span>
        <span className="gauge-sub">{g.sub}</span>
      </div>
    </div>
  );
}

export function Gauges() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setOn(true), io.disconnect()), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="gauges" ref={ref}>
      {GAUGES.map((g, i) => (
        <Gauge key={g.label} g={g} on={on} delay={i * 180} />
      ))}
    </div>
  );
}
