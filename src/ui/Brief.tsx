import { formatDuration } from '../core/report/markdown';
import type { Claim, ClaimKind, Phase, PhaseKind, Step } from '../core/types';
import { Icon } from './Icon';
import { Rich } from './Rich';
import { fmtTokens, PHASE_LABEL, useNav, useRun } from './model';

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
  const st = a.stats;
  const task = trace.steps.find((s) => s.kind === 'prompt');
  const contradicted = a.claims.filter((c) => c.verdict === 'contradicted').length;
  const high = a.findings.filter((f) => f.severity === 'high').length;
  const sev = (s: string) => a.findings.filter((f) => f.severity === s).length;
  // Show the most important claims first; keep the panel short on long runs.
  const order: Record<Claim['verdict'], number> = { contradicted: 0, stale: 1, unverified: 2, supported: 3 };
  const claims = [...a.claims].sort((x, y) => order[x.verdict] - order[y.verdict] || y.step - x.step).slice(0, 8);

  return (
    <div className="page">
      <section className={`brief-hero ${a.verdict.level}`}>
        <div>
          <div className="kicker">
            <span className={`sev-dot ${a.verdict.level === 'risky' ? 'high' : a.verdict.level === 'review' ? 'medium' : 'low'}`} />
            {a.verdict.label}
          </div>
          <h1>{headline(a.verdict.level, contradicted, high, st.filesChanged)}</h1>
          <p className="summary">{a.verdict.summary}</p>
          {task && (
            <button className="task-quote" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => nav.go(task.id)} title="Open the task in the replay">
              <Icon name="prompt" />
              <span>{task.text}</span>
            </button>
          )}
        </div>
        <div className="stat-grid">
          <Stat v={formatDuration(st.durationMs)} k="duration" />
          <Stat v={String(st.steps)} k="steps" />
          <Stat v={String(st.filesRead)} k="files read" />
          <Stat v={String(st.filesChanged)} k={`files changed`} extra={`+${st.linesAdded} −${st.linesRemoved}`} />
          <Stat v={String(st.commands)} k="commands run" />
          <Stat v={String(st.commandsFailed)} k="commands failed" bad={st.commandsFailed > 0} />
          {st.tokensOut > 0 && <Stat v={fmtTokens(st.tokensIn + st.tokensCached)} k="tokens in" />}
          {st.tokensOut > 0 && <Stat v={fmtTokens(st.tokensOut)} k="tokens out" />}
          {st.prompts > 1 && <Stat v={String(st.prompts)} k="instructions" />}
        </div>
      </section>

      <div className="brief-grid">
        <section className="panel" aria-labelledby="claims-h">
          <div className="panel-head">
            <h2 id="claims-h">
              <Icon name="quote" /> Claim check
            </h2>
            <span className="hint">What the agent said vs. what the log shows</span>
          </div>
          <div className="panel-body">
            {claims.length === 0 && (
              <div className="empty">The agent's closing messages make no checkable claims (like “tests pass” or “only changed X”).</div>
            )}
            {claims.map((c) => (
              <article className="claim" key={c.id}>
                <div>
                  <span className={`stamp ${c.verdict}`}>{VERDICT_TEXT[c.verdict]}</span>
                </div>
                <div>
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
                  </div>
                </div>
              </article>
            ))}
            {a.claims.length > claims.length && (
              <div className="empty" style={{ padding: '10px 16px', textAlign: 'left' }}>
                + {a.claims.length - claims.length} more supported claims in this run.
              </div>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="review-h">
          <div className="panel-head">
            <h2 id="review-h">
              <Icon name="target" /> Review first
            </h2>
            <span className="hint">Ranked by risk</span>
          </div>
          <div className="panel-body">
            {a.review.length === 0 && <div className="empty">Nothing stands out.</div>}
            {a.review.map((r, i) => (
              <button
                key={i}
                className="review-item"
                onClick={() => (r.file && !r.step ? nav.openFile(r.file) : r.step !== null ? nav.go(r.step) : r.file && nav.openFile(r.file))}
              >
                <span className="rank">{String(i + 1).padStart(2, '0')}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="t">
                    <span className={`sev-dot ${r.severity}`} />
                    <Rich text={r.title} />
                  </span>
                  <span className="w">
                    <Rich text={r.why} />
                  </span>
                </span>
                <Icon name="next" size={14} style={{ color: 'var(--text-3)', marginTop: 3 }} />
              </button>
            ))}
          </div>
          <div className="sev-summary">
            {(['high', 'medium', 'low'] as const).map((s) => (
              <button key={s} className={`chip ${s}`} onClick={() => nav.setTab('findings')}>
                {sev(s)} {s}
              </button>
            ))}
            <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => nav.setTab('findings')}>
              All findings <Icon name="next" size={13} />
            </button>
          </div>
        </section>
      </div>

      <section className="panel story" aria-labelledby="story-h">
        <div className="panel-head">
          <h2 id="story-h">
            <Icon name="rewind" /> How the run unfolded
          </h2>
          <span className="hint">Click a chapter to replay it</span>
        </div>
        <div className="story-track">
          {chapters(a.phases, trace.steps).map((c, i) => (
            <button key={i} className={`chapter phase-${c.kind}`} onClick={() => nav.go(c.from)} style={{ flexGrow: Math.max(1, Math.log2(c.to - c.from + 2)) }}>
              <div className="bar segs">
                {c.segs.map((sg, j) => (
                  <span key={j} className={`phase-${sg.kind}`} style={{ flexGrow: sg.len }} />
                ))}
              </div>
              <div className="ph">
                {c.label}
                <span className="n num">
                  #{c.from + 1}
                  {c.to > c.from ? `–${c.to + 1}` : ''}
                </span>
              </div>
              <div className="s">{c.summary}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ v, k, extra, bad }: { v: string; k: string; extra?: string; bad?: boolean }) {
  return (
    <div className="stat">
      <div className={`v ${bad ? 'bad' : ''}`}>
        {v}
        {extra && <small>{extra}</small>}
      </div>
      <div className="k">{k}</div>
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
