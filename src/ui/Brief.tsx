import { useEffect, useMemo, useRef, useState } from 'react';
import type { Claim, ClaimKind, Phase, PhaseKind, Severity, Step } from '../core/types';
import { isVerify, outputLooksFailed } from '../core/analyze/commands';
import { outsideProject } from '../core/util';
import { Evidence } from './Evidence';
import { Icon } from './Icon';
import { PHASE_LABEL, agentName, fmtOffset, useNav, useRun } from './model';
import { Rich } from './Rich';
import { kindColor } from './RunStrip';

// The Brief reads like a verdict: what the agent said against what the log shows, the run as a
// tape you can click, then claims, what to review first, and how the run unfolded.

const VERDICT_TEXT: Record<Claim['verdict'], string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  stale: 'Stale',
  unverified: 'Unverified',
};

const VERDICT_SIGN: Record<Claim['verdict'], string> = {
  supported: '=',
  contradicted: '≠',
  stale: '≈',
  unverified: '?',
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

const SEV_BARS: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };

function headline(level: string, contradicted: number, high: number, filesChanged: number): string {
  if (contradicted) return 'The agent said it was done. The log disagrees.';
  if (high) return 'Needs a careful review before you merge.';
  if (level === 'review') return 'Mostly fine — a few things are worth a look.';
  return filesChanged ? 'Clean run: the claims check out and nothing looks off.' : 'Nothing was changed in this run.';
}

function firstSentence(s: string): string {
  const m = s.match(/^.+?[.!?](?=\s|$)/);
  return m ? m[0] : s;
}

/** Adds `in` to every `.bv-reveal` inside root once it scrolls into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>('.bv-reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach((i) => i.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    items.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }, [root]);
}

export function Brief() {
  const run = useRun();
  const nav = useNav();
  const { analysis: a, trace } = run;
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  const task = trace.steps.find((s) => s.kind === 'prompt');
  const contradicted = a.claims.filter((c) => c.verdict === 'contradicted').length;
  const high = a.findings.filter((f) => f.severity === 'high').length;
  const order: Record<Claim['verdict'], number> = { contradicted: 0, stale: 1, unverified: 2, supported: 3 };
  const claims = [...a.claims].sort((x, y) => order[x.verdict] - order[y.verdict] || y.step - x.step).slice(0, 8);
  // The hero quotes the punchiest claim: worst verdict first, then the shortest sentence.
  const hero = [...a.claims].sort((x, y) => order[x.verdict] - order[y.verdict] || x.text.length - y.text.length)[0];
  const proof = hero?.evidence[0] !== undefined ? trace.steps[hero.evidence[0]] : undefined;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const chs = useMemo(() => chapters(a.phases, trace.steps), [a.phases, trace.steps]);
  const s = a.stats;
  const level = a.verdict.level;

  return (
    <div className={`page bv ${level}`} ref={root}>
      {/* ------------------------------------------------ verdict hero */}
      <section className={`bv-hero ${level}`}>
        <div className="bv-meta bv-in" style={{ ['--d' as string]: 0 }}>
          <span className="bv-level">
            <span className={`sev-dot ${level === 'risky' ? 'high' : level === 'review' ? 'medium' : 'low'}`} />
            {a.verdict.label}
          </span>
          <span>{agentName(trace)}</span>
          <span>{s.steps} steps</span>
          {s.durationMs !== null && <span>{fmtOffset(s.durationMs).slice(1)}</span>}
          <span className="bv-case">Case {trace.id.slice(0, 6).toUpperCase()}</span>
        </div>

        <h1 className="bv-h1 bv-in" style={{ ['--d' as string]: 1 }}>
          {headline(level, contradicted, high, s.filesChanged)}
        </h1>
        {task && (
          <button className="bv-task bv-in" style={{ ['--d' as string]: 2 }} onClick={() => nav.go(task.id)} title="Open the task in the replay">
            {/* A shared sample can carry a one-line description; the original prompt stays at its step. */}
            <span className="mono-label">{trace.description ? `About this run · request at #${task.id + 1}` : `Task · #${task.id + 1}`}</span>
            <span className="bv-task-q">{trace.description ?? task.text}</span>
          </button>
        )}

        {hero ? (
          <div className={`bv-duel ${hero.verdict}`}>
            <button className="bv-side said bv-in" style={{ ['--d' as string]: 3 }} onClick={() => nav.go(hero.step)}>
              <span className="mono-label">
                The agent said <b>#{hero.step + 1}</b>
              </span>
              <span className={`bv-quote ${hero.text.length > 30 ? 'long' : ''}`}>
                <Rich text={hero.text} />
              </span>
            </button>
            <div className="bv-seal-col" aria-hidden="true">
              <span className="bv-rule" />
              <span className={`bv-seal ${hero.verdict}`}>
                <span className="bv-sign">{VERDICT_SIGN[hero.verdict]}</span>
                <span className="bv-seal-t">{VERDICT_TEXT[hero.verdict]}</span>
              </span>
              <span className="bv-rule" />
            </div>
            <div className="bv-side shown bv-in" style={{ ['--d' as string]: 5 }}>
              <span className="mono-label">
                The log shows {proof && <b>#{proof.id + 1}</b>}
              </span>
              <span className="bv-fact">
                <Rich text={firstSentence(hero.explanation)} />
              </span>
              {proof && (
                <div className="bv-proof">
                  <Evidence step={proof} onOpen={(x) => nav.go(x)} />
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="bv-summary bv-in" style={{ ['--d' as string]: 3 }}>
            {a.verdict.summary}
          </p>
        )}

        <RunTape steps={trace.steps} phases={a.phases} said={hero?.step} proof={hero?.evidence ?? []} tone={hero?.verdict} onGo={nav.go} />

        <div className="bv-stats bv-in" style={{ ['--d' as string]: 8 }}>
          <Stat n={s.steps} label="steps" sub={s.durationMs !== null ? `in ${fmtOffset(s.durationMs).slice(1)}` : undefined} />
          <Stat n={s.filesChanged} label={s.filesChanged === 1 ? 'file changed' : 'files changed'} sub={`+${s.linesAdded} −${s.linesRemoved}`} />
          <Stat n={s.commands} label="commands" sub={s.commandsFailed ? `${s.commandsFailed} failed` : 'none failed'} tone={s.commandsFailed ? 'bad' : undefined} />
          <Stat n={a.claims.length - contradicted} of={a.claims.length} label="claims hold up" sub={a.claims.length ? (contradicted ? `${contradicted} contradicted` : 'none contradicted') : 'none made'} tone={contradicted ? 'bad' : 'good'} />
          <Stat n={a.findings.length} label={a.findings.length === 1 ? 'finding' : 'findings'} sub={high ? `${high} high` : 'none high'} tone={high ? 'bad' : undefined} />
          <div className="bv-actions">
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
      </section>

      {/* ------------------------------------------------ claims */}
      <section className="bv-section" aria-labelledby="claims-h">
        <header className="bv-head bv-reveal">
          <span className="bv-num">01</span>
          <div>
            <p className="mono-label">Claim check</p>
            <h2 id="claims-h">
              What it said, <em>against</em> what the log shows.
            </h2>
          </div>
          <Tally claims={a.claims} />
        </header>

        {claims.length === 0 && (
          <div className="bv-empty">The agent's closing messages make no checkable claims (like “tests pass” or “only changed X”).</div>
        )}
        <div className="bv-claims">
          {claims.map((c, i) => {
            const ev = c.evidence[0] !== undefined ? trace.steps[c.evidence[0]] : undefined;
            const show = open[c.id] ?? c.verdict !== 'supported';
            return (
              <article className={`claim bv-claim bv-reveal ${c.verdict}`} key={c.id} style={{ ['--d' as string]: i % 3 }}>
                <div className="bv-claim-said">
                  <div className="bv-claim-top">
                    <span className="bv-idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className={`stamp ${c.verdict}`}>{VERDICT_TEXT[c.verdict]}</span>
                    <span className="bv-kind">{KIND_TEXT[c.kind]}</span>
                  </div>
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
                    <button className="step-chip" onClick={() => nav.go(c.step)} title="Where the agent said it">
                      said at #{c.step + 1}
                    </button>
                    {c.evidence.map((e) => (
                      <button key={e} className="step-chip" onClick={() => nav.go(e)} title="Evidence">
                        <Icon name="eye" size={11} /> evidence #{e + 1}
                      </button>
                    ))}
                    {ev && (
                      <button className="bv-toggle" onClick={() => setOpen((o) => ({ ...o, [c.id]: !show }))}>
                        {show ? 'Hide proof' : 'Show proof'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="bv-link" aria-hidden="true">
                  <span className="bv-sign">{VERDICT_SIGN[c.verdict]}</span>
                </div>
                <div className="bv-claim-ev">
                  {show && ev ? (
                    <Evidence step={ev} onOpen={(x) => nav.go(x)} />
                  ) : (
                    <p className="bv-ev-none">{ev ? 'Proof hidden.' : 'No command or edit in the log backs this up either way.'}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {a.claims.length > claims.length && <p className="bv-more">+ {a.claims.length - claims.length} more supported claims in this run.</p>}
      </section>

      {/* ------------------------------------------------ review */}
      <section className="bv-section" aria-labelledby="review-h">
        <header className="bv-head bv-reveal">
          <span className="bv-num">02</span>
          <div>
            <p className="mono-label">Review first</p>
            <h2 id="review-h">
              Read these <em>before</em> you merge.
            </h2>
          </div>
        </header>
        {a.review.length === 0 && <div className="bv-empty">Nothing stands out.</div>}
        <ol className="bv-review">
          {a.review.map((r, i) => (
            <li key={i} className={`bv-reveal sev-${r.severity}`} style={{ ['--d' as string]: i % 4 }}>
              <button onClick={() => (r.file && !r.step ? nav.openFile(r.file) : r.step !== null ? nav.go(r.step) : r.file && nav.openFile(r.file))}>
                <span className="bv-rank">{String(i + 1).padStart(2, '0')}</span>
                <span className="bv-rv-body">
                  <span className="bv-rv-t">
                    <Rich text={r.title} />
                  </span>
                  <span className="bv-rv-w">
                    <Rich text={r.why} />
                  </span>
                </span>
                <span className="bv-rv-side">
                  <span className="bv-sev">
                    <span className="bv-bars" aria-hidden="true">
                      {[0, 1, 2].map((b) => (
                        <i key={b} className={b < SEV_BARS[r.severity] ? 'on' : ''} />
                      ))}
                    </span>
                    {r.severity}
                  </span>
                  {r.step !== null && (
                    <span className="bv-where" aria-label={`Step ${r.step + 1} of ${trace.steps.length}`}>
                      <span className="bv-where-line">
                        <i style={{ left: `${(r.step / Math.max(1, trace.steps.length - 1)) * 100}%` }} />
                      </span>
                      #{r.step + 1}
                    </span>
                  )}
                  {r.step === null && r.file && <span className="bv-where file">{r.file.split('/').pop()}</span>}
                </span>
                <Icon name="next" size={20} />
              </button>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------ chapters */}
      <section className="bv-section" aria-labelledby="story-h">
        <header className="bv-head bv-reveal">
          <span className="bv-num">03</span>
          <div>
            <p className="mono-label">How the run unfolded</p>
            <h2 id="story-h">
              {chs.length} chapter{chs.length === 1 ? '' : 's'}, <em>in order.</em>
            </h2>
          </div>
        </header>
        <ol className="bv-film bv-reveal">
          {chs.map((c, i) => (
            <li key={i} className={`phase-${c.kind}`} style={{ flexGrow: Math.max(1, Math.min(4, c.to - c.from + 1)) }}>
              <button onClick={() => nav.go(c.from)}>
                <span className="bv-film-bar">
                  {c.segs.map((sg, j) => (
                    <i key={j} className={`phase-${sg.kind}`} style={{ flexGrow: sg.len }} />
                  ))}
                </span>
                <span className="bv-film-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="bv-film-ph">{c.label}</span>
                <span className="bv-film-r">
                  #{c.from + 1}
                  {c.to > c.from ? `–${c.to + 1}` : ''}
                </span>
                <span className="bv-film-s">{c.summary}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="bv-close bv-reveal">
        <p className="mono-label">Don't take the summary's word for it either</p>
        <button className="bv-close-go" onClick={() => nav.go(0)}>
          Replay all {s.steps} steps <Icon name="next" size={40} />
        </button>
      </section>
    </div>
  );
}

function Stat({ n, of, label, sub, tone }: { n: number; of?: number; label: string; sub?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className={`bv-stat ${tone ?? ''}`}>
      <span className="bv-stat-n">
        {n}
        {of !== undefined && <small>/{of}</small>}
      </span>
      <span className="bv-stat-l">{label}</span>
      {sub && <span className="bv-stat-s">{sub}</span>}
    </div>
  );
}

function Tally({ claims }: { claims: Claim[] }) {
  if (!claims.length) return null;
  const kinds: Claim['verdict'][] = ['contradicted', 'stale', 'unverified', 'supported'];
  return (
    <div className="bv-tally" aria-label="Claim verdicts">
      {kinds.map((k) => {
        const n = claims.filter((c) => c.verdict === k).length;
        if (!n) return null;
        return (
          <span key={k} className={`bv-tally-i ${k}`}>
            <b>{n}</b> {VERDICT_TEXT[k].toLowerCase()}
          </span>
        );
      })}
    </div>
  );
}

/** The run as a row of blocks, one per step, with the claim and its proof pinned above. */
function RunTape({ steps, phases, said, proof, tone, onGo }: { steps: Step[]; phases: Phase[]; said?: number; proof: number[]; tone?: Claim['verdict']; onGo: (id: number) => void }) {
  const run = useRun();
  const flagged = useMemo(() => {
    const m = new Map<number, Severity>();
    for (const f of run.analysis.findings) {
      if (f.severity !== 'high' && f.severity !== 'medium') continue;
      for (const st of f.steps) if (!m.has(st) || f.severity === 'high') m.set(st, f.severity);
    }
    return m;
  }, [run]);
  const n = steps.length;
  const every = n <= 32 ? 1 : n <= 80 ? 5 : n <= 200 ? 10 : 25;
  const pos = (id: number) => `${((id + 0.5) / n) * 100}%`;

  return (
    <div className={`bv-tape bv-in ${tone ?? ''}`} style={{ ['--d' as string]: 6 }}>
      <div className="bv-tape-pins">
        {said !== undefined && (
          <span className="bv-pin said" style={{ left: pos(said) }}>
            said
          </span>
        )}
        {proof.slice(0, 2).map((p) => (
          <span key={p} className="bv-pin proof" style={{ left: pos(p) }}>
            proof
          </span>
        ))}
      </div>
      <div className="bv-tape-row" role="list" aria-label="Every step of the run">
        {steps.map((st, i) => (
          <button
            key={st.id}
            role="listitem"
            className={`bv-blk ${flagged.get(st.id) ?? ''} ${st.id === said ? 'is-said' : ''} ${proof.includes(st.id) ? 'is-proof' : ''}`}
            style={{ background: kindColor(st), ['--i' as string]: i }}
            onClick={() => onGo(st.id)}
            title={`#${st.id + 1} ${st.title}`}
            aria-label={`Step ${st.id + 1}: ${st.title}`}
          />
        ))}
      </div>
      <div className="bv-tape-ticks" aria-hidden="true">
        {steps.map((st) =>
          st.id % every === 0 || st.id === n - 1 ? (
            <span key={st.id} style={{ left: pos(st.id) }}>
              {st.id + 1}
            </span>
          ) : null,
        )}
      </div>
      <div className="bv-tape-phases" aria-hidden="true">
        {phases.map((p, i) => (
          <span key={i} className={`phase-${p.kind}`} style={{ flexGrow: p.to - p.from + 1 }}>
            {p.to - p.from + 1 >= Math.max(1, n / 14) ? PHASE_LABEL[p.kind] : ''}
          </span>
        ))}
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

const LOOP = new Set<PhaseKind>(['change', 'verify', 'repair']);

/**
 * Phases as chapters. Three or more change/check phases in a row become one "Change ↔ check"
 * chapter, and on long runs chapters are grouped per instruction.
 */
function chapters(phases: Phase[], steps: Step[]): Chapter[] {
  const base: Chapter[] = [];
  for (let i = 0; i < phases.length; ) {
    let j = i;
    while (j < phases.length && LOOP.has(phases[j].kind)) j++;
    if (j - i >= 3) {
      const group = phases.slice(i, j);
      const from = group[0].from;
      const to = group[group.length - 1].to;
      const span = steps.slice(from, to + 1);
      const files = new Set(span.filter((s) => s.edit && !outsideProject(s.edit.path)).map((s) => s.edit!.path)).size;
      const checks = span.filter((s) => s.command && isVerify(s.command.categories));
      const failed = checks.filter((s) => s.command!.failed || outputLooksFailed(s.command!.output)).length;
      const cycles = Math.max(1, group.filter((p) => p.kind === 'verify').length);
      base.push({
        kind: 'change',
        label: `Change ↔ check ×${cycles}`,
        from,
        to,
        summary: `${files ? `Edited ${files} project file${files === 1 ? '' : 's'}` : 'Worked in scratch files only'} and ran ${checks.length} check${checks.length === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`,
        segs: group.map((p) => ({ kind: p.kind, len: p.to - p.from + 1 })),
      });
      i = j;
    } else {
      const p = phases[i];
      base.push({ kind: p.kind, label: PHASE_LABEL[p.kind], from: p.from, to: p.to, summary: p.summary, segs: [{ kind: p.kind, len: p.to - p.from + 1 }] });
      i++;
    }
  }
  if (base.length <= 14) return base;
  const out: Chapter[] = [];
  let cur: Chapter | null = null;
  for (const c of base) {
    if (c.kind === 'ask' || !cur) {
      const prompt = steps[c.from]?.kind === 'prompt' ? steps[c.from] : undefined;
      cur = { kind: 'ask', label: `Instruction ${out.length + 1}`, from: c.from, to: c.to, summary: prompt ? prompt.title : c.summary, segs: [] };
      out.push(cur);
    }
    cur.to = c.to;
    cur.segs.push(...c.segs);
  }
  for (const c of out) {
    const edits = steps.slice(c.from, c.to + 1).filter((s) => s.edit && !outsideProject(s.edit.path)).length;
    const fails = steps.slice(c.from, c.to + 1).filter((s) => s.command?.failed).length;
    c.summary = `“${c.summary}” · ${c.to - c.from + 1} steps${edits ? `, ${edits} edits` : ''}${fails ? `, ${fails} failed` : ''}`;
  }
  return out;
}
