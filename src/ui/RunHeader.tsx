import { useEffect, useRef } from 'react';
import { formatDuration } from '../core/report/markdown';
import { Icon } from './Icon';
import { agentName, fmtTokens, useRun } from './model';

export function RunHeader() {
  const { trace, analysis, source } = useRun();
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
  return (
    <div className="runhead" ref={ref}>
      {source.live && (
        <span className="live-pill" title={source.updatedAt ? `Updated ${new Date(source.updatedAt).toLocaleTimeString()}` : 'Waiting for the agent'}>
          <span className="dot" /> Live
        </span>
      )}
      <span className={`verdict-pill ${analysis.verdict.level}`} title={analysis.verdict.summary}>
        <span className="dot" />
        {analysis.verdict.label}
      </span>
      <span className="meta">
        <Icon name="subagent" size={14} />
        {agentName(trace)}
        {trace.model ? <span style={{ color: 'var(--text-3)' }}>· {trace.model}</span> : null}
      </span>
      <span className="meta num">
        <Icon name="clock" size={14} />
        {formatDuration(st.durationMs)}
      </span>
      <span className="meta num">
        <Icon name="layers" size={14} />
        {st.steps} steps
      </span>
      <span className="meta num">
        <Icon name="file" size={14} />
        {st.filesChanged} changed <span className="plus">+{st.linesAdded}</span> <span className="minus">−{st.linesRemoved}</span>
      </span>
      <span className="meta num">
        <Icon name="command" size={14} />
        {st.commands} commands{st.commandsFailed ? <span className="minus"> · {st.commandsFailed} failed</span> : null}
      </span>
      {st.tokensOut > 0 && (
        <span className="meta num" title={`${st.tokensIn.toLocaleString()} input · ${st.tokensCached.toLocaleString()} cached · ${st.tokensOut.toLocaleString()} output`}>
          <Icon name="sparkle" size={14} />
          {fmtTokens(st.tokensIn + st.tokensCached)} in · {fmtTokens(st.tokensOut)} out
        </span>
      )}
      {trace.gitBranch && (
        <span className="meta">
          <Icon name="branch" size={14} />
          {trace.gitBranch}
        </span>
      )}
      {label && (
        <span className="chip accent label-chip" title={trace.description}>
          {label}
        </span>
      )}
    </div>
  );
}
