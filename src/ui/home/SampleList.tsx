import { useRef, useState } from 'react';
import type { Claim } from '../../core/types';
import { Icon } from '../Icon';
import { Rich } from '../Rich';

export interface SampleRow {
  id: string;
  title: string;
  blurb: string;
  label: string;
  agent: string;
  verdict: { level: string; label: string };
  steps: number;
  files: number;
  bars: { c: string; h: number }[];
  claims: Claim[];
}

// Editorial numbered list; a preview card follows the pointer while hovering a row.
export function SampleList({ rows, onOpen }: { rows: SampleRow[]; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const move = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !preview.current) return;
    preview.current.style.transform = `translate(${e.clientX - r.left + 24}px, ${e.clientY - r.top - 90}px)`;
  };
  const row = hover !== null ? rows[hover] : null;
  const claim = row?.claims.find((c) => c.verdict === 'contradicted') ?? row?.claims[0];

  return (
    <div className="slist" ref={box} onPointerMove={move} onPointerLeave={() => setHover(null)} data-stagger>
      {rows.map((r, i) => (
        <button key={r.id} className="slist-row" onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => onOpen(r.id)}>
          <span className="slist-n">{String(i + 1).padStart(2, '0')}</span>
          <span className="slist-title">{r.title}</span>
          <span className="slist-meta">
            <span className="slist-label">{r.label}</span>
            <span>{r.agent}</span>
          </span>
          <span className={`verdict-pill ${r.verdict.level}`}>
            <span className="dot" />
            {r.verdict.label}
          </span>
          <span className="slist-arrow">
            <Icon name="next" size={22} />
          </span>
        </button>
      ))}
      <div className={`slist-preview ${row ? 'on' : ''}`} ref={preview} aria-hidden="true">
        {row && (
          <>
            <p className="slist-blurb">{row.blurb}</p>
            <div className="mini-tape">
              {row.bars.map((b, i) => (
                <span key={i} style={{ background: b.c, height: `${b.h}%` }} />
              ))}
            </div>
            {claim && (
              <div className="slist-claim">
                <span className={`stamp ${claim.verdict}`}>{claim.verdict}</span>
                <q>
                  <Rich text={claim.text.length > 70 ? claim.text.slice(0, 68) + '…' : claim.text} />
                </q>
              </div>
            )}
            <p className="slist-stats">
              {row.steps} steps · {row.files} file{row.files === 1 ? '' : 's'} changed
            </p>
          </>
        )}
      </div>
    </div>
  );
}
