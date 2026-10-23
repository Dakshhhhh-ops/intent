import { useEffect, useRef, useState } from 'react';

// Boot sequence: a counter, the run's tape filling block by block, a short boot log,
// then the screen splits open onto the hero.

const LOG = ['Mounting flight recorder', 'Rewinding the tape', 'Parsing 17 steps', 'Checking claims against the log', 'Ready'];

export function Preloader({ colors, onDone }: { colors: string[]; onDone: () => void }) {
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setGone(true);
      onDone();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    // Honest timing: as long as the fonts take, never less than a beat. The 3D scene starts later.
    const MIN = 700;
    let assetsReady = false;
    (document.fonts?.ready ?? Promise.resolve()).then(() => (assetsReady = true));
    const finish = () => {
      if (done.current) return;
      done.current = true;
      setPct(1);
      setTimeout(() => setLeaving(true), 80);
      setTimeout(() => onDone(), 260);
      setTimeout(() => setGone(true), 1100);
    };
    const skip = () => finish();
    addEventListener('pointerdown', skip, { once: true });
    addEventListener('keydown', skip, { once: true });
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / MIN);
      // Never hold the page: after 1.2s the hero shows even if the 3D scene is still warming up.
      const target = assetsReady || t - t0 > 1200 ? k : Math.min(0.9, k);
      setPct(target);
      if (target >= 1) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('pointerdown', skip);
      removeEventListener('keydown', skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;
  const n = colors.length;
  const lit = Math.floor(pct * n);
  const logShown = Math.min(LOG.length, Math.floor(pct * LOG.length) + 1);

  return (
    <div className={`pre ${leaving ? 'leaving' : ''}`} role="status" aria-label={`Loading ${Math.round(pct * 100)} percent`}>
      <div className="pre-half top" />
      <div className="pre-half bottom" />
      <div className="pre-content">
        <div className="pre-head">
          <span>Intent Replay</span>
          <span>Agent flight recorder · S/N IR-0001</span>
        </div>
        <div className="pre-tape" aria-hidden="true">
          {colors.map((c, i) => (
            <i key={i} style={{ background: i < lit ? c : undefined }} className={i < lit ? 'lit' : i === lit ? 'cur' : ''} />
          ))}
        </div>
        <div className="pre-foot">
          <ul className="pre-log">
            {LOG.slice(0, logShown).map((l, i) => (
              <li key={l} className={i === logShown - 1 && pct < 1 ? 'cur' : ''}>
                <span>{i === logShown - 1 && pct < 1 ? '›' : '✓'}</span> {l}
              </li>
            ))}
          </ul>
          <div className="pre-pct">
            {String(Math.round(pct * 100)).padStart(3, '0')}
            <small>%</small>
          </div>
        </div>
      </div>
    </div>
  );
}
