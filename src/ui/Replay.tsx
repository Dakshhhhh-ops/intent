import { useEffect, useMemo, useRef, useState } from 'react';
import type { Step } from '../core/types';
import { ContextPanel } from './ContextPanel';
import { Icon, KIND_ICON } from './Icon';
import { Inspector } from './Inspector';
import { kindClass, useNav, useRun } from './model';
import { Tape } from './Tape';

const ROW = 32;
const SPEEDS = [1, 4, 16];

type Filter = 'all' | 'changes' | 'commands' | 'talk' | 'flags';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'changes', label: 'Edits' },
  { id: 'commands', label: 'Commands' },
  { id: 'talk', label: 'Talk' },
  { id: 'flags', label: 'Flagged' },
];

export function Replay() {
  const run = useRun();
  const nav = useNav();
  const steps = run.trace.steps;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);

  useEffect(() => {
    if (!playing) return;
    if (nav.step >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => nav.go(nav.step + 1), 900 / speed);
    return () => window.clearTimeout(id);
  }, [playing, speed, nav, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, button, [role="slider"]')) return;
      if (e.key === ' ' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cur = steps[nav.step];
  const t0 = run.t0;
  return (
    <div className="replay">
      <div className="tape-wrap">
        <div className="tape-controls">
          <button className="icon-btn" onClick={() => nav.go(0)} aria-label="First step" title="First step (Home)">
            <Icon name="first" />
          </button>
          <button className="icon-btn" onClick={() => nav.go(nav.step - 1)} aria-label="Previous step" title="Previous step (k)">
            <Icon name="prev" />
          </button>
          <button
            className="icon-btn primary"
            onClick={() => {
              if (nav.step >= steps.length - 1) nav.go(0);
              setPlaying((p) => !p);
            }}
            aria-label={playing ? 'Pause' : 'Play'}
            title="Play / pause (space)"
            style={{ width: 40 }}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <button className="icon-btn" onClick={() => nav.go(nav.step + 1)} aria-label="Next step" title="Next step (j)">
            <Icon name="next" />
          </button>
          <button className="icon-btn" onClick={() => nav.go(steps.length - 1)} aria-label="Last step" title="Last step (End)">
            <Icon name="last" />
          </button>
          <div className="speed" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
          <span className="pos">
            Step <b>{nav.step + 1}</b> of {steps.length}
            {cur?.t && t0 ? <span style={{ marginLeft: 10, color: 'var(--text-3)' }}>{fmtAt(cur.t - t0)}</span> : null}
          </span>
          <span className="spacer" />
          <div className="legend" aria-hidden="true">
            <span>
              <i style={{ background: 'var(--read)' }} />
              read
            </span>
            <span>
              <i style={{ background: 'var(--edit)' }} />
              edit
            </span>
            <span>
              <i style={{ background: 'var(--create)' }} />
              create
            </span>
            <span>
              <i style={{ background: 'var(--verify)' }} />
              command
            </span>
            <span>
              <i style={{ background: 'var(--fail)' }} />
              failed
            </span>
            <span>
              <i style={{ background: 'var(--high)', clipPath: 'polygon(0 0,100% 0,50% 100%)' }} />
              finding
            </span>
          </div>
        </div>
        <Tape step={nav.step} onStep={(s) => nav.go(s)} />
      </div>
      <div className="replay-body">
        <StepList />
        <Inspector step={cur} />
        <ContextPanel step={cur} />
      </div>
    </div>
  );
}

function fmtAt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function matches(s: Step, f: Filter, flagged: Set<number>): boolean {
  switch (f) {
    case 'changes':
      return !!s.edit;
    case 'commands':
      return s.kind === 'command' || !!s.command;
    case 'talk':
      return s.kind === 'prompt' || s.kind === 'message' || s.kind === 'thinking';
    case 'flags':
      return flagged.has(s.id);
    default:
      return true;
  }
}

function StepList() {
  const run = useRun();
  const nav = useNav();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const box = useRef<HTMLDivElement>(null);
  const flagged = useMemo(() => new Set(run.findingSteps), [run.findingSteps]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return run.trace.steps.filter(
      (s) =>
        matches(s, filter, flagged) &&
        (!needle ||
          s.title.toLowerCase().includes(needle) ||
          s.files.some((f) => f.toLowerCase().includes(needle)) ||
          (s.command?.cmd.toLowerCase().includes(needle) ?? false) ||
          (s.text?.toLowerCase().includes(needle) ?? false)),
    );
  }, [run.trace.steps, q, filter, flagged]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the current step in view.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const idx = visible.findIndex((s) => s.id === nav.step);
    if (idx < 0) return;
    const top = idx * ROW;
    if (top < el.scrollTop + ROW) el.scrollTop = Math.max(0, top - ROW * 2);
    else if (top > el.scrollTop + el.clientHeight - ROW * 2) el.scrollTop = top - el.clientHeight + ROW * 3;
  }, [nav.step, visible]);

  const from = Math.max(0, Math.floor(scroll / ROW) - 8);
  const to = Math.min(visible.length, Math.ceil((scroll + height) / ROW) + 8);

  return (
    <aside className="steplist" aria-label="Steps">
      <div className="steplist-filter" style={{ flexDirection: 'column' }}>
        <input id="step-filter" className="input" placeholder="Filter steps  ( / )" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter steps" />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'accent' : ''}`} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="steplist-scroll" ref={box} onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}>
        <div style={{ height: visible.length * ROW, position: 'relative' }}>
          {visible.slice(from, to).map((s, i) => {
            const fs = run.findingsByStep.get(s.id);
            const sev = fs?.some((f) => f.severity === 'high') ? 'high' : fs?.some((f) => f.severity === 'medium') ? 'medium' : fs?.length ? 'low' : null;
            return (
              <button
                key={s.id}
                className={`step-row ${s.actor === 'subagent' ? 'dim' : ''}`}
                style={{ top: (from + i) * ROW }}
                aria-current={s.id === nav.step}
                onClick={() => nav.go(s.id)}
                title={s.title}
              >
                <span className="sn">{s.id + 1}</span>
                <span className={`kind-icon ${kindClass(s)}`}>
                  <Icon name={KIND_ICON[s.kind]} size={14} />
                </span>
                <span className="st">{s.title}</span>
                {sev ? <span className={`flag sev-dot ${sev}`} /> : <span />}
              </button>
            );
          })}
        </div>
        {visible.length === 0 && <div className="empty">No steps match.</div>}
      </div>
    </aside>
  );
}
