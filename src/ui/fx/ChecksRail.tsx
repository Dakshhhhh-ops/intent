import { useEffect, useRef, useState } from 'react';

// "What it catches": the twelve deterministic checks as a 3D cover-flow. On wide screens the
// section pins and vertical scrolling slides the rail sideways; on phones it is a swipeable row.

const CHECKS: { t: string; d: string; ex: string; c: string }[] = [
  { t: 'Contradicted claims', d: 'Says “all tests pass” when the log shows they did not.', ex: 'npm test → exit 1', c: 'var(--fail)' },
  { t: 'Masked exit codes', d: 'A failing check piped through tail or grep so it looks like a pass.', ex: 'npm test | tail -5', c: 'var(--fail)' },
  { t: 'Weakened tests', d: 'Assertions deleted or loosened until a failing test goes green.', ex: '- expect(total).toBe(9.99)', c: 'var(--fail)' },
  { t: 'Blind edits', d: 'Changed a file it never opened first.', ex: 'Edit cart.js · 0 reads', c: 'var(--edit)' },
  { t: 'Failure loops', d: 'The same command failing again and again without a new idea.', ex: '✗ ✗ ✗ ✗ npm test', c: 'var(--edit)' },
  { t: 'Silenced errors', d: 'Errors caught and swallowed instead of fixed.', ex: 'catch (e) {}', c: 'var(--edit)' },
  { t: 'Risky commands', d: 'Force pushes, hard resets, sudo, piping a download into a shell.', ex: 'git push --force', c: 'var(--fail)' },
  { t: 'Leaked secrets', d: 'API keys and tokens written into files or printed in output.', ex: 'sk-live-••••••••', c: 'var(--fail)' },
  { t: 'New dependencies', d: 'Packages added to the project along the way.', ex: '+ "left-pad": "^1.3.0"', c: 'var(--read)' },
  { t: 'Churn', d: 'Rewriting its own changes in the same file over and over.', ex: 'cart.js · 7 edits', c: 'var(--read)' },
  { t: 'Sensitive files', d: 'CI workflows, lockfiles, env and infra config touched.', ex: '.github/workflows/ci.yml', c: 'var(--prompt)' },
  { t: 'Unverified finish', d: 'Changed code after the last check, then called it done.', ex: 'edit → “Done!”', c: 'var(--prompt)' },
];

export function ChecksRail() {
  const sec = useRef<HTMLElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const s = sec.current,
      v = view.current,
      t = track.current;
    if (!s || !v || !t) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const pinned = innerWidth >= 760;
      if (pinned) {
        const r = s.getBoundingClientRect();
        const travel = Math.max(1, s.offsetHeight - innerHeight);
        const p = Math.min(1, Math.max(0, -r.top / travel));
        const max = Math.max(0, t.scrollWidth - v.clientWidth);
        t.style.transform = `translate3d(${(-p * max).toFixed(1)}px,0,0)`;
        s.style.setProperty('--p', p.toFixed(4));
      } else {
        t.style.transform = '';
      }
      // Each card leans away from the center of the view by how far it sits from it.
      const vr = v.getBoundingClientRect();
      const mid = vr.left + vr.width / 2;
      let best = 0,
        bestD = Infinity;
      Array.from(t.children).forEach((el, i) => {
        const cr = (el as HTMLElement).getBoundingClientRect();
        const d = Math.max(-1.6, Math.min(1.6, (cr.left + cr.width / 2 - mid) / (vr.width / 2)));
        (el as HTMLElement).style.setProperty('--d', d.toFixed(3));
        (el as HTMLElement).style.setProperty('--ad', Math.abs(d).toFixed(3));
        if (Math.abs(d) < bestD) {
          bestD = Math.abs(d);
          best = i;
        }
      });
      setCurrent(best);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    v.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('scroll', on);
      removeEventListener('resize', on);
      v.removeEventListener('scroll', on);
    };
  }, []);

  return (
    <section ref={sec} className="fx-rail" aria-labelledby="fx-rail-h">
      <div className="fx-rail-pin">
        <div className="fx-rail-head">
          <div>
            <span className="eyebrow">What it catches</span>
            <h2 id="fx-rail-h">Twelve checks a reviewer would want to run by hand.</h2>
          </div>
          <div className="fx-rail-count mono" aria-hidden="true">
            <b>{String(current + 1).padStart(2, '0')}</b> / {CHECKS.length}
            <span className="fx-rail-bar">
              <i />
            </span>
          </div>
        </div>
        <div ref={view} className="fx-rail-view">
          <div ref={track} className="fx-rail-track">
            {CHECKS.map((c, i) => (
              <article key={c.t} className={`fx-check ${i === current ? 'on' : ''}`} style={{ ['--c' as string]: c.c }}>
                <span className="fx-check-n mono">{String(i + 1).padStart(2, '0')}</span>
                <h3>{c.t}</h3>
                <p>{c.d}</p>
                <code>{c.ex}</code>
              </article>
            ))}
          </div>
        </div>
        <p className="fx-rail-note">Plain rules over the log. No AI, so the same run always gets the same findings.</p>
      </div>
    </section>
  );
}
