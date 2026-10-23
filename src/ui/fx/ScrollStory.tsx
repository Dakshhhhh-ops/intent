import { useEffect, useRef, useState } from 'react';

// A pinned section on Home: as you scroll through it, a 3D prism turns face by face to show
// how one log file becomes a verdict. Scroll position drives everything, so it works the same
// with reduced motion (it just snaps instead of easing).

const STEPS = [
  {
    k: 'Parse',
    title: 'Read the raw log',
    body: 'Claude Code or Codex JSONL: every message, tool call, file snapshot and exit code, parsed in your browser.',
  },
  {
    k: 'Rebuild',
    title: 'Lay out one timeline',
    body: 'Reads, edits and commands become a single tape with chapters: Explore, Change, Verify, Repair, Report.',
  },
  {
    k: 'Fact-check',
    title: 'Check every claim',
    body: '“All tests pass” is matched against the commands that actually ran, and stamped with the step that proves it.',
  },
  {
    k: 'Verdict',
    title: 'Hand over a verdict',
    body: 'A reviewer gets the findings that matter, ranked, with blame for every changed line. No AI, no account.',
  },
];

const BARS = 'rrererrvvfvrreeecvvrrvfferrvvcpvvrreevv';
const BAR_COLOR: Record<string, string> = {
  r: 'var(--read)',
  e: 'var(--edit)',
  v: 'var(--verify)',
  f: 'var(--fail)',
  c: 'var(--create)',
  p: 'var(--prompt)',
};

function FaceLog() {
  return (
    <div className="fx-face-body mono">
      <div className="fx-log">
        <span className="d">{'{'}</span>"type":"user","text":"Fix the cart rounding bug"<span className="d">{'}'}</span>
      </div>
      <div className="fx-log">
        <span className="d">{'{'}</span>"tool":"Read","path":"src/cart.js"<span className="d">{'}'}</span>
      </div>
      <div className="fx-log">
        <span className="d">{'{'}</span>"tool":"Edit","old":"Math.floor(", "new":"Math.round("<span className="d">{'}'}</span>
      </div>
      <div className="fx-log">
        <span className="d">{'{'}</span>"tool":"Bash","cmd":"npm test | tail -3"<span className="d">{'}'}</span>
      </div>
      <div className="fx-log hl">
        <span className="d">{'{'}</span>"exit":1,"out":"2 failing"<span className="d">{'}'}</span>
      </div>
      <div className="fx-log">
        <span className="d">{'{'}</span>"text":"All tests pass."<span className="d">{'}'}</span>
      </div>
    </div>
  );
}

function FaceTape() {
  return (
    <div className="fx-face-body">
      <div className="fx-chapters">
        {['Explore', 'Change', 'Verify', 'Repair', 'Report'].map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="fx-tape">
        {BARS.split('').map((b, i) => (
          <span key={i} style={{ background: BAR_COLOR[b], height: b === 'f' || b === 'e' ? '100%' : b === 'v' ? '72%' : '46%', ['--i' as string]: i }} />
        ))}
      </div>
      <div className="fx-legend">
        <i style={{ background: 'var(--read)' }} /> read <i style={{ background: 'var(--edit)' }} /> edit <i style={{ background: 'var(--verify)' }} /> command{' '}
        <i style={{ background: 'var(--fail)' }} /> failed
      </div>
    </div>
  );
}

function FaceClaim() {
  return (
    <div className="fx-face-body">
      <div className="fx-claim">
        <q>All tests pass.</q>
        <span className="fx-stamp bad">Contradicted</span>
        <small>Step 14 · npm test exited 1, hidden by | tail</small>
      </div>
      <div className="fx-claim">
        <q>Only changed cart.js.</q>
        <span className="fx-stamp good">Supported</span>
        <small>1 file changed</small>
      </div>
    </div>
  );
}

function FaceVerdict() {
  return (
    <div className="fx-face-body">
      <div className="fx-verdict">
        <span className="fx-dot" /> Needs review
      </div>
      <ul className="fx-findings">
        <li>
          <b className="h">high</b> Exit code masked by a pipe
        </li>
        <li>
          <b className="h">high</b> Finished on a failing test run
        </li>
        <li>
          <b className="m">med</b> Edited a file it never read
        </li>
      </ul>
    </div>
  );
}

const FACES = [FaceLog, FaceTape, FaceClaim, FaceVerdict];

export function ScrollStory() {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const travel = Math.max(1, r.height - innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / travel));
      el.style.setProperty('--p', p.toFixed(4));
      setActive(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length * 0.9999)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    };
  }, []);

  const jump = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const travel = el.offsetHeight - innerHeight;
    const top = el.getBoundingClientRect().top + scrollY;
    scrollTo({ top: top + travel * ((i + 0.5) / STEPS.length), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return (
    <section ref={ref} className="fx-story" aria-label="How Intent Replay works">
      <div className="fx-story-pin">
        <div className="fx-story-text">
          <span className="eyebrow">How it works</span>
          <h2>One log file in. A verdict out.</h2>
          <ol className="fx-story-steps">
            {STEPS.map((s, i) => (
              <li key={s.k} className={`fx-story-step ${i === active ? 'on' : ''} ${i < active ? 'done' : ''}`}>
                <button onClick={() => jump(i)} aria-current={i === active ? 'step' : undefined}>
                  <span className="n">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <b>{s.title}</b>
                    <span className="b">{s.body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="fx-stage" aria-hidden="true">
          <div className="fx-prism" style={{ ['--a' as string]: active }}>
            {FACES.map((F, i) => (
              <div key={i} className={`fx-face ${i === active ? 'on' : ''}`} style={{ ['--f' as string]: i }}>
                <div className="fx-face-head">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{STEPS[i].k}</span>
                </div>
                <F />
              </div>
            ))}
          </div>
          <div className="fx-floor" />
        </div>
      </div>
    </section>
  );
}
