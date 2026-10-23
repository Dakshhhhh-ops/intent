import { useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis, Step, Trace } from '../../core/types';
import { Rich } from '../Rich';
import { kindColor } from '../RunStrip';
import { ScrollTrigger } from './useHomeMotion';

// How it works: four full-screen scenes on a horizontal track, driven by vertical scroll.

function lane(s: Step): number {
  if (['prompt', 'message', 'thinking', 'plan'].includes(s.kind)) return 0;
  if (['read', 'search', 'web'].includes(s.kind)) return 1;
  if (s.edit) return 2;
  return 3;
}

function colorize(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b\d+\b)|(true|false|null)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className={m[2] ? 'j-key' : 'j-str'}>{m[1]}</span>, m[2] ?? '');
    else if (m[3]) out.push(<span key={k++} className="j-num">{m[3]}</span>);
    else out.push(<span key={k++} className="j-bool">{m[4]}</span>);
    last = re.lastIndex;
  }
  out.push(line.slice(last));
  return out;
}

export function HorizontalStory({ trace, analysis, raw }: { trace: Trace; analysis: Analysis; raw: string }) {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 1000px)').matches);

  useEffect(() => {
    const mq = matchMedia('(max-width: 1000px)');
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (mobile) return;
    const el = section.current;
    const tr = track.current;
    if (!el || !tr) return;
    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => setP(self.progress),
    });
    return () => st.kill();
  }, [mobile]);

  const lines = useMemo(
    () =>
      raw
        .split('\n')
        .filter(Boolean)
        .slice(0, 40)
        .map((l) => (l.length > 170 ? l.slice(0, 168) + '…' : l)),
    [raw],
  );
  const claim = analysis.claims.find((c) => c.kind === 'tests-pass' && c.verdict === 'contradicted') ?? analysis.claims.find((c) => c.verdict === 'contradicted');
  const ev = claim?.evidence[0] !== undefined ? trace.steps[claim.evidence[0]] : undefined;
  const failLines = ev?.command ? ev.command.output.split('\n').filter((l) => /fail|✖|expected|assert|tests \d|pass \d/i.test(l)).slice(0, 6) : [];
  const n = trace.steps.length;
  // Scroll picks the scene; the track glides to it, so a panel is never left half on screen.
  const scene = mobile ? 4 : Math.min(3, Math.floor(p * 4));
  const local = mobile ? 1 : Math.max(0, Math.min(1, p * 4 - scene));
  const sev = (s: string) => analysis.findings.filter((f) => f.severity === s).length;

  return (
    <section className={`hs ${mobile ? 'is-mobile' : ''}`} id="how" ref={section} aria-label="How it works">
      <div className="hs-sticky">
        <div className="hs-hud" aria-hidden="true">
          <span className="eyebrow-mono">How it works</span>
          <div className="hs-dots">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={i === scene ? 'on' : i < scene ? 'past' : ''} />
            ))}
          </div>
          <span className="hs-count">0{Math.min(4, scene + 1)} / 04</span>
        </div>
        <div className="hs-track" ref={track} style={mobile ? undefined : { transform: `translate3d(${-scene * 100}vw,0,0)` }}>
          {/* 01 */}
          <article className={`hs-panel ${scene === 0 || mobile ? "on" : ""}`}>
            <div className="hs-copy">
              <span className="hs-n">01</span>
              <h3>
                Read the <em>raw</em> log.
              </h3>
              <p>Claude Code and Codex write every message, tool call, file snapshot and exit code to disk. Intent Replay reads that file, in your browser.</p>
            </div>
            <div className="hs-visual hs-json">
              <div className="hs-json-scroll">
                {[...lines, ...lines].map((l, i) => (
                  <div key={i}>{colorize(l)}</div>
                ))}
              </div>
              <div className="hs-file">session.jsonl · {lines.length}+ records</div>
            </div>
          </article>

          {/* 02 */}
          <article className={`hs-panel ${scene === 1 || mobile ? "on" : ""}`}>
            <div className="hs-copy">
              <span className="hs-n">02</span>
              <h3>
                Lay it out on <em>one</em> tape.
              </h3>
              <p>Two very different log formats become one ordered timeline: what the agent said, read, changed and ran, step by step.</p>
            </div>
            <div className="hs-visual hs-tape">
              {['Talk', 'Read', 'Change', 'Run'].map((name, li) => (
                <div className="hs-lane" key={name}>
                  <span>{name}</span>
                  <div>
                    {trace.steps.map((s, i) =>
                      lane(s) === li ? (
                        <b
                          key={i}
                          style={{
                            left: `${(i / n) * 100}%`,
                            width: `${100 / n - 0.8}%`,
                            background: kindColor(s),
                            transform: `translateY(${scene >= 1 || mobile ? 0 : (li % 2 ? 1 : -1) * 80}px)`,
                            opacity: scene >= 1 || mobile ? 1 : 0,
                            transitionDelay: `${i * 35}ms`,
                          }}
                          title={s.title}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              ))}
              <div className="hs-axis">
                {trace.steps.map((_, i) => (i % 4 === 0 ? <span key={i} style={{ left: `${(i / n) * 100}%` }}>#{i + 1}</span> : null))}
              </div>
              <div className="hs-chapters">
                {analysis.phases.map((ph, i) => (
                  <span key={i} className={`phase-${ph.kind}`} style={{ flexGrow: ph.to - ph.from + 1 }}>
                    {ph.kind}
                  </span>
                ))}
              </div>
            </div>
          </article>

          {/* 03 */}
          <article className={`hs-panel ${scene === 2 || mobile ? "on" : ""}`}>
            <div className="hs-copy">
              <span className="hs-n">03</span>
              <h3>
                Check every <em>claim.</em>
              </h3>
              <p>“All tests pass.” is held up against the commands that actually ran — including the ones the agent filtered, piped or ran before changing the code again.</p>
            </div>
            <div className="hs-visual hs-claim">
              {claim && (
                <>
                  <q>
                    <Rich text={claim.text} />
                  </q>
                  <div className={`hs-ev ${scene >= 2 ? 'in' : ''}`}>
                    <div className="hs-ev-cmd">
                      <span>$</span> {ev?.command?.cmd ?? ''} <i>exit {ev?.command?.exitCode ?? '?'}</i>
                    </div>
                    {failLines.map((l, i) => (
                      <div key={i} className={/fail|✖|expected|assert/i.test(l) ? 'bad' : ''}>
                        {l}
                      </div>
                    ))}
                  </div>
                  <span className={`hs-stamp ${scene >= 2 && local > 0.25 ? 'in' : ''}`}>Contradicted</span>
                </>
              )}
            </div>
          </article>

          {/* 04 */}
          <article className={`hs-panel ${scene === 3 || mobile ? "on" : ""}`}>
            <div className="hs-copy">
              <span className="hs-n">04</span>
              <h3>
                Hand over a <em>verdict.</em>
              </h3>
              <p>The few things a reviewer must look at, ranked by risk, each linked to the step that proves it. Deterministic: no AI, no account.</p>
            </div>
            <div className="hs-visual hs-verdict">
              <div className={`hs-big ${analysis.verdict.level}`}>{analysis.verdict.label}</div>
              <div className="hs-meters">
                <span className="h">
                  {sev('high')}
                  <small>high</small>
                </span>
                <span className="m">
                  {sev('medium')}
                  <small>medium</small>
                </span>
                <span className="l">
                  {sev('low')}
                  <small>low</small>
                </span>
              </div>
              <ol>
                {analysis.findings.slice(0, 4).map((f, i) => (
                  <li key={f.id} style={{ transitionDelay: `${i * 90}ms` }} className={scene >= 3 || mobile ? 'in' : ''}>
                    <span className={`sev-dot ${f.severity}`} />
                    <Rich text={f.title} />
                    <em>#{(f.steps[0] ?? 0) + 1}</em>
                  </li>
                ))}
              </ol>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
