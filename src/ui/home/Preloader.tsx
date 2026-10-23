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
    const MIN = 2300;
    let assetsReady = false;
    Promise.all([document.fonts?.ready ?? Promise.resolve(), import('../fx3d/cine')]).then(() => (assetsReady = true));
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / MIN);
      // ease with a couple of "hitches" so it feels like real work
      const eased = k < 0.35 ? k * 1.4 : k < 0.6 ? 0.49 + (k - 0.35) * 0.6 : 0.64 + (k - 0.6) * 0.9;
      const target = assetsReady ? Math.min(1, eased) : Math.min(0.92, eased);
      setPct(target);
      if (target >= 1) {
        if (!done.current) {
          done.current = true;
          setTimeout(() => setLeaving(true), 250);
          setTimeout(() => onDone(), 650);
          setTimeout(() => setGone(true), 1500);
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
