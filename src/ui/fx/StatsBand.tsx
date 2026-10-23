import { useEffect, useRef, useState } from 'react';

// A row of numbers that count up and flip in when scrolled into view.

const STATS: { n: number; suffix?: string; k: string }[] = [
  { n: 12, k: 'checks on every run' },
  { n: 4, k: 'verdicts a claim can get' },
  { n: 2, k: 'agents: Claude Code and Codex' },
  { n: 0, suffix: ' bytes', k: 'uploaded anywhere' },
];

function useCount(target: number, run: boolean, delay: number) {
  const [v, setV] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setV(target);
      return;
    }
    setV(0);
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / 1100));
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, delay]);
  return v;
}

function Tile({ s, i, on }: { s: (typeof STATS)[number]; i: number; on: boolean }) {
  const v = useCount(s.n, on, i * 120);
  return (
    <div className={`fx-stat ${on ? 'on' : ''}`} style={{ ['--i' as string]: i }}>
      <div className="fx-stat-v num">
        {on ? v : s.n}
        {s.suffix && <small>{s.suffix}</small>}
      </div>
      <div className="fx-stat-k">{s.k}</div>
    </div>
  );
}

export function StatsBand() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="fx-stats">
      {STATS.map((s, i) => (
        <Tile key={s.k} s={s} i={i} on={on} />
      ))}
    </div>
  );
}
