import { useEffect, useRef, useState } from 'react';
import type { Analysis, Step, Trace } from '../../core/types';
import { Rich } from '../Rich';
import { ScrollTrigger } from './useHomeMotion';

// A pinned scroll story: four stages of what happens to one log file, each with a live mock
// built from the sample run itself.

const STAGES = [
  { n: '01', title: 'Read the raw log', body: 'Claude Code or Codex JSONL: every message, tool call, file snapshot and exit code. Parsed in your browser.' },
  { n: '02', title: 'Lay out one timeline', body: 'Two very different log formats become one ordered tape of reads, edits, commands and what the agent said.' },
  { n: '03', title: 'Check every claim', body: '“All tests pass.” is held up against the commands that actually ran, including the ones it filtered or piped away.' },
  { n: '04', title: 'Hand over a verdict', body: 'The findings that matter, ranked, with blame for every changed line. Deterministic: no AI, no account.' },
];

function laneOf(s: Step): number {
  if (['prompt', 'message', 'thinking', 'plan'].includes(s.kind)) return 0;
  if (['read', 'search', 'web'].includes(s.kind)) return 1;
  if (s.edit) return 2;
  return 3;
}

function colorOf(s: Step): string {
  if (s.command?.failed) return 'var(--fail)';
  if (s.kind === 'prompt') return 'var(--prompt)';
  if (s.kind === 'read' || s.kind === 'search') return 'var(--read)';
  if (s.kind === 'edit') return 'var(--edit)';
  if (s.kind === 'create') return 'var(--create)';
  if (s.kind === 'command') return 'var(--verify)';
  return 'var(--text-3)';
}

export function HowItWorks({ trace, analysis, raw }: { trace: Trace; analysis: Analysis; raw: string }) {
  const ref = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(0);
  const [p, setP] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        setP(self.progress);
        setStage(Math.min(3, Math.floor(self.progress * 4)));
      },
    });
    return () => st.kill();
  }, []);

  const lines = raw
    .split('\n')
    .filter(Boolean)
    .slice(0, 14)
    .map((l) => (l.length > 150 ? l.slice(0, 148) + '…' : l));
  const claim =
    analysis.claims.find((c) => c.kind === 'tests-pass' && c.verdict === 'contradicted') ??
    analysis.claims.find((c) => c.verdict === 'contradicted') ??
    analysis.claims[0];
  const n = trace.steps.length;
  const local = p * 4 - stage; // 0..1 inside the current stage

  return (
    <section className="hiw" id="how" ref={ref} aria-label="How it works">
      <div className="hiw-sticky">
        <div className="hiw-left">
          <p className="eyebrow-mono">How it works</p>
          <h2 className="hiw-h">One log file in.<br />A verdict out.</h2>
          <ol className="hiw-steps">
            {STAGES.map((s, i) => (
              <li key={s.n} className={i === stage ? 'on' : i < stage ? 'past' : ''}>
                <span className="hiw-n">{s.n}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="hiw-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${p})` }} />
          </div>
        </div>

        <div className="hiw-right">
          <div className="hiw-frame vf">
            <div className={`hiw-panel ${stage === 0 ? 'on' : ''}`}>
              <div className="hiw-bar">
                <i />
                <i />
                <i />
                <span>session.jsonl</span>
              </div>
              <pre className="hiw-json">
                {lines.map((l, i) => (
                  <div key={i} style={{ opacity: i / lines.length < local * 1.4 + 0.15 ? 1 : 0.12 }}>
                    {l}
                  </div>
                ))}
              </pre>
            </div>

            <div className={`hiw-panel ${stage === 1 ? 'on' : ''}`}>
              <div className="hiw-bar">
                <i />
                <i />
                <i />
                <span>timeline · {n} steps</span>
              </div>
              <div className="hiw-tape">
                {['Talk', 'Read', 'Change', 'Run'].map((lane, li) => (
                  <div key={lane} className="hiw-lane">
                    <span className="hiw-lane-l">{lane}</span>
                    <div className="hiw-lane-t">
                      {trace.steps.map((s, i) =>
                        laneOf(s) === li ? (
                          <span
                            key={i}
                            className="hiw-mark"
                            style={{ left: `${(i / n) * 100}%`, width: `${100 / n - 0.6}%`, background: colorOf(s), opacity: i / n <= local * 1.2 ? 1 : 0.08 }}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="hiw-chapters">
                {analysis.phases.map((ph, i) => (
                  <span key={i} className={`phase-${ph.kind}`} style={{ flexGrow: ph.to - ph.from + 1 }} />
                ))}
              </div>
            </div>

            <div className={`hiw-panel ${stage === 2 ? 'on' : ''}`}>
              <div className="hiw-bar">
                <i />
                <i />
                <i />
                <span>claim check</span>
              </div>
              {claim && (
                <div className="hiw-claim">
                  <q>
                    <Rich text={claim.text} />
                  </q>
                  <p className={local > 0.35 ? 'shown' : ''}>
                    <Rich text={claim.explanation} />
                  </p>
                  <span className={`stamp contradicted hiw-stamp ${local > 0.55 ? 'shown' : ''}`}>{claim.verdict}</span>
                </div>
              )}
            </div>

            <div className={`hiw-panel ${stage === 3 ? 'on' : ''}`}>
              <div className="hiw-bar">
                <i />
                <i />
                <i />
                <span>verdict</span>
              </div>
              <div className="hiw-verdict">
                <span className={`verdict-pill ${analysis.verdict.level}`}>
                  <span className="dot" />
                  {analysis.verdict.label}
                </span>
                <ul>
                  {analysis.findings.slice(0, 5).map((f, i) => (
                    <li key={f.id} style={{ opacity: i / 5 <= local * 1.3 ? 1 : 0.1 }}>
                      <span className={`sev-dot ${f.severity}`} />
                      <Rich text={f.title.length > 70 ? f.title.slice(0, 68) + '…' : f.title} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
