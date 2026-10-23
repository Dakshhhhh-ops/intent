import { useEffect, useRef } from 'react';
import { formatDuration } from '../core/report/markdown';
import { agentName, fmtTokens, useNav, useRun } from './model';
import { RunStrip } from './RunStrip';

// The instrument strip under the top bar: verdict, flight-recorder style readouts, and the run strip.

export function RunHeader() {
  const { trace, analysis, source } = useRun();
  const nav = useNav();
  const st = analysis.stats;
  const ref = useRef<HTMLDivElement>(null);

  // Full-height views size themselves below this bar.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--runhead-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const label = trace.label ?? (source.kind === 'cli' ? 'Local session' : source.kind === 'file' ? 'Opened file' : undefined);
  const readouts: { k: string; v: React.ReactNode; bad?: boolean }[] = [
    { k: 'Duration', v: formatDuration(st.durationMs) },
    { k: 'Steps', v: st.steps },
    {
      k: 'Files changed',
      v: (
        <>
          {st.filesChanged} <span className="plus">+{st.linesAdded}</span> <span className="minus">−{st.linesRemoved}</span>
        </>
      ),
    },
    {
      k: 'Commands',
      v: (
        <>
          {st.commands}
          {st.commandsFailed ? <span className="minus"> · {st.commandsFailed} failed</span> : null}
        </>
      ),
    },
  ];
  if (st.tokensOut > 0) readouts.push({ k: 'Tokens in / out', v: `${fmtTokens(st.tokensIn + st.tokensCached)} / ${fmtTokens(st.tokensOut)}` });
  readouts.push({
    k: 'Agent',
    v: (
      <>
        {agentName(trace)}
        {trace.model ? <span className="ro-dim"> · {trace.model}</span> : null}
      </>
    ),
  });
  if (trace.gitBranch) readouts.push({ k: 'Branch', v: trace.gitBranch });

  return (
    <div className="runhead2" ref={ref}>
      <div className="rh-row">
        {source.live && (
          <span className="live-pill" title={source.updatedAt ? `Updated ${new Date(source.updatedAt).toLocaleTimeString()}` : 'Waiting for the agent'}>
            <span className="dot" /> Live
          </span>
        )}
        <button className={`rh-verdict ${analysis.verdict.level}`} onClick={() => nav.setTab('findings')} title={analysis.verdict.summary}>
          <span className="dot" />
          <span className="rh-verdict-l">{analysis.verdict.label}</span>
          <span className="rh-verdict-s">{analysis.verdict.summary}</span>
        </button>
        <div className="rh-readouts">
          {readouts.map((r) => (
            <div key={r.k} className="ro">
              <span className="ro-k">{r.k}</span>
              <span className="ro-v">{r.v}</span>
            </div>
          ))}
        </div>
        {label && (
          <span className="rh-label" title={trace.description}>
            {label}
          </span>
        )}
      </div>
      <RunStrip current={nav.tab === 'replay' ? nav.step : undefined} onJump={(id) => nav.go(id)} height={6} />
    </div>
  );
}
