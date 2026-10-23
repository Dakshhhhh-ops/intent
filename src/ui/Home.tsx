import { useMemo, useRef, useState } from 'react';
import { analyze } from '../core/analyze';
import { parseTrace } from '../core/parse/detect';
import type { Step } from '../core/types';
import { SAMPLES } from '../samples';
import type { CliSession } from './App';
import { ChecksRail } from './fx/ChecksRail';
import { ClaimTicker } from './fx/ClaimTicker';
import { ScrollStory } from './fx/ScrollStory';
import { StatsBand } from './fx/StatsBand';
import { Icon } from './Icon';

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
          return { ...s, verdict: a.verdict, steps: n, files: a.stats.filesChanged, findings: a.findings.length, bars, contradicted: a.claims.filter((c) => c.verdict === 'contradicted').length };
        } catch {
          return null;
        }
      }).filter(Boolean) as (typeof SAMPLES[number] & { verdict: { level: string; label: string }; steps: number; files: number; findings: number; bars: { c: string; h: number }[]; contradicted: number })[],
    [],
  );

  return (
    <div className="home">
      <section className="home-hero">
        <div>
          <span className="eyebrow">
            <Icon name="rewind" size={14} /> A flight recorder for AI coding agents
          </span>
          <h1>
            Debug what your AI agent <em>actually</em> did.
          </h1>
          <p className="lede">
            The diff shows what changed. Intent Replay shows <b>why</b>: which files the agent read, what it ran, what failed, and what it said it was doing at
            every step. Then it fact-checks the agent's “all tests pass” against the commands that really ran.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {cards[0] && (
              <button className="btn primary" onClick={() => onSample(cards[0].id)}>
                <Icon name="play" size={14} /> See it on a sample run
              </button>
            )}
            <button className="btn" onClick={() => input.current?.click()}>
              <Icon name="upload" size={15} /> Open a session log
            </button>
          </div>
          <p className="privacy-note" style={{ marginTop: 16 }}>
            <Icon name="lock" size={14} /> Runs entirely in your browser. Logs are never uploaded. Secrets are masked.
          </p>
        </div>

        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
        >
          <div className="drop-icon">
            <Icon name="upload" size={22} />
          </div>
          <h3>Drop an agent session here</h3>
          <p>Claude Code or Codex CLI · .jsonl</p>
          <button className="btn" onClick={() => input.current?.click()}>
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
          {error && (
            <div className="error-box" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="where">
            <div>
              <b>Claude Code</b> <code>~/.claude/projects/&lt;project&gt;/&lt;session&gt;.jsonl</code>
            </div>
            <div>
              <b>Codex CLI</b> <code>~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl</code>
            </div>
            <div>
              On Windows <code>~</code> is <code>C:\Users\&lt;you&gt;</code>. Or skip the hunting: run <code>intent-replay</code> in your project
            </div>
          </div>
        </div>
      </section>

      <ClaimTicker />

      {sessions && (
        <>
          <div className="section-title">
            <h2>Sessions on this machine</h2>
            <p>{cwd ? `Newest first · ${cwd}` : 'Newest first'}</p>
          </div>
          <div className="sessions">
            {sessions.length === 0 && <div className="empty">No Claude Code or Codex sessions found.</div>}
            {sessions.slice(0, 40).map((s) => (
              <button key={s.id} className="session-row" onClick={() => onSession(s)}>
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

      {cards.length > 0 && (
        <>
          <div className="section-title">
            <h2>Sample runs</h2>
            <p>Open one to see the Brief, the replay and the blame view</p>
          </div>
          <div className="samples">
            {cards.map((c) => (
              <button key={c.id} className="sample" onClick={() => onSample(c.id)}>
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
                    <span key={i} style={{ background: b.c, height: `${b.h}%`, opacity: 0.85 }} />
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
              </button>
            ))}
          </div>
          {cards.some((c) => c.id === 'csv-quotes-claude') && cards.some((c) => c.id === 'csv-quotes-codex') && (
            <button className="compare-card" onClick={() => onCompare(['csv-quotes-claude', 'csv-quotes-codex'])}>
              <span className="vs">VS</span>
              <span style={{ flex: 1 }}>
                <h3>Compare two agents on the same bug</h3>
                <p>Claude Code and Codex CLI were given the identical task. See how each explored, changed, verified and reported, side by side.</p>
              </span>
              <Icon name="next" />
            </button>
          )}
        </>
      )}

      <div className="section-title">
        <h2>What you get from one log file</h2>
        <p>Deterministic. No AI, no API keys, no account.</p>
      </div>
      <div className="how">
        <div className="how-card">
          <div className="how-icon" style={{ background: 'var(--fail-soft)', color: 'var(--high)' }}>
            <Icon name="quote" />
          </div>
          <h3>Claims, fact-checked</h3>
          <p>“All tests pass.” “Only changed cart.js.” Every claim in the agent's summary is stamped Supported, Contradicted, Stale or Unverified, with the step that proves it.</p>
        </div>
        <div className="how-card">
          <div className="how-icon" style={{ background: 'var(--edit-soft)', color: 'var(--edit)' }}>
            <Icon name="code" />
          </div>
          <h3>Blame, but for intent</h3>
          <p>Click any changed line: see the step that wrote it, the reason the agent gave, whether it had even read the file, and what had just failed.</p>
        </div>
        <div className="how-card">
          <div className="how-icon" style={{ background: 'var(--read-soft)', color: 'var(--read)' }}>
            <Icon name="rewind" />
          </div>
          <h3>Replay the run</h3>
          <p>Scrub a timeline of every read, edit and command. Watch files light up, and catch weakened tests, blind edits, failure loops and risky commands.</p>
        </div>
      </div>

      <ScrollStory />

      <ChecksRail />

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
          <span className="d"># or share one offline file with a reviewer</span>
          {'\n'}
          <span className="p">$</span> intent-replay export latest <span className="y">-o</span> replay.html{'\n'}
          <span className="g">✓</span> wrote replay.html <span className="d">(self-contained, secrets masked)</span>
        </div>
      </div>

      <StatsBand />

      <footer className="footer">
        <span>Intent Replay · MIT licensed · reads Claude Code and Codex CLI logs, plus the open Intent Trace format</span>
        <a href="https://github.com/Dakshhhhh-ops/intent" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
