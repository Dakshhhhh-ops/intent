import { useContext, useEffect, useState } from 'react';
import { ExportMenu } from './ExportMenu';
import { Icon, Logo } from './Icon';
import { NavContext, RunContext, type Tab } from './model';

type Theme = 'system' | 'dark' | 'light';

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem('ir-theme');
    return t === 'dark' || t === 'light' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('ir-theme', theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  // Dark unless the viewer picked light.
  const effective = theme === 'light' ? 'light' : 'dark';
  return [theme, () => setTheme(effective === 'dark' ? 'light' : 'dark')];
}

const TAB_INFO: { id: Tab; label: string; icon: string; key: string }[] = [
  { id: 'brief', label: 'Brief', icon: 'target', key: '1' },
  { id: 'replay', label: 'Replay', icon: 'rewind', key: '2' },
  { id: 'changes', label: 'Changes', icon: 'code', key: '3' },
  { id: 'findings', label: 'Findings', icon: 'flag', key: '4' },
];

export function Header({ onHome, onHelp }: { onHome: () => void; onHelp: () => void }) {
  const run = useContext(RunContext);
  const nav = useContext(NavContext);
  const [, toggleTheme] = useTheme();
  const dark = typeof document === 'undefined' || document.documentElement.getAttribute('data-theme') !== 'light';
  const [, force] = useState(0);
  const high = run ? run.analysis.findings.filter((f) => f.severity === 'high').length : 0;

  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} title="Intent Replay home">
        <Logo />
        <span>Intent Replay</span>
      </button>
      <div className="run-title" title={run?.trace.title}>
        {run ? run.trace.title : ''}
      </div>
      {run && nav && (
        <nav className="tabs" role="tablist" aria-label="Views">
          {TAB_INFO.map((t) => (
            <button
              key={t.id}
              role="tab"
              className="tab"
              aria-selected={nav.tab === t.id}
              onClick={() => nav.setTab(t.id)}
              title={`${t.label} (${t.key})`}
            >
              <Icon name={t.icon} size={15} />
              <span className="tab-label">{t.label}</span>
              {t.id === 'findings' && run.analysis.findings.length > 0 && (
                <span className={`count ${high ? 'high' : ''}`}>{run.analysis.findings.length}</span>
              )}
              {t.id === 'changes' && run.analysis.files.length > 0 && <span className="count">{run.analysis.files.length}</span>}
            </button>
          ))}
        </nav>
      )}
      {!run && <div style={{ flex: 1 }} />}
      {run && <ExportMenu />}
      <button className="icon-btn hide-sm" onClick={onHelp} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
        <Icon name="keyboard" />
      </button>
      <button
        className="icon-btn"
        onClick={() => {
          toggleTheme();
          force((n) => n + 1);
        }}
        title="Switch theme"
        aria-label="Switch theme"
      >
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
    </header>
  );
}
