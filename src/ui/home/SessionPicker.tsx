import { useMemo, useState } from 'react';
import type { CliSession } from '../App';
import { Icon } from '../Icon';

// Local sessions (CLI mode): a few recent cards, search and filters, and the full list
// tucked into a scrollable panel instead of a page-long table.

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function project(cwd?: string): string {
  if (!cwd) return 'unknown folder';
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || cwd;
}

function size(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function clean(title: string): string {
  return title.replace(/https?:\/\/\S+/g, (u) => u.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0]).replace(/\s+/g, ' ').trim();
}

type Filter = 'all' | 'claude-code' | 'codex' | 'here';

export function SessionPicker({ sessions, cwd, onOpen }: { sessions: CliSession[]; cwd?: string; onOpen: (s: CliSession) => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [all, setAll] = useState(false);
  const here = project(cwd).toLowerCase();

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filter === 'claude-code' && s.agent !== 'claude-code') return false;
      if (filter === 'codex' && s.agent !== 'codex') return false;
      if (filter === 'here' && project(s.cwd).toLowerCase() !== here) return false;
      if (!needle) return true;
      return s.title.toLowerCase().includes(needle) || project(s.cwd).toLowerCase().includes(needle);
    });
  }, [sessions, q, filter, here]);

  const counts = {
    all: sessions.length,
    'claude-code': sessions.filter((s) => s.agent === 'claude-code').length,
    codex: sessions.filter((s) => s.agent === 'codex').length,
    here: sessions.filter((s) => project(s.cwd).toLowerCase() === here).length,
  };
  const cards = list.slice(0, 6);

  return (
    <div className="spick">
      <div className="spick-bar">
        <label className="spick-search">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${sessions.length} sessions`} aria-label="Search sessions" />
        </label>
        <div className="spick-filters" role="group" aria-label="Filter sessions">
          {(
            [
              ['all', 'All'],
              ['here', project(cwd)],
              ['claude-code', 'Claude Code'],
              ['codex', 'Codex'],
            ] as [Filter, string][]
          ).map(([id, label]) =>
            counts[id] > 0 || id === 'all' ? (
              <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label} <span>{counts[id]}</span>
              </button>
            ) : null,
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="spick-empty">No sessions match.</div>
      ) : (
        <div className="spick-grid">
          {cards.map((s, i) => (
            <button key={s.key ?? s.id} className="spick-card" onClick={() => onOpen(s)}>
              <span className="spick-top">
                <span className={`spick-agent ${s.agent}`}>{s.agent === 'codex' ? 'Codex' : 'Claude Code'}</span>
                <span className="spick-time">{ago(s.mtime)}</span>
              </span>
              <span className="spick-project">
                <Icon name="folder" size={13} /> {project(s.cwd)}
              </span>
              <span className="spick-title">{clean(s.title)}</span>
              <span className="spick-foot">
                <span>{size(s.size)}</span>
                <span className="spick-open">
                  {i === 0 && !q && filter === 'all' ? 'Latest · ' : ''}Replay <Icon name="next" size={13} />
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {list.length > cards.length && (
        <>
          <button className="spick-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
            {all ? 'Hide the full list' : `Show all ${list.length} sessions`}
            <Icon name={all ? 'prev' : 'next'} size={14} style={{ transform: 'rotate(90deg)' }} />
          </button>
          {all && (
            <div className="spick-list" data-lenis-prevent>
              {list.slice(cards.length).map((s) => (
                <button key={s.key ?? s.id} className="spick-row" onClick={() => onOpen(s)}>
                  <span className={`spick-agent ${s.agent}`}>{s.agent === 'codex' ? 'Codex' : 'Claude'}</span>
                  <span className="spick-row-project">{project(s.cwd)}</span>
                  <span className="spick-row-title">{clean(s.title)}</span>
                  <span className="spick-row-meta">{ago(s.mtime)}</span>
                  <span className="spick-row-meta">{size(s.size)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
