import { useMemo, useRef, useState } from 'react';
import { analyze } from '../core/analyze';
import { RULE_INFO } from '../core/analyze/rules';
import { parseTrace } from '../core/parse/detect';
import type { Analysis, Claim, RuleId, Step, Trace } from '../core/types';
import { SAMPLES } from '../samples';
import type { CliSession } from './App';
import { SiteFooter } from './fx3d/SiteFooter';
import { BlackBoxDial } from './home/BlackBoxDial';
import { CursorFollower, RecTimecode } from './home/Extras';
import { HowItWorks } from './home/HowItWorks';
import { SampleList, type SampleRow } from './home/SampleList';
import { useHomeMotion } from './home/useHomeMotion';
import { Icon } from './Icon';
import { DotPattern, MagicCard, Marquee, NumberTicker, Spotlight } from './oss/Elements';
import { Rich } from './Rich';

function tapeColor(s: Step): string {
  if (s.command?.failed) return 'var(--fail)';
  if (s.kind === 'edit') return 'var(--edit)';
  if (s.kind === 'create') return 'var(--create)';
  if (s.kind === 'read' || s.kind === 'search') return 'var(--read)';
  if (s.kind === 'command') return 'var(--verify)';
  if (s.kind === 'prompt') return 'var(--prompt)';
  return 'var(--border-strong)';
}

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Sentences the claim checker recognizes, with verdicts it can give them.
const TICKER: [string, Claim['verdict']][] = [
  ['All tests pass.', 'contradicted'],
  ['Only changed `cart.js`.', 'supported'],
  ['The build succeeds.', 'unverified'],
  ["Didn't change any tests.", 'contradicted'],
  ['I fixed the rounding bug.', 'supported'],
  ['Type check passes.', 'stale'],
  ['Lint is clean.', 'unverified'],
];

type Card = SampleRow & { trace: Trace; analysis: Analysis; text: string; contradicted: number };

export function Home({
  onFile,
  onSample,
  onCompare,
  onSession,
  sessions,
  cwd,
  error,
}: {
  onFile: (f: File) => void;
  onSample: (id: string) => void;
  onCompare: (ids: string[]) => void;
  onSession: (s: CliSession) => void;
  sessions: CliSession[] | null;
  cwd?: string;
  error: string | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  useHomeMotion(root);

  const cards = useMemo(
    () =>
      SAMPLES.map((s) => {
        try {
          const t = parseTrace(s.text, s.id);
          const a = analyze(t);
          const n = t.steps.length;
          const bucket = Math.max(1, Math.ceil(n / 60));
          const bars: { c: string; h: number }[] = [];
          for (let i = 0; i < n; i += bucket) {
            const chunk = t.steps.slice(i, i + bucket);
            const pick = chunk.find((x) => x.command?.failed) ?? chunk.find((x) => x.edit) ?? chunk.find((x) => x.command) ?? chunk[0];
            bars.push({ c: tapeColor(pick), h: pick.edit || pick.command?.failed ? 100 : pick.command ? 70 : pick.kind === 'prompt' ? 100 : 45 });
          }
          return {
            id: s.id,
            title: s.title,
            blurb: s.blurb,
            label: s.label,
            agent: s.agent,
            verdict: a.verdict,
            steps: n,
            files: a.stats.filesChanged,
            bars,
            claims: a.claims,
            trace: t,
            analysis: a,
            text: s.text,
            contradicted: a.claims.filter((c) => c.verdict === 'contradicted').length,
          } as Card;
        } catch {
          return null;
        }
      }).filter(Boolean) as Card[],
    [],
  );
  const hero = cards.find((c) => c.contradicted > 0) ?? cards[0];
  const heroClaim = hero?.claims.find((c) => c.kind === 'tests-pass' && c.verdict === 'contradicted') ?? hero?.claims.find((c) => c.verdict === 'contradicted');
  const pick = () => input.current?.click();

  return (
    <div className="home" ref={root}>
      <CursorFollower />
      <div className="grain" aria-hidden="true" />

      {/* ------------------------------------------------------------ hero */}
      <section className="h-hero">
        <DotPattern />
        <Spotlight />
        <div className="h-hero-grid">
          <div className="h-hero-meta" data-rise data-rise-now>
            <p className="mono-intro">
              Intent Replay — v0.1
              <br />
              A flight recorder for AI coding agents.
              <br />
              Reads Claude Code and Codex CLI logs.
            </p>
            <RecTimecode />
          </div>

          <h1 className="h-title" data-reveal data-reveal-now>
            Debug what
            <br />
            your agent
            <br />
            <em>actually</em> did.
          </h1>

          {hero && (
            <div className="h-dial" data-rise data-rise-now data-rise-delay="0.25">
              <BlackBoxDial steps={hero.trace.steps} phases={hero.analysis.phases} claim={heroClaim} onOpen={() => onSample(hero.id)} />
              <p className="h-dial-cap">
                <span className="cap-dot" /> A real replay of the sample run · click to open it
              </p>
            </div>
          )}

          <div className="h-hero-bottom" data-rise data-rise-now data-rise-delay="0.45">
            <p className="h-lede">
              The diff shows <b>what</b> changed. Intent Replay shows <b>why</b>: what the agent read, ran and said at every step, and whether its “all tests
              pass” was true.
            </p>
            <div className="h-ctas">
              {hero && (
                <button className="cta cta-primary vf" onClick={() => onSample(hero.id)}>
                  <span>See a run</span>
                  <Icon name="next" size={18} />
                </button>
              )}
              <button className="cta vf" onClick={pick}>
                <span>Open a log</span>
                <Icon name="upload" size={16} />
              </button>
            </div>
            <p className="h-privacy">
              <Icon name="lock" size={13} /> Runs in your browser · nothing uploaded · secrets masked
            </p>
          </div>
        </div>
        <div className="scroll-cue" aria-hidden="true">
          <span>Scroll</span>
          <i />
        </div>
      </section>

      {/* ------------------------------------------------------------ claims marquee */}
      <section className="h-claims" aria-label="Claims Intent Replay checks">
        <Marquee duration={44}>
          {TICKER.map(([t, v]) => (
            <span key={t} className="big-claim">
              <q>
                <Rich text={t} />
              </q>
              <span className={`big-stamp ${v}`}>{v}</span>
            </span>
          ))}
        </Marquee>
      </section>

      <div className="h-wrap">
        {sessions && (
          <section className="h-section">
            <div className="h-head">
              <p className="eyebrow-mono">On this machine</p>
              <h2 className="h-h2" data-reveal>
                Your sessions
              </h2>
              <p className="h-sub">{cwd ? `Newest first · ${cwd}` : 'Newest first'}</p>
            </div>
            <div className="sessions">
              {sessions.length === 0 && <div className="empty">No Claude Code or Codex sessions found.</div>}
              {sessions.slice(0, 40).map((s) => (
                <button key={s.key ?? s.id} className="session-row" onClick={() => onSession(s)}>
                  <span className={`chip ${s.agent === 'codex' ? 'low' : 'accent'}`}>{s.agent === 'codex' ? 'Codex' : 'Claude'}</span>
                  <span className="t" title={s.title}>
                    {s.title}
                  </span>
                  <span className="m">{ago(s.mtime)}</span>
                  <span className="m">{(s.size / 1024 / 1024).toFixed(1)} MB</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ------------------------------------------------------------ how it works */}
      {hero && <HowItWorks trace={hero.trace} analysis={hero.analysis} raw={hero.text} />}

      <div className="h-wrap">
        {/* ---------------------------------------------------------- samples */}
        {cards.length > 0 && (
          <section className="h-section" id="samples">
            <div className="h-head">
              <p className="eyebrow-mono">Sample runs</p>
              <h2 className="h-h2" data-reveal>
                Three runs. <em>One</em> of them lied.
              </h2>
              <p className="h-sub">One scripted scenario with real test output, two real recorded runs.</p>
            </div>
            <SampleList rows={cards} onOpen={onSample} />
            {cards.some((c) => c.id === 'csv-quotes-claude') && cards.some((c) => c.id === 'csv-quotes-codex') && (
              <button className="compare-strip vf" onClick={() => onCompare(['csv-quotes-claude', 'csv-quotes-codex'])} data-rise>
                <span className="cs-vs">VS</span>
                <span className="cs-text">
                  <b>Same bug, two agents.</b> Claude Code and Codex CLI got the identical task. Compare how each explored, changed, verified and reported.
                </span>
                <Icon name="next" size={20} />
              </button>
            )}
          </section>
        )}

        {/* ---------------------------------------------------------- features */}
        <section className="h-section">
          <div className="h-head">
            <p className="eyebrow-mono">What you get</p>
            <h2 className="h-h2" data-reveal>
              Everything the diff <em>doesn’t</em> tell you.
            </h2>
            <p className="h-sub">Deterministic rules over the log. No AI, no API keys, no account.</p>
          </div>
          <div className="bento" data-stagger>
            <MagicCard className="tile t-claims">
              <span className="tile-icon" style={{ color: 'var(--high)', background: 'var(--fail-soft)' }}>
                <Icon name="quote" />
              </span>
              <h3>Claims, fact-checked</h3>
              <p>Every claim in the agent's summary is stamped against the commands that really ran, with the step that proves it.</p>
              <div className="tile-stamps">
                <span className="stamp supported">Supported</span>
                <span className="stamp contradicted">Contradicted</span>
                <span className="stamp stale">Stale</span>
                <span className="stamp unverified">Unverified</span>
              </div>
            </MagicCard>
            <MagicCard className="tile t-blame">
              <span className="tile-icon" style={{ color: 'var(--edit)', background: 'var(--edit-soft)' }}>
                <Icon name="code" />
              </span>
              <h3>Blame, but for intent</h3>
              <p>Click a changed line: the step that wrote it, the reason given, and whether the agent had even read the file.</p>
              <div className="tile-diff mono">
                <div className="del">− assert.equal(total, 53.97);</div>
                <div className="add">
                  + assert.equal(total, 54);<span className="tile-why">#14 · after a failing run</span>
                </div>
              </div>
            </MagicCard>
            <MagicCard className="tile t-replay">
              <span className="tile-icon" style={{ color: 'var(--read)', background: 'var(--read-soft)' }}>
                <Icon name="rewind" />
              </span>
              <h3>Replay the run</h3>
              <p>Scrub every read, edit and command, chapter by chapter.</p>
              {hero && (
                <div className="tile-tape" aria-hidden="true">
                  {hero.bars.map((b, i) => (
                    <span key={i} style={{ background: b.c, height: `${b.h}%` }} />
                  ))}
                </div>
              )}
            </MagicCard>
            <MagicCard className="tile t-rules">
              <span className="tile-icon" style={{ color: 'var(--accent-text)', background: 'var(--accent-soft)' }}>
                <Icon name="shield" />
              </span>
              <h3>12 checks a reviewer would run</h3>
              <div className="tile-rules">
                {(Object.keys(RULE_INFO) as RuleId[]).map((r) => (
                  <span key={r} className="chip">
                    {RULE_INFO[r].name}
                  </span>
                ))}
              </div>
            </MagicCard>
            <MagicCard className="tile t-live">
              <span className="tile-icon" style={{ color: 'var(--high)', background: 'var(--fail-soft)' }}>
                <span className="live-dot" />
              </span>
              <h3>Live while it works</h3>
              <p>
                <code>intent-replay watch</code> follows a session as the agent writes it.
              </p>
            </MagicCard>
            <MagicCard className="tile t-compare">
              <span className="tile-icon" style={{ color: 'var(--verify)', background: 'var(--verify-soft)' }}>
                <Icon name="layers" />
              </span>
              <h3>Compare agents</h3>
              <p>Two runs of one task, side by side: exploration, proof, claims.</p>
            </MagicCard>
          </div>

          <div className="stats-band" data-stagger>
            <div>
              <b>
                <NumberTicker value={12} />
              </b>
              <span>checks on every run</span>
            </div>
            <div>
              <b>
                <NumberTicker value={2} />
              </b>
              <span>agents: Claude Code and Codex CLI</span>
            </div>
            <div>
              <b>
                <NumberTicker value={530} suffix=" MB" />
              </b>
              <span>largest real session tested, opens in seconds</span>
            </div>
            <div>
              <b>
                <NumberTicker value={0} suffix=" bytes" />
              </b>
              <span>uploaded anywhere</span>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- use it */}
        <section className="h-section">
          <div className="h-head">
            <p className="eyebrow-mono">Use it where you work</p>
            <h2 className="h-h2" data-reveal>
              One command. <em>Or</em> one line in CI.
            </h2>
          </div>
          <div className="cli-block" data-stagger>
            <div className="terminal">
              <span className="p">$</span> npm i -g github:Dakshhhhh-ops/intent{'\n'}
              <span className="p">$</span> intent-replay{'\n'}
              <span className="d">Sessions for ~/code/shop</span>
              {'\n'}
              {'  '}1 <span className="p">claude</span> <span className="d">2m ago </span> Fix the cart total rounding bug{'\n'}
              {'  '}2 <span className="g">codex </span> <span className="d">1h ago </span> Add CSV export to orders{'\n'}
              <span className="g">●</span> Intent Replay is running at http://127.0.0.1:4848/{'\n\n'}
              <span className="p">$</span> intent-replay check latest{'\n'}
              <span className="r">■ Needs review</span> <span className="d">3 high, 2 medium findings</span>
              {'\n'}
              {'  '}
              <span className="r">contradicted</span> “All tests pass.”{'\n'}
              {'  '}
              <span className="r">high  </span> Tests in cart.test.js were weakened
            </div>
            <div className="terminal">
              <span className="d"># .github/workflows/agent-review.yml</span>
              {'\n'}- run: npx -y github:Dakshhhhh-ops/intent report $AGENT_LOG <span className="y">--out</span> report.md{'\n'}
              - run: npx -y github:Dakshhhhh-ops/intent check $AGENT_LOG <span className="y">--fail-on</span> high{'\n\n'}
              <span className="d"># follow a run while the agent works</span>
              {'\n'}
              <span className="p">$</span> intent-replay watch{'\n\n'}
              <span className="d"># or share one offline file with a reviewer</span>
              {'\n'}
              <span className="p">$</span> intent-replay export latest <span className="y">-o</span> replay.html{'\n'}
              <span className="g">✓</span> wrote replay.html <span className="d">(self-contained, secrets masked)</span>
            </div>
          </div>

          <div
            className={`dropstrip vf ${over ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={() => setOver(false)}
            data-rise
          >
            <div className="drop-icon">
              <Icon name="upload" size={20} />
            </div>
            <div className="drop-text">
              <h3>Drop a session log anywhere on this page</h3>
              <p>
                Claude Code <code>~/.claude/projects/&lt;project&gt;/*.jsonl</code> · Codex CLI <code>~/.codex/sessions/**/rollout-*.jsonl</code>
              </p>
            </div>
            <button className="cta vf" onClick={pick}>
              <span>Choose file</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".jsonl,.json,.txt,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </div>
          {error && (
            <div className="error-box" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}
        </section>
      </div>

      <SiteFooter onSample={hero ? () => onSample(hero.id) : undefined} />
    </div>
  );
}
