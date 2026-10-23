import { useMemo, useRef, useState } from 'react';
import { analyze } from '../core/analyze';
import { parseTrace } from '../core/parse/detect';
import type { Analysis, Claim, Step, Trace } from '../core/types';
import { SAMPLES } from '../samples';
import type { CliSession } from './App';
import { CrtSection } from './fx3d/CrtSection';
import { SiteFooter } from './fx3d/SiteFooter';
import { CursorFollower, RecTimecode } from './home/Extras';
import { CaseFiles, type CaseRow } from './home/CaseFiles';
import { DiffVsReplay } from './home/DiffVsReplay';
import { Gauges } from './home/Gauges';
import { HeroBlackBox } from './home/HeroBlackBox';
import { HorizontalStory } from './home/HorizontalStory';
import { SessionPicker } from './home/SessionPicker';
import { TerminalDemo } from './home/TerminalDemo';
import { useHomeMotion } from './home/useHomeMotion';
import { Icon } from './Icon';
import { DotPattern, Marquee, Spotlight } from './oss/Elements';
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

type Card = CaseRow & { trace: Trace; analysis: Analysis; text: string; contradicted: number };

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
  const pick = () => input.current?.click();

  return (
    <div className="home" ref={root}>
      <CursorFollower />
      <div className="grain" aria-hidden="true" />

      {/* ------------------------------------------------------------ hero */}
      <section className="h2-hero">
        <DotPattern />
        <Spotlight />
        <div className="h2-grid">
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

          <h1 className="h2-title" data-reveal data-reveal-now>
            Debug what your agent <em>actually</em> did.
          </h1>

          <div className="h2-stage" data-rise data-rise-now data-rise-delay="0.2">
            {hero && <HeroBlackBox trace={hero.trace} analysis={hero.analysis} onOpen={() => onSample(hero.id)} />}
          </div>

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

      {hero && <CrtSection trace={hero.trace} analysis={hero.analysis} onOpen={() => onSample(hero.id)} />}

      <div className="h-wrap">
        {sessions && (
          <section className="h-section">
            <div className="h-head">
              <p className="eyebrow-mono">On this machine</p>
              <h2 className="h-h2" data-reveal>
                Your sessions
              </h2>
              <p className="h-sub">Every Claude Code and Codex session on this machine, newest first. Pick one to replay it.</p>
            </div>
            <SessionPicker sessions={sessions} cwd={cwd} onOpen={onSession} />
          </section>
        )}
      </div>

      {/* ------------------------------------------------------------ how it works */}
      {hero && <HorizontalStory trace={hero.trace} analysis={hero.analysis} raw={hero.text} />}

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
            <CaseFiles
              rows={cards}
              onOpen={onSample}
              onCompare={cards.some((c) => c.id === 'csv-quotes-claude') && cards.some((c) => c.id === 'csv-quotes-codex') ? () => onCompare(['csv-quotes-claude', 'csv-quotes-codex']) : undefined}
            />
          </section>
        )}

        {/* ---------------------------------------------------------- features */}
        <section className="h-section">
          <div className="h-head">
            <p className="eyebrow-mono">What you get</p>
            <h2 className="h-h2" data-reveal>
              The diff says <em>what.</em> The replay says <em>why.</em>
            </h2>
            <p className="h-sub">Drag the divider. On the left, the diff and summary you would normally approve. On the right, the same change as Intent Replay shows it.</p>
          </div>
          {hero && <DiffVsReplay trace={hero.trace} analysis={hero.analysis} />}
        </section>

        <section className="h-section">
          <div className="h-head">
            <p className="eyebrow-mono">Instrument panel</p>
            <h2 className="h-h2" data-reveal>
              Built to read <em>real</em> runs.
            </h2>
          </div>
          <Gauges />
        </section>

        {/* ---------------------------------------------------------- use it */}
        <section className="h-section">
          <div className="h-head">
            <p className="eyebrow-mono">Use it where you work</p>
            <h2 className="h-h2" data-reveal>
              One command. <em>Or</em> one line in CI.
            </h2>
          </div>
          <TerminalDemo />

          <div
            className={`dock ${over ? 'over' : ''}`}
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
