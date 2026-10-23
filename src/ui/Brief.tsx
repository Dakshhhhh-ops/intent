import { useState } from 'react';
import type { Claim, ClaimKind, Phase, PhaseKind, Step } from '../core/types';
import { Evidence } from './Evidence';
import { BlackBoxDial } from './home/BlackBoxDial';
import { Icon } from './Icon';
import { PHASE_LABEL, useNav, useRun } from './model';
import { Rich } from './Rich';

const VERDICT_TEXT: Record<Claim['verdict'], string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  stale: 'Stale',
  unverified: 'Unverified',
};

const KIND_TEXT: Record<ClaimKind, string> = {
  'tests-pass': 'tests',
  'build-pass': 'build',
  'typecheck-pass': 'types',
  'lint-pass': 'lint',
  fixed: 'fix',
  'only-changed': 'scope',
  'no-test-changes': 'tests untouched',
};

function headline(level: string, contradicted: number, high: number, filesChanged: number): string {
  if (contradicted) return 'The agent said it was done. The log disagrees.';
  if (high) return 'Needs a careful review before you merge.';
  if (level === 'review') return 'Mostly fine — a few things are worth a look.';
  return filesChanged ? 'Clean run: the claims check out and nothing looks off.' : 'Nothing was changed in this run.';
}

export function Brief() {
  const run = useRun();
  const nav = useNav();
  const { analysis: a, trace } = run;
  const task = trace.steps.find((s) => s.kind === 'prompt');
  const contradicted = a.claims.filter((c) => c.verdict === 'contradicted').length;
  const high = a.findings.filter((f) => f.severity === 'high').length;
  const order: Record<Claim['verdict'], number> = { contradicted: 0, stale: 1, unverified: 2, supported: 3 };
  const claims = [...a.claims].sort((x, y) => order[x.verdict] - order[y.verdict] || y.step - x.step).slice(0, 8);
  const topClaim = claims[0];
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="page brief2">
      <section className={`brief-hero ${a.verdict.level}`}>
        <div className="bh-copy">
          <p className="mono-label">
            <span className={`sev-dot ${a.verdict.level === 'risky' ? 'high' : a.verdict.level === 'review' ? 'medium' : 'low'}`} />
            {a.verdict.label}
          </p>
          <h1>{headline(a.verdict.level, contradicted, high, a.stats.filesChanged)}</h1>
          <p className="bh-summary">{a.verdict.summary}</p>
          {task && (
            <button className="bh-task" onClick={() => nav.go(task.id)} title="Open the task in the replay">
              <span className="mono-label">The task</span>
              <q>{task.text}</q>
            </button>
          )}
          <div className="bh-actions">
            <button className="cta cta-primary vf" onClick={() => nav.go(0)}>
              <span>Replay the run</span>
              <Icon name="play" size={14} />
            </button>
            <button className="cta vf" onClick={() => nav.setTab('findings')}>
              <span>
                {a.findings.length} finding{a.findings.length === 1 ? '' : 's'}
              </span>
              <Icon name="next" size={16} />
            </button>
          </div>
        </div>
        <div className="bh-dial">
          <BlackBoxDial steps={trace.steps} phases={a.phases} claim={topClaim} onOpen={() => nav.go(0)} />
        </div>
      </section>

      <section className="b-section" aria-labelledby="claims-h">
        <div className="b-head">
          <p className="mono-label">Claim check</p>
          <h2 id="claims-h">What the agent said, against what the log shows.</h2>
        </div>
        {claims.length === 0 && (
          <div className="b-empty vf">The agent's closing messages make no checkable claims (like “tests pass” or “only changed X”).</div>
        )}
        <div className="b-claims">
          {claims.map((c) => {
            const show = open[c.id] ?? c.verdict === 'contradicted';
            const ev = c.evidence[0] !== undefined ? trace.steps[c.evidence[0]] : undefined;
            return (
              <article className={`claim b-claim ${c.verdict}`} key={c.id}>
                <div className="b-claim-main">
                  <span className={`stamp ${c.verdict}`}>{VERDICT_TEXT[c.verdict]}</span>
                  <blockquote>
                    <Rich text={c.text} />
                  </blockquote>
                  <p className="why">
                    <Rich text={c.explanation} />
                  </p>
                  {c.caveat && (
                    <p className="caveat">
                      <Icon name="alert" size={14} />
                      {c.caveat}
                    </p>
                  )}
                  <div className="actions">
                    <span className="chip">{KIND_TEXT[c.kind]}</span>
                    <button className="step-chip" onClick={() => nav.go(c.step)} title="Where the agent said it">
                      said at #{c.step + 1}
                    </button>
                    {c.evidence.map((e) => (
                      <button key={e} className="step-chip" onClick={() => nav.go(e)} title="Evidence">
                        <Icon name="eye" size={11} /> evidence #{e + 1}
                      </button>
                    ))}
                    {ev && (
                      <button className="fx-toggle" onClick={() => setOpen((o) => ({ ...o, [c.id]: !show }))}>
                        {show ? 'Hide proof' : 'Show proof'}
                      </button>
                    )}
                  </div>
                </div>
                {show && ev && (
                  <div className="b-claim-ev">
                    <Evidence step={ev} onOpen={(x) => nav.go(x)} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {a.claims.length > claims.length && <p className="b-more">+ {a.claims.length - claims.length} more supported claims in this run.</p>}
      </section>

      <div className="b-two">
        <section className="b-section" aria-labelledby="review-h">
          <div className="b-head">
            <p className="mono-label">Review first</p>
            <h2 id="review-h">Ranked by risk.</h2>
          </div>
          {a.review.length === 0 && <div className="b-empty vf">Nothing stands out.</div>}
          <ol className="b-review">
            {a.review.map((r, i) => (
              <li key={i}>
                <button className="review-item" onClick={() => (r.file && !r.step ? nav.openFile(r.file) : r.step !== null ? nav.go(r.step) : r.file && nav.openFile(r.file))}>
                  <span className="rank">{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="t">
                      <span className={`sev-dot ${r.severity}`} />
                      <span>
                        <Rich text={r.title} />
                      </span>
                    </span>
                    <span className="w">
                      <Rich text={r.why} />
                    </span>
                  </span>
                  <Icon name="next" size={16} />
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="b-section" aria-labelledby="story-h">
          <div className="b-head">
            <p className="mono-label">How the run unfolded</p>
            <h2 id="story-h">{chapters(a.phases, trace.steps).length} chapters.</h2>
          </div>
          <ol className="b-story">
            {chapters(a.phases, trace.steps).map((c, i) => (
              <li key={i} className={`phase-${c.kind}`}>
                <button onClick={() => nav.go(c.from)}>
                  <span className="b-story-bar">
                    {c.segs.map((sg, j) => (
                      <i key={j} className={`phase-${sg.kind}`} style={{ flexGrow: sg.len }} />
                    ))}
                  </span>
                  <span className="b-story-ph">
                    {c.label}
                    <span>
                      #{c.from + 1}
                      {c.to > c.from ? `–${c.to + 1}` : ''}
                    </span>
                  </span>
                  <span className="b-story-s">{c.summary}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

interface Chapter {
  kind: PhaseKind;
  label: string;
  from: number;
  to: number;
  summary: string;
  segs: { kind: PhaseKind; len: number }[];
}

/** Phases as chapters; on long runs, one chapter per instruction with its phases as segments. */
function chapters(phases: Phase[], steps: Step[]): Chapter[] {
  if (phases.length <= 14) {
    return phases.map((p) => ({ kind: p.kind, label: PHASE_LABEL[p.kind], from: p.from, to: p.to, summary: p.summary, segs: [{ kind: p.kind, len: 1 }] }));
  }
  const out: Chapter[] = [];
  let cur: Chapter | null = null;
  for (const p of phases) {
    if (p.kind === 'ask' || !cur) {
      const prompt = steps[p.from]?.kind === 'prompt' ? steps[p.from] : undefined;
      cur = { kind: 'ask', label: `Instruction ${out.length + 1}`, from: p.from, to: p.to, summary: prompt ? prompt.title : p.summary, segs: [] };
      out.push(cur);
    }
    cur.to = p.to;
    cur.segs.push({ kind: p.kind, len: p.to - p.from + 1 });
  }
  for (const c of out) {
    const edits = steps.slice(c.from, c.to + 1).filter((s) => s.edit).length;
    const fails = steps.slice(c.from, c.to + 1).filter((s) => s.command?.failed).length;
    c.summary = `“${c.summary}” · ${c.to - c.from + 1} steps${edits ? `, ${edits} edits` : ''}${fails ? `, ${fails} failed` : ''}`;
  }
  return out;
}
