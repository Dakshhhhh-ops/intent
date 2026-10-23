import { useRef } from 'react';
import type { Analysis, Claim } from '../../core/types';
import { Icon } from '../Icon';
import { Rich } from '../Rich';

// Sample runs as evidence dossiers: tilt with the pointer, a holographic glare, a stamp.

export interface CaseRow {
  id: string;
  title: string;
  blurb: string;
  label: string;
  agent: string;
  steps: number;
  files: number;
  bars: { c: string; h: number }[];
  claims: Claim[];
  analysis: Analysis;
}

function CaseCard({ row, index, onOpen }: { row: CaseRow; index: number; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${(0.5 - y) * 14}deg`);
    el.style.setProperty('--ry', `${(x - 0.5) * 18}deg`);
    el.style.setProperty('--gx', `${x * 100}%`);
    el.style.setProperty('--gy', `${y * 100}%`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };
  const bad = row.claims.find((c) => c.verdict === 'contradicted');
  const shown = bad ?? row.claims[0];
  const cleared = row.analysis.verdict.level === 'clean';
  const high = row.analysis.findings.filter((f) => f.severity === 'high').length;

  return (
    <button ref={ref} className={`case ${cleared ? 'cleared' : 'flagged'}`} onPointerMove={move} onPointerLeave={leave} onClick={onOpen}>
      <span className="case-tab">
        CASE {String(index + 1).padStart(2, '0')} · {row.label}
      </span>
      <span className="case-inner">
        <span className="case-glare" aria-hidden="true" />
        <span className="case-top">
          <span className="case-agent">{row.agent}</span>
          <span className="case-meta">
            {row.steps} steps · {row.files} file{row.files === 1 ? '' : 's'}
          </span>
        </span>
        <span className="case-title">{row.title}</span>
        {shown && (
          <span className="case-quote">
            <q>
              <Rich text={shown.text.length > 80 ? shown.text.slice(0, 78) + '…' : shown.text} />
            </q>
            <span className="case-said">— the agent, step {shown.step + 1}</span>
          </span>
        )}
        <span className="case-blurb">{row.blurb}</span>
        <span className="case-barcode" aria-hidden="true">
          {row.bars.map((b, i) => (
            <i key={i} style={{ background: b.c, height: `${40 + b.h * 0.6}%` }} />
          ))}
        </span>
        <span className="case-foot">
          <span>{cleared ? 'All checks clean' : `${high} high · ${row.analysis.findings.length} findings`}</span>
          <span className="case-open">
            Open file <Icon name="next" size={14} />
          </span>
        </span>
        <span className={`case-stamp ${cleared ? 'ok' : 'bad'}`}>{cleared ? 'Cleared' : 'Contradicted'}</span>
      </span>
    </button>
  );
}

export function CaseFiles({ rows, onOpen, onCompare }: { rows: CaseRow[]; onOpen: (id: string) => void; onCompare?: () => void }) {
  const a = rows.find((r) => r.id === 'csv-quotes-claude');
  const b = rows.find((r) => r.id === 'csv-quotes-codex');
  const stat = (r: CaseRow) => ({
    steps: r.steps,
    tokens: r.analysis.stats.tokensIn + r.analysis.stats.tokensCached + r.analysis.stats.tokensOut,
    secs: Math.round((r.analysis.stats.durationMs ?? 0) / 1000),
    lines: r.analysis.stats.linesAdded + r.analysis.stats.linesRemoved,
  });
  return (
    <>
      <div className="cases" data-stagger>
        {rows.map((r, i) => (
          <CaseCard key={r.id} row={r} index={i} onOpen={() => onOpen(r.id)} />
        ))}
      </div>
      {a && b && onCompare && (
        <button className="versus" onClick={onCompare} data-rise>
          {[a, b].map((r, i) => {
            const s = stat(r);
            return (
              <span key={r.id} className={`vs-side ${i ? 'right' : 'left'}`}>
                <span className="vs-agent">{r.agent}</span>
                <span className="vs-nums">
                  <span>
                    <b>{s.steps}</b> steps
                  </span>
                  <span>
                    <b>{s.secs}s</b> run
                  </span>
                  <span>
                    <b>{s.lines}</b> lines changed
                  </span>
                  <span>
                    <b>{(s.tokens / 1000).toFixed(0)}k</b> tokens
                  </span>
                </span>
              </span>
            );
          })}
          <span className="vs-mid">
            <span className="vs-orb">VS</span>
            <span className="vs-cta">
              Same bug, two agents. Compare side by side <Icon name="next" size={14} />
            </span>
          </span>
        </button>
      )}
    </>
  );
}
