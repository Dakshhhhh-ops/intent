import { useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis, Step, Trace } from '../../core/types';
import type { Anchor, CineState } from '../fx3d/cine';
import { Icon } from '../Icon';
import { kindColor } from '../RunStrip';
import { RecTimecode } from './Extras';
import { gsap, ScrollTrigger } from './useHomeMotion';

// Full-screen cinematic hero. Drag spins the recorder; scrolling unspools its tape into the run's
// timeline and pins the findings onto the steps that caused them.

const HEX: Record<string, string> = {
  'var(--fail)': '#ec5d5e',
  'var(--prompt)': '#e796f3',
  'var(--read)': '#70b8ff',
  'var(--edit)': '#ffc53d',
  'var(--create)': '#1fd8a4',
  'var(--verify)': '#0bd8b6',
  'var(--strip-idle)': '#3a3d44',
};

interface Pin {
  step: number;
  tag: string;
  text: string;
  tone: 'bad' | 'warn' | 'claim';
  at: number; // scroll progress at which it appears
}

export function CineHero({ trace, analysis, ready, onOpen, onPick, source }: { trace: Trace; analysis: Analysis; ready: boolean; onOpen: () => void; onPick: () => void; source?: string }) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const state = useRef<CineState>({ progress: 0, intro: 0 });
  const pinEls = useRef<(HTMLDivElement | null)[]>([]);
  const [p, setP] = useState(0);

  const pins: Pin[] = useMemo(() => {
    const out: Pin[] = [];
    const find = (rule: string) => analysis.findings.find((f) => f.rule === rule);
    const blind = find('blind-edit');
    if (blind) out.push({ step: blind.steps[0], tag: 'Blind edit', text: 'edited a file it never read', tone: 'warn', at: 0.64 });
    const fail = trace.steps.find((s) => s.command?.failed);
    if (fail) out.push({ step: fail.id, tag: `exit ${fail.command!.exitCode}`, text: fail.command!.cmd, tone: 'bad', at: 0.69 });
    const weak = find('weakened-tests');
    if (weak) out.push({ step: weak.steps[0], tag: 'Weakened test', text: 'changed 53.97 to 54', tone: 'bad', at: 0.74 });
    const claim = analysis.claims.find((c) => c.kind === 'tests-pass' && c.verdict === 'contradicted');
    if (claim) out.push({ step: claim.step, tag: 'Contradicted', text: `“${claim.text.replace(/`/g, '')}”`, tone: 'claim', at: 0.8 });
    return out;
  }, [trace, analysis]);

  // scene
  // Starts once the title and buttons are on screen: the 3D scene is decoration, never a gate.
  useEffect(() => {
    if (!ready) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const tape = trace.steps.map((s: Step) => ({ color: HEX[kindColor(s)] ?? '#3a3d44', bad: !!s.command?.failed }));
    const timer = window.setTimeout(() => {
      import('../fx3d/cine').then(({ startCine }) => {
        if (cancelled || !stage.current) return;
        const anchors = (): Anchor[] => pins.map((pin, i) => ({ step: pin.step, el: pinEls.current[i]! })).filter((a) => a.el);
        const r = startCine(stage.current, tape, state.current, anchors);
        if (!r) stage.current.classList.add('no-webgl');
        dispose = r?.dispose;
      });
    }, 1300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      dispose?.();
    };
  }, [trace, pins, ready]);

  // entrance, after the loader
  useEffect(() => {
    if (!ready) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      state.current.intro = 1;
      return;
    }
    const tw = gsap.to(state.current, { intro: 1, duration: 1.8, ease: 'power3.out', delay: 0.05 });
    const lines = title.current?.querySelectorAll('.ch-word');
    if (lines) gsap.fromTo(lines, { yPercent: 115, rotate: 4 }, { yPercent: 0, rotate: 0, duration: 1.3, ease: 'expo.out', stagger: 0.06 });
    gsap.fromTo('.ch-reveal', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.06, delay: 0.2 });
    return () => {
      tw.kill();
    };
  }, [ready]);

  // scroll
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        state.current.progress = self.progress;
        setP(self.progress);
      },
    });
    return () => st.kill();
  }, []);

  const titleOut = Math.min(1, p / 0.22);
  const midIn = p > 0.3 && p < 0.58;
  const pct = Math.round(Math.min(1, p / 0.62) * 100);

  return (
    <section className="ch" ref={section} aria-label="Intent Replay">
      <div className="ch-sticky">
        <div className="ch-bg" aria-hidden="true" />
        <div className="ch-copy" style={{ opacity: 1 - titleOut, transform: `translateY(${-titleOut * 60}px) scale(${1 + titleOut * 0.12})`, filter: `blur(${titleOut * 8}px)` }}>
          <h1 className="ch-title" ref={title}>
            <span className="ch-line quote">
              {['“All', 'tests', 'pass.”'].map((w) => (
                <span key={w} className="ch-mask">
                  <em className="ch-word">{w}</em>
                </span>
              ))}
            </span>
            <span className="ch-line">
              {['Prove', 'it.'].map((w) => (
                <span key={w} className="ch-mask">
                  <span className="ch-word">{w}</span>
                </span>
              ))}
            </span>
          </h1>
          <p className="ch-sub ch-reveal">
            Intent Replay fact-checks what your coding agent says it did against the commands that actually ran, and shows you the step that proves it.
          </p>
        </div>

        <div className="ch-stage" ref={stage} aria-hidden="true" />

        <p className={`ch-mid ${midIn ? 'on' : ''}`}>
          Every step the agent took is <em>on the tape.</em>
        </p>

        {pins.map((pin, i) => (
          <div
            key={pin.tag}
            ref={(el) => {
              pinEls.current[i] = el;
            }}
            className={`ch-pin up ${pin.tone} ${p >= pin.at ? 'on' : ''} ${i % 2 ? 'tall' : ''}`}
          >
            <span className="ch-pin-line" />
            <span className="ch-pin-card">
              <span className="ch-pin-tag">
                #{pin.step + 1} · {pin.tag}
              </span>
              <span className="ch-pin-text">{pin.text}</span>
            </span>
          </div>
        ))}

        <div className="ch-hud tl ch-reveal">
          <span>Intent Replay — v0.1</span>
          <span>Flight recorder for AI coding agents</span>
        </div>
        <div className="ch-hud tr ch-reveal">
          <RecTimecode />
          <span>{trace.steps.length} steps on tape</span>
          {source && <span>{source}</span>}
        </div>
        <div className={`ch-hud bl ${p > 0.02 ? 'on' : ''}`}>
          <span className="ch-pct">{String(pct).padStart(3, '0')}%</span>
          <span>tape unspooled</span>
        </div>

        <div className="ch-bottom ch-reveal">
          <div className="ch-ctas">
            <button className="cta cta-primary vf" onClick={onOpen}>
              <span>{source?.startsWith('Real') ? 'See a real run' : 'See a run'}</span>
              <Icon name="next" size={18} />
            </button>
            <button className="cta vf" onClick={onPick}>
              <span>Open a log</span>
              <Icon name="upload" size={16} />
            </button>
          </div>
          <p className="ch-hint">
            <span className="ch-mouse" aria-hidden="true">
              <i />
            </span>
            Drag to spin · scroll to unspool the tape
          </p>
        </div>
      </div>
    </section>
  );
}
