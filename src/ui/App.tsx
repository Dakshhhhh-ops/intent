import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseTrace, UnsupportedFormatError } from '../core/parse/detect';
import { parseIntentTrace } from '../core/parse/intentTrace';
import { SAMPLES } from '../samples';
import { Brief } from './Brief';
import { Changes } from './Changes';
import { Findings } from './Findings';
import { Header } from './Header';
import { Home } from './Home';
import { KeyboardHelp } from './KeyboardHelp';
import { buildRun, NavContext, RunContext, type Nav, type RunData, type RunSource, type Tab } from './model';
import { Replay } from './Replay';
import { RunHeader } from './RunHeader';

declare global {
  interface Window {
    __INTENT_BOOT__?: { api?: string; session?: string | null; cwd?: string; embedded?: boolean; live?: boolean };
  }
}

export interface CliSession {
  id: string;
  key?: string;
  agent: 'claude-code' | 'codex';
  title: string;
  cwd?: string;
  mtime: number;
  size: number;
}

const TABS: Tab[] = ['brief', 'replay', 'changes', 'findings'];

function readHash(): { tab: Tab; step: number | null; file: string | null } {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [tab, rest] = h.split(/\/(.*)/s);
  const t = (TABS.includes(tab as Tab) ? tab : 'brief') as Tab;
  if (t === 'replay' && rest && /^\d+$/.test(rest)) return { tab: t, step: Number(rest) - 1, file: null };
  if (t === 'changes' && rest) return { tab: t, step: null, file: rest };
  return { tab: t, step: null, file: null };
}

export function App() {
  const [run, setRun] = useState<RunData | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CliSession[] | null>(null);
  const [tab, setTabState] = useState<Tab>('brief');
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<string | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const toastTimer = useRef<number>(0);
  const boot = window.__INTENT_BOOT__;
  // The CLI session being shown, so it can be followed while the agent keeps working.
  const [watching, setWatching] = useState<{ key: string; size: number } | null>(null);
  const runRef = useRef<RunData | null>(null);
  const stepRef = useRef(0);
  runRef.current = run;
  stepRef.current = step;

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const open = useCallback((text: string, source: RunSource) => {
    setError(null);
    setLoading(`Reading ${source.name}…`);
    // Let the spinner paint before a large parse.
    window.setTimeout(() => {
      try {
        const trace = source.kind === 'embedded' ? parseIntentTrace(text) : parseTrace(text, source.name);
        if (source.kind === 'sample') trace.label ??= 'Sample';
        if (!trace.steps.length) throw new Error('This log has no steps I can show (it may be empty or a different kind of file).');
        const data = buildRun(trace, source);
        setRun(data);
        const h = readHash();
        const lastStep = trace.steps.length - 1;
        setTabState(h.tab);
        setStep(h.step !== null ? Math.min(Math.max(0, h.step), lastStep) : 0);
        setFile(h.file ?? data.analysis.files[0]?.path ?? null);
        if (source.kind === 'sample' && source.sampleId) {
          const u = new URL(location.href);
          u.searchParams.set('sample', source.sampleId);
          history.replaceState(null, '', u.toString());
        }
      } catch (e) {
        setError(e instanceof UnsupportedFormatError ? e.message : `Couldn't read this file: ${(e as Error).message}`);
      } finally {
        setLoading(null);
      }
    }, 30);
  }, []);

  const openFile = useCallback(
    (f: File) => {
      f.text().then((text) => open(text, { kind: 'file', name: f.name }));
    },
    [open],
  );

  const openSample = useCallback(
    (id: string) => {
      const s = SAMPLES.find((x) => x.id === id);
      if (s) open(s.text, { kind: 'sample', name: s.title, sampleId: id });
    },
    [open],
  );

  const openSession = useCallback(
    (s: CliSession) => {
      setLoading(`Loading ${s.title.slice(0, 60)}…`);
      const key = s.key ?? s.id;
      fetch(`${boot?.api ?? '/api'}/sessions/${encodeURIComponent(key)}/raw`)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((text) => {
          setWatching({ key, size: text.length });
          open(text, { kind: 'cli', name: s.title, live: !!boot?.live });
        })
        .catch((e) => {
          setLoading(null);
          setError(`Couldn't load that session: ${(e as Error).message}`);
        });
    },
    [boot?.api, open],
  );

  // Boot: embedded export → CLI → ?sample= → home.
  useEffect(() => {
    const embedded = document.getElementById('intent-trace');
    if (embedded?.textContent) {
      open(embedded.textContent, { kind: 'embedded', name: 'Exported replay' });
      return;
    }
    if (boot?.api) {
      fetch(`${boot.api}/sessions`)
        .then((r) => r.json())
        .then((list: CliSession[]) => setSessions(list))
        .catch(() => setSessions([]));
      if (boot.session) openSession({ id: boot.session, key: boot.session, agent: 'claude-code', title: 'session', mtime: 0, size: 0 });
      return;
    }
    const sample = new URL(location.href).searchParams.get('sample');
    if (sample) openSample(sample);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live: poll the session file; when it grows, re-analyze and keep the reader's place.
  useEffect(() => {
    if (!watching || !boot?.api) return;
    let busy = false;
    const id = window.setInterval(async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const st = await fetch(`${boot.api}/sessions/${encodeURIComponent(watching.key)}/stat`).then((r) => r.json());
        if (st.size !== watching.size) {
          const text = await fetch(`${boot.api}/sessions/${encodeURIComponent(watching.key)}/raw`).then((r) => r.text());
          const prev = runRef.current;
          const trace = parseTrace(text, prev?.source.name);
          const data = buildRun(trace, { ...(prev?.source ?? { kind: 'cli', name: 'session' }), live: true, updatedAt: Date.now() });
          const wasAtEnd = prev ? stepRef.current >= prev.trace.steps.length - 1 : true;
          setRun(data);
          if (wasAtEnd) setStep(trace.steps.length - 1);
          setWatching({ key: watching.key, size: st.size });
        }
      } catch {
        /* session server gone; stay on what we have */
      } finally {
        busy = false;
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [watching, boot?.api]);

  // Follow hash changes (pasted links, back/forward).
  useEffect(() => {
    const onHash = () => {
      if (!run) return;
      const h = readHash();
      setTabState(h.tab);
      if (h.step !== null) setStep(Math.min(Math.max(0, h.step), run.trace.steps.length - 1));
      if (h.file) setFile(h.file);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [run]);

  // Keep the URL hash in sync so any view can be linked.
  useEffect(() => {
    if (!run) return;
    const h = tab === 'replay' ? `#replay/${step + 1}` : tab === 'changes' && file ? `#changes/${encodeURIComponent(file)}` : `#${tab}`;
    if (location.hash !== h) history.replaceState(null, '', h);
  }, [run, tab, step, file]);

  const nav: Nav = useMemo(
    () => ({
      tab,
      step,
      file,
      line,
      setLine,
      toast,
      setTab: (t) => setTabState(t),
      go: (s, t = 'replay') => {
        if (!run) return;
        setStep(Math.min(Math.max(0, s), run.trace.steps.length - 1));
        setTabState(t);
      },
      openFile: (p, l = null) => {
        setFile(p);
        setLine(l);
        setTabState('changes');
      },
    }),
    [tab, step, file, line, run, toast],
  );

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        setHelp((h) => !h);
        return;
      }
      if (e.key === 'Escape') {
        setHelp(false);
        return;
      }
      if (!run) return;
      const last = run.trace.steps.length - 1;
      const n = Number(e.key);
      if (n >= 1 && n <= 4) {
        setTabState(TABS[n - 1]);
        return;
      }
      const jump = (list: number[], dir: 1 | -1) => {
        const next = dir === 1 ? list.find((x) => x > step) : [...list].reverse().find((x) => x < step);
        if (next !== undefined) {
          setStep(next);
          setTabState('replay');
        }
      };
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
        case 'ArrowRight':
          if (tab !== 'replay' && e.key.startsWith('Arrow')) return;
          e.preventDefault();
          setStep((s) => Math.min(last, s + 1));
          break;
        case 'k':
        case 'ArrowUp':
        case 'ArrowLeft':
          if (tab !== 'replay' && e.key.startsWith('Arrow')) return;
          e.preventDefault();
          setStep((s) => Math.max(0, s - 1));
          break;
        case 'Home':
          if (tab === 'replay') setStep(0);
          break;
        case 'End':
          if (tab === 'replay') setStep(last);
          break;
        case ']':
          jump(run.editSteps, 1);
          break;
        case '[':
          jump(run.editSteps, -1);
          break;
        case 'f':
          jump(run.findingSteps, 1);
          break;
        case 'F':
          jump(run.findingSteps, -1);
          break;
        case '/': {
          const el = document.getElementById('step-filter');
          if (el) {
            e.preventDefault();
            setTabState('replay');
            el.focus();
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, step, tab]);

  // Drop a file anywhere.
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) openFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [openFile]);

  const goHome = () => {
    setRun(null);
    setError(null);
    const u = new URL(location.href);
    u.searchParams.delete('sample');
    u.hash = '';
    history.replaceState(null, '', u.toString());
  };

  return (
    <div className="app">
      {run ? (
        <RunContext.Provider value={run}>
          <NavContext.Provider value={nav}>
            <Header onHome={goHome} onHelp={() => setHelp(true)} />
            <RunHeader />
            <main className="main" id="main">
              {tab === 'brief' && <Brief />}
              {tab === 'replay' && <Replay />}
              {tab === 'changes' && <Changes />}
              {tab === 'findings' && <Findings />}
            </main>
          </NavContext.Provider>
        </RunContext.Provider>
      ) : (
        <>
          <Header onHome={goHome} onHelp={() => setHelp(true)} />
          <main className="main" id="main">
            {loading ? (
              <div className="loading" role="status">
                <div className="spinner" />
                <div>{loading}</div>
              </div>
            ) : (
              <Home onFile={openFile} onSample={openSample} onSession={openSession} sessions={sessions} cwd={boot?.cwd} error={error} />
            )}
          </main>
        </>
      )}
      {help && <KeyboardHelp onClose={() => setHelp(false)} />}
      {dragging && <div className="drag-overlay">Drop the session log to replay it</div>}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
