import type { ReactNode } from 'react';
import { isVerify } from '../core/analyze/commands';
import { formatDuration } from '../core/report/markdown';
import type { PhaseKind } from '../core/types';
import { isDocFile } from '../core/util';
import { DiffView } from './DiffView';
import { Icon } from './Icon';
import { agentName, fmtTokens, PHASE_LABEL, type RunData } from './model';

// Two runs of the same task, side by side: how each agent explored, changed, verified and reported.

interface Metrics {
  readsBeforeEdit: number;
  searchesBeforeEdit: number;
  edits: number;
  verifies: number;
  verifyFails: number;
  verifiedAtEnd: boolean;
  claims: Record<string, number>;
}

function metrics(r: RunData): Metrics {
  const steps = r.trace.steps;
  const firstEdit = steps.find((s) => s.edit)?.id ?? steps.length;
  const before = steps.slice(0, firstEdit);
  const codeEdits = steps.filter((s) => s.edit && !isDocFile(s.edit.path));
  const lastEdit = codeEdits[codeEdits.length - 1]?.id ?? -1;
  const verifies = steps.filter((s) => s.command && isVerify(s.command.categories));
  const claims: Record<string, number> = { supported: 0, contradicted: 0, stale: 0, unverified: 0 };
  for (const c of r.analysis.claims) claims[c.verdict]++;
  return {
    readsBeforeEdit: new Set(before.filter((s) => s.read).flatMap((s) => [s.read!.path, ...s.files])).size,
    searchesBeforeEdit: before.filter((s) => s.kind === 'search').length,
    edits: steps.filter((s) => s.edit).length,
    verifies: verifies.length,
    verifyFails: verifies.filter((s) => s.command!.failed).length,
    verifiedAtEnd: verifies.some((s) => s.id > lastEdit && !s.command!.failed),
    claims,
  };
}

const PHASE_VAR: Record<PhaseKind, string> = {
  ask: 'var(--prompt)',
  explore: 'var(--read)',
  change: 'var(--edit)',
  verify: 'var(--verify)',
  repair: 'var(--repair)',
  report: 'var(--create)',
};

export function Compare({ runs, onOpen, onBack }: { runs: [RunData, RunData]; onOpen: (i: 0 | 1) => void; onBack: () => void }) {
  const m = runs.map(metrics) as [Metrics, Metrics];
  const shared = runs[0].analysis.files.map((f) => f.path).filter((p) => runs[1].fileByPath.has(p));
  const task = runs[0].trace.steps.find((s) => s.kind === 'prompt')?.text;

  const row = (label: string, render: (r: RunData, m: Metrics, i: number) => ReactNode, hint?: string) => (
    <div className="cmp-row">
      <div className="cmp-label">
        {label}
        {hint && <span>{hint}</span>}
      </div>
      {runs.map((r, i) => (
        <div key={i} className="cmp-cell">
          {render(r, m[i], i)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="page compare">
      <button className="link-btn" onClick={onBack} style={{ marginBottom: 14 }}>
        <Icon name="prev" size={13} /> Back
      </button>
      <h1 className="cmp-title">Same task, two runs</h1>
      {task && <p className="cmp-task">“{task}”</p>}

      <div className="cmp-grid">
        <div className="cmp-row cmp-head">
          <div className="cmp-label" />
          {runs.map((r, i) => (
            <div key={i} className="cmp-cell">
              <div className="cmp-agent">
                <span className={`chip ${r.trace.source === 'codex' ? 'low' : 'accent'}`}>{agentName(r.trace)}</span>
                {r.trace.model && <span className="cmp-model">{r.trace.model}</span>}
              </div>
              <span className={`verdict-pill ${r.analysis.verdict.level}`}>
                <span className="dot" />
                {r.analysis.verdict.label}
              </span>
              <button className="btn" style={{ marginTop: 10 }} onClick={() => onOpen(i as 0 | 1)}>
                Open this run <Icon name="next" size={14} />
              </button>
            </div>
          ))}
        </div>

        <h2 className="cmp-section">How it went</h2>
        {row('Chapters', (r) => (
          <div className="cmp-phases" title="Each chapter's width is its share of steps">
            {r.analysis.phases.map((p, j) => (
              <span key={j} style={{ flexGrow: p.to - p.from + 1, background: PHASE_VAR[p.kind] }} title={`${PHASE_LABEL[p.kind]}: ${p.summary}`} />
            ))}
          </div>
        ))}
        {row('Duration', (r) => formatDuration(r.analysis.stats.durationMs))}
        {row('Steps', (r) => `${r.analysis.stats.steps} (${r.analysis.stats.toolCalls} tool calls)`)}
        {row('Tokens', (r) => (r.analysis.stats.tokensOut ? `${fmtTokens(r.analysis.stats.tokensIn + r.analysis.stats.tokensCached)} in · ${fmtTokens(r.analysis.stats.tokensOut)} out` : '—'))}

        <h2 className="cmp-section">Before changing anything</h2>
        {row('Files read first', (_r, mm) => <Strong n={mm.readsBeforeEdit} good={mm.readsBeforeEdit > 0} />, 'before the first edit')}
        {row('Searches first', (_r, mm) => mm.searchesBeforeEdit)}

        <h2 className="cmp-section">The change</h2>
        {row('Edits', (r, mm) => `${mm.edits} edit${mm.edits === 1 ? '' : 's'} to ${r.analysis.stats.filesChanged} file${r.analysis.stats.filesChanged === 1 ? '' : 's'}`)}
        {row('Lines', (r) => (
          <>
            <span className="plus">+{r.analysis.stats.linesAdded}</span> <span className="minus">−{r.analysis.stats.linesRemoved}</span>
          </>
        ))}

        <h2 className="cmp-section">Proof</h2>
        {row('Checks run', (_r, mm) => `${mm.verifies} (${mm.verifyFails} failed)`)}
        {row('Verified the final change', (_r, mm) => <YesNo ok={mm.verifiedAtEnd} />)}
        {row('Claims', (_r, mm) => (
          <span className="cmp-claims">
            {mm.claims.supported > 0 && <span className="chip ok">{mm.claims.supported} supported</span>}
            {mm.claims.contradicted > 0 && <span className="chip high">{mm.claims.contradicted} contradicted</span>}
            {mm.claims.stale > 0 && <span className="chip medium">{mm.claims.stale} stale</span>}
            {mm.claims.unverified > 0 && <span className="chip">{mm.claims.unverified} unverified</span>}
            {Object.values(mm.claims).every((n) => n === 0) && '—'}
          </span>
        ))}
        {row('Findings', (r) => {
          const by = (s: string) => r.analysis.findings.filter((f) => f.severity === s).length;
          return r.analysis.findings.length ? (
            <span className="cmp-claims">
              {by('high') > 0 && <span className="chip high">{by('high')} high</span>}
              {by('medium') > 0 && <span className="chip medium">{by('medium')} medium</span>}
              {by('low') > 0 && <span className="chip low">{by('low')} low</span>}
            </span>
          ) : (
            <span style={{ color: 'var(--ok)' }}>none</span>
          );
        })}
        {row('What it said at the end', (r) => {
          const last = [...r.trace.steps].reverse().find((s) => s.kind === 'message');
          return <p className="cmp-final">{last?.text ? last.text.slice(0, 420) + (last.text.length > 420 ? '…' : '') : '—'}</p>;
        })}
      </div>

      {shared.map((p) => (
        <section key={p} className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h2>
              <Icon name="code" /> {p}
            </h2>
            <span className="hint">Both runs changed this file</span>
          </div>
          <div className="cmp-diffs">
            {runs.map((r, i) => (
              <div key={i} className="cmp-diff">
                <div className="cmp-diff-head">{agentName(r.trace)}</div>
                <DiffView lines={r.fileByPath.get(p)!.diff} max={800} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Strong({ n, good }: { n: number; good: boolean }) {
  return <b style={{ color: good ? 'var(--text)' : 'var(--high)' }}>{n}</b>;
}

function YesNo({ ok }: { ok: boolean }) {
  return (
    <span style={{ color: ok ? 'var(--ok)' : 'var(--high)', display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
      <Icon name={ok ? 'check' : 'x'} size={14} /> {ok ? 'Yes' : 'No'}
    </span>
  );
}
