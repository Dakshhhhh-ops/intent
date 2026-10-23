import { useState } from 'react';
import type { Analysis, Claim, Trace } from '../../core/types';
import { Icon } from '../Icon';
import { Rich } from '../Rich';
import { kindColor } from '../RunStrip';

// Sample runs as an index and a stage: the list on the left picks a run, the stage on the right
// shows what that agent said, what its log shows, and the run itself as a tape.

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
  trace: Trace;
}

const SIGN: Record<Claim['verdict'], string> = { contradicted: '≠', supported: '=', stale: '≈', unverified: '?' };
const WORD: Record<Claim['verdict'], string> = { contradicted: 'Contradicted', supported: 'Supported', stale: 'Stale', unverified: 'Unverified' };

function firstSentence(s: string): string {
  const m = s.match(/^.+?[.!?](?=\s|$)/);
  return m ? m[0] : s;
}

/** The claim worth showing: the worst verdict, then the shortest sentence. */
function headline(claims: Claim[]): Claim | undefined {
  const order = { contradicted: 0, stale: 1, unverified: 2, supported: 3 };
  return [...claims].sort((a, b) => order[a.verdict] - order[b.verdict] || a.text.length - b.text.length)[0];
}

function Stage({ row, index, onOpen }: { row: CaseRow; index: number; onOpen: () => void }) {
  const claim = headline(row.claims);
  const proof = claim?.evidence[0];
  const verdict = claim?.verdict ?? 'supported';
  const a = row.analysis;
  const high = a.findings.filter((f) => f.severity === 'high').length;
  const held = a.claims.filter((c) => c.verdict === 'supported').length;
  const n = row.trace.steps.length;
  const at = (id: number) => `${((id + 0.5) / n) * 100}%`;

  return (
    <div className={`sx-stage ${verdict}`} key={row.id}>
      <div className="sx-stage-top">
        <span className="sx-agent">{row.agent}</span>
        <span>
          Case {String(index + 1).padStart(2, '0')} · {row.label}
        </span>
        <span className="sx-right">
          {row.steps} steps · {row.files} file{row.files === 1 ? '' : 's'}
        </span>
      </div>

      {claim && (
        <div className="sx-claim">
          <p className="sx-lbl">The agent said · step {claim.step + 1}</p>
          <blockquote className={claim.text.length > 46 ? 'long' : ''}>
            <Rich text={claim.text} />
          </blockquote>
          <span className="sx-seal" aria-label={WORD[verdict]}>
            <b>{SIGN[verdict]}</b>
            <i>{WORD[verdict]}</i>
          </span>
          <p className="sx-lbl">The log shows{proof !== undefined ? ` · step ${proof + 1}` : ''}</p>
          <p className="sx-fact">
            <Rich text={firstSentence(claim.explanation)} />
          </p>
        </div>
      )}

      <div className="sx-tape" aria-hidden="true">
        <div className="sx-pins">
          {claim && <span style={{ left: at(claim.step) }}>said</span>}
          {proof !== undefined && (
            <span className="proof" style={{ left: at(proof) }}>
              proof
            </span>
          )}
        </div>
        <div className="sx-blocks">
          {row.trace.steps.map((s, i) => (
            <i
              key={s.id}
              className={s.id === claim?.step ? 'said' : s.id === proof ? 'proof' : ''}
              style={{ background: kindColor(s), ['--i' as string]: i }}
            />
          ))}
        </div>
      </div>

      <div className="sx-foot">
        <span className="sx-stat">
          <b>{n}</b> steps
        </span>
        <span className={`sx-stat ${high ? 'bad' : ''}`}>
          <b>{a.findings.length}</b> findings{high ? ` · ${high} high` : ''}
        </span>
        <span className={`sx-stat ${held < a.claims.length ? 'bad' : 'good'}`}>
          <b>
            {held}/{a.claims.length}
          </b>{' '}
          claims hold up
        </span>
        <button className="cta cta-primary vf sx-open" onClick={onOpen}>
          <span>Open this run</span>
          <Icon name="next" size={18} />
        </button>
      </div>
    </div>
  );
}

function Duel({ a, b, onCompare }: { a: CaseRow; b: CaseRow; onCompare: () => void }) {
  const stat = (r: CaseRow) => {
    const s = r.analysis.stats;
    return [
      { k: 'Steps', v: r.steps, fmt: String(r.steps) },
      { k: 'Time', v: Math.round((s.durationMs ?? 0) / 1000), fmt: `${Math.round((s.durationMs ?? 0) / 1000)}s` },
      { k: 'Lines changed', v: s.linesAdded + s.linesRemoved, fmt: String(s.linesAdded + s.linesRemoved) },
      { k: 'Tokens', v: s.tokensIn + s.tokensCached + s.tokensOut, fmt: `${Math.round((s.tokensIn + s.tokensCached + s.tokensOut) / 1000)}k` },
    ];
  };
  const sa = stat(a);
  const sb = stat(b);
  return (
    <button className="sx-duel" onClick={onCompare}>
      <span className="sx-duel-head">
        <span className="sx-duel-a">{a.agent}</span>
        <span className="sx-duel-mid">
          Same bug, two agents
          <small>
            Compare side by side <Icon name="next" size={13} />
          </small>
        </span>
        <span className="sx-duel-b">{b.agent}</span>
      </span>
      {sa.map((x, i) => {
        const y = sb[i];
        const max = Math.max(x.v, y.v, 1);
        return (
          <span className="sx-duel-row" key={x.k}>
            <span className="sx-bar l">
              <b>{x.fmt}</b>
              <span className="sx-track">
                <i style={{ width: `${(x.v / max) * 100}%` }} />
              </span>
            </span>
            <span className="sx-duel-k">{x.k}</span>
            <span className="sx-bar r">
              <span className="sx-track">
                <i style={{ width: `${(y.v / max) * 100}%` }} />
              </span>
              <b>{y.fmt}</b>
            </span>
          </span>
        );
      })}
    </button>
  );
}

export function CaseFiles({ rows, onOpen, onCompare }: { rows: CaseRow[]; onOpen: (id: string) => void; onCompare?: () => void }) {
  const [active, setActive] = useState(0);
  const a = rows.find((r) => r.id === 'csv-quotes-claude');
  const b = rows.find((r) => r.id === 'csv-quotes-codex');
  const row = rows[active] ?? rows[0];

  return (
    <>
      <div className="sx">
        <ol className="sx-list" role="list">
          {rows.map((r, i) => {
            const claim = headline(r.claims);
            const bad = r.analysis.verdict.level !== 'clean';
            return (
              <li key={r.id}>
                <button
                  className={`sx-item ${i === active ? 'on' : ''} ${bad ? 'bad' : 'ok'}`}
                  aria-pressed={i === active}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
                  onFocus={() => setActive(i)}
                  // On touch the first tap picks the run, the second opens it.
                  onClick={() => (i === active ? onOpen(r.id) : setActive(i))}
                >
                  <span className="sx-n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="sx-body">
                    <span className="sx-title">{r.title}</span>
                    <span className="sx-meta">
                      {r.agent} · {r.label}
                    </span>
                  </span>
                  <span className="sx-tag">{claim ? WORD[claim.verdict] : bad ? 'Flagged' : 'Clean'}</span>
                </button>
              </li>
            );
          })}
          <li className="sx-blurb">{row.blurb}</li>
        </ol>
        <Stage row={row} index={rows.indexOf(row)} onOpen={() => onOpen(row.id)} />
      </div>
      {a && b && onCompare && <Duel a={a} b={b} onCompare={onCompare} />}
    </>
  );
}
