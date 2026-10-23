import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';

// An interactive terminal: pick a scenario, watch the command type itself and the output land.

type Line = { t: 'cmd' | 'out'; s: string; c?: 'dim' | 'ok' | 'bad' | 'warn' | 'acc' };

const SCENES: { id: string; label: string; title: string; lines: Line[] }[] = [
  {
    id: 'install',
    label: 'Install',
    title: 'One install, works offline',
    lines: [
      { t: 'cmd', s: 'npm i -g github:Dakshhhhh-ops/intent' },
      { t: 'out', s: 'added 1 package in 6s', c: 'dim' },
      { t: 'cmd', s: 'intent-replay --help' },
      { t: 'out', s: 'intent-replay — debug what an AI coding agent actually did', c: 'acc' },
      { t: 'out', s: '  list · open · watch · report · check · export', c: 'dim' },
    ],
  },
  {
    id: 'open',
    label: 'Replay',
    title: 'Finds your sessions for you',
    lines: [
      { t: 'cmd', s: 'intent-replay' },
      { t: 'out', s: 'Sessions for ~/code/shop', c: 'dim' },
      { t: 'out', s: '  1  claude  2m ago   Fix the cart total rounding bug' },
      { t: 'out', s: '  2  codex   1h ago   Add CSV export to orders' },
      { t: 'out', s: '● Intent Replay is running at http://127.0.0.1:4848/', c: 'ok' },
    ],
  },
  {
    id: 'check',
    label: 'CI gate',
    title: 'Fail the build on a lie',
    lines: [
      { t: 'cmd', s: 'intent-replay check latest --fail-on high' },
      { t: 'out', s: '■ Needs review  5 high, 1 medium findings', c: 'bad' },
      { t: 'out', s: '  contradicted  “All tests pass.”', c: 'bad' },
      { t: 'out', s: '  high   Tests in cart.test.js were weakened', c: 'warn' },
      { t: 'out', s: '  medium Edited discount.js without reading it first', c: 'warn' },
      { t: 'out', s: '✗ 5 findings at or above "high".   exit 1', c: 'bad' },
    ],
  },
  {
    id: 'watch',
    label: 'Live',
    title: 'Watch while the agent works',
    lines: [
      { t: 'cmd', s: 'intent-replay watch' },
      { t: 'out', s: '● Following “Fix the cart total rounding bug”', c: 'acc' },
      { t: 'out', s: '  step 10  npm test ................ exit 1', c: 'bad' },
      { t: 'out', s: '  step 14  edit test/cart.test.js .. weakened', c: 'warn' },
      { t: 'out', s: '  claims are checked the moment they are made', c: 'dim' },
    ],
  },
  {
    id: 'export',
    label: 'Share',
    title: 'One offline file for the reviewer',
    lines: [
      { t: 'cmd', s: 'intent-replay report latest --out pr-comment.md' },
      { t: 'out', s: '✓ wrote pr-comment.md', c: 'ok' },
      { t: 'cmd', s: 'intent-replay export latest -o replay.html' },
      { t: 'out', s: '✓ wrote replay.html (self-contained, secrets masked)', c: 'ok' },
    ],
  },
];

export function TerminalDemo() {
  const [scene, setScene] = useState(0);
  const [typed, setTyped] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const cur = SCENES[scene];
  const total = cur.lines.reduce((n, l) => n + (l.t === 'cmd' ? l.s.length + 8 : 14), 0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    setTyped(matchMedia('(prefers-reduced-motion: reduce)').matches ? 1e6 : 0);
  }, [scene]);

  useEffect(() => {
    if (!visible) return;
    if (typed < total) {
      const id = setTimeout(() => setTyped((t) => t + 1), 28);
      return () => clearTimeout(id);
    }
    if (pinned) return;
    const id = setTimeout(() => setScene((s) => (s + 1) % SCENES.length), 3600);
    return () => clearTimeout(id);
  }, [typed, total, visible, pinned]);

  let budget = typed;
  const rendered = cur.lines.map((l, i) => {
    if (budget <= 0) return null;
    if (l.t === 'cmd') {
      const n = Math.min(l.s.length, budget);
      budget -= l.s.length + 8;
      return (
        <div key={i} className="td-line cmd">
          <span className="td-ps">❯</span> {l.s.slice(0, n)}
          {n < l.s.length && <span className="td-caret" />}
        </div>
      );
    }
    budget -= 14;
    return (
      <div key={i} className={`td-line out ${l.c ?? ''}`}>
        {l.s}
      </div>
    );
  });
  const firstCmd = cur.lines.find((l) => l.t === 'cmd')?.s ?? '';

  return (
    <div className="td" ref={box}>
      <div className="td-tabs" role="tablist" aria-label="Command line examples">
        {SCENES.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={i === scene}
            onClick={() => {
              setScene(i);
              setPinned(true);
            }}
          >
            <span className="td-tab-n">0{i + 1}</span>
            <span className="td-tab-l">{s.label}</span>
            <span className="td-tab-t">{s.title}</span>
            {i === scene && !pinned && <span className="td-tab-bar" style={{ animationDuration: `${total * 28 + 3600}ms` }} key={scene} />}
          </button>
        ))}
      </div>
      <div className="td-window">
        <div className="td-bar">
          <span className="td-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="td-title">~/code/shop — intent-replay</span>
          <button
            className="td-copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(firstCmd);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked */
              }
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="td-body" aria-live="polite">
          {rendered}
          {typed >= total && (
            <div className="td-line cmd">
              <span className="td-ps">❯</span> <span className="td-caret" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
