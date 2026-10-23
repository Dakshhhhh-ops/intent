import { useMemo, useRef, useState } from 'react';
import { analyze } from '../core/analyze';
import { RULE_INFO } from '../core/analyze/rules';
import { parseTrace } from '../core/parse/detect';
import type { Claim, RuleId, Step } from '../core/types';
import { SAMPLES } from '../samples';
import type { CliSession } from './App';
import { Icon } from './Icon';
import { BorderBeam, DotPattern, MagicCard, Marquee, NumberTicker, ShinyText, Spotlight } from './oss/Elements';
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

// Sentences the claim checker recognizes, with the verdicts it can give them.
const TICKER: [string, Claim['verdict']][] = [
  ['All tests pass.', 'contradicted'],
  ['Only changed `cart.js`.', 'supported'],
  ['The build succeeds.', 'unverified'],
  ["Didn't change any tests.", 'contradicted'],
  ['I fixed the rounding bug.', 'supported'],
  ['Type check passes.', 'stale'],
  ['Lint is clean.', 'unverified'],
  ['All 6 tests pass.', 'contradicted'],
];

const VERDICT: Record<Claim['verdict'], string> = { supported: 'Supported', contradicted: 'Contradicted', stale: 'Stale', unverified: 'Unverified' };

type Card = (typeof SAMPLES)[number] & {
  verdict: { level: string; label: string };
  steps: number;
  files: number;
  findings: number;
  bars: { c: string; h: number }[];
  contradicted: number;
  claims: Claim[];
  task: string;
};

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
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
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
            ...s,
            verdict: a.verdict,
            steps: n,
            files: a.stats.filesChanged,
            findings: a.findings.length,
            bars,
            contradicted: a.claims.filter((c) => c.verdict === 'contradicted').length,
            claims: a.claims,
            task: t.steps.find((x) => x.kind === 'prompt')?.text ?? t.title,
          };
        } catch {
          return null;
        }
      }).filter(Boolean) as Card[],
    [],
  );
  const hero = cards.find((c) => c.contradicted > 0) ?? cards[0];
  const pick = () => input.current?.click();

  return (
    <div className="home">
      <section className="hero">
        <DotPattern />
        <Spotlight />
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="pill">
              <span className="pill-dot" />
              <ShinyText>A flight recorder for AI coding agents</ShinyText>
            </span>
            <h1>
              Debug what your AI agent <em>actually</em> did.
            </h1>
            <p className="lede">
              The diff shows what changed. Intent Replay shows <b>why</b>: what the agent read, ran and said at every step, and whether its “all tests pass” was
              true.
            </p>
            <div className="hero-ctas">
              {hero && (
                <button className="btn primary big oss-shimmer" onClick={() => onSample(hero.id)}>
                  <Icon name="play" size={14} /> See it on a sample run
                </button>
              )}
              <button className="btn big" onClick={pick}>
                <Icon name="upload" size={15} /> Open a session log
              </button>
            </div>
            <p className="privacy-note">
              <Icon name="lock" size={14} /> Runs in your browser. Nothing is uploaded. Secrets are masked.
            </p>
          </div>

          {hero && (
            <button className="hero-preview" onClick={() => onSample(hero.id)} aria-label="Open the sample run">
              <BorderBeam />
              <div className="hp-head">
                <span className="hp-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="hp-title">Claim check</span>
                <span className={`verdict-pill ${hero.verdict.level}`}>
                  <span className="dot" />
                  {hero.verdict.label}
                </span>
              </div>
              <div className="hp-task">
                <Icon name="prompt" size={13} />
                <span>{hero.task}</span>
              </div>
              {hero.claims
                .filter((c) => c.verdict === 'contradicted')
                .slice(0, 2)
                .map((c) => (
                  <div className="hp-claim" key={c.id}>
                    <span className="stamp contradicted">Contradicted</span>
                    <div>
                      <q>
                        <Rich text={c.text.length > 90 ? c.text.slice(0, 88) + '…' : c.text} />
                      </q>
                      <p>
                        <Rich text={c.explanation.length > 120 ? c.explanation.slice(0, 118) + '…' : c.explanation} />
                      </p>
                    </div>
                  </div>
                ))}
              <div className="hp-tape" aria-hidden="true">
                {hero.bars.map((b, i) => (
                  <span key={i} style={{ background: b.c, height: `${b.h}%` }} />
                ))}
              </div>
            </button>
          )}
        </div>
      </section>

      <section className="claims-band" aria-label="Claims Intent Replay checks">
        <Marquee duration={38}>
          {TICKER.map(([t, v]) => (
            <span key={t} className="claim-chip">
              <q>
                <Rich text={t} />
              </q>
              <span className={`stamp ${v}`}>{VERDICT[v]}</span>
            </span>
          ))}
        </Marquee>
      </section>

      <div className="home-body">
        {sessions && (
          <>
            <div className="section-title">
              <h2>Sessions on this machine</h2>
              <p>{cwd ? `Newest first · ${cwd}` : 'Newest first'}</p>
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
          </>
        )}

        <div
          className={`dropstrip ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
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
          <button className="btn" onClick={pick}>
            Choose file…
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

        {cards.length > 0 && (
          <>
            <div className="section-title">
              <h2>Sample runs</h2>
              <p>One scripted scenario, two real recorded runs</p>
            </div>
            <div className="samples">
              {cards.map((c) => (
                <MagicCard key={c.id} as="button" className="sample" onClick={() => onSample(c.id)}>
                  <div className="sample-top">
                    <span className={`verdict-pill ${c.verdict.level}`}>
                      <span className="dot" />
                      {c.verdict.label}
                    </span>
                    <span className="chip">{c.label}</span>
                  </div>
                  <h3>{c.title}</h3>
                  <p>{c.blurb}</p>
                  <div className="mini-tape" aria-hidden="true">
                    {c.bars.map((b, i) => (
                      <span key={i} style={{ background: b.c, height: `${b.h}%` }} />
                    ))}
                  </div>
                  <div className="sample-foot">
                    <span className="chip">{c.agent}</span>
                    <span className="chip">{c.steps} steps</span>
                    <span className="chip">
                      {c.files} file{c.files === 1 ? '' : 's'}
                    </span>
                    {c.contradicted > 0 && (
                      <span className="chip high">
                        {c.contradicted} claim{c.contradicted === 1 ? '' : 's'} contradicted
                      </span>
                    )}
                  </div>
                </MagicCard>
              ))}
            </div>
            {cards.some((c) => c.id === 'csv-quotes-claude') && cards.some((c) => c.id === 'csv-quotes-codex') && (
              <MagicCard as="button" className="compare-card" onClick={() => onCompare(['csv-quotes-claude', 'csv-quotes-codex'])}>
                <span className="vs">VS</span>
                <span style={{ flex: 1 }}>
                  <h3>Compare two agents on the same bug</h3>
                  <p>Claude Code and Codex CLI got the identical task. See how each explored, changed, verified and reported, side by side.</p>
                </span>
                <Icon name="next" />
              </MagicCard>
            )}
          </>
        )}

        <div className="section-title">
          <h2>What you get from one log file</h2>
          <p>Deterministic. No AI, no API keys, no account.</p>
        </div>
        <div className="bento">
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
            <p>Scrub every read, edit and command. Chapters show how the agent explored, changed, verified and repaired.</p>
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

        <div className="stats-band">
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

        <div className="section-title">
          <h2>Use it where you work</h2>
          <p>One command, or one line in CI</p>
        </div>
        <div className="cli-block">
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

        <footer className="footer">
          <span>Intent Replay · MIT licensed · Claude Code, Codex CLI and the open Intent Trace format</span>
          <span>
            Colors: Radix Colors · UI patterns: Magic UI (MIT) ·{' '}
            <a href="https://github.com/Dakshhhhh-ops/intent" target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}
