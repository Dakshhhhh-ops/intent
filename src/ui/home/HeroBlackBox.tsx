import { useEffect, useRef } from 'react';
import type { Analysis, Step, Trace } from '../../core/types';
import { kindColor } from '../RunStrip';
import { Rich } from '../Rich';

// Hero visual: the 3D flight recorder plus floating evidence chips taken from the sample run.

const CSS_VARS: Record<string, string> = {
  'var(--fail)': '#ec5d5e',
  'var(--prompt)': '#e796f3',
  'var(--read)': '#70b8ff',
  'var(--edit)': '#ffc53d',
  'var(--create)': '#1fd8a4',
  'var(--verify)': '#0bd8b6',
  'var(--strip-idle)': '#3a3d44',
};

export function HeroBlackBox({ trace, analysis, onOpen }: { trace: Trace; analysis: Analysis; onOpen: () => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const tape = trace.steps.map((s: Step) => ({ color: CSS_VARS[kindColor(s)] ?? '#3a3d44', bad: !!s.command?.failed }));
    import('../fx3d/blackBox').then(({ startBlackBox }) => {
      if (cancelled || !host.current) return;
      const r = startBlackBox(host.current, tape);
      if (!r) host.current.classList.add('no-webgl');
      dispose = r?.dispose;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [trace]);

  const failed = trace.steps.find((s) => s.command?.failed);
  const blind = analysis.findings.find((f) => f.rule === 'blind-edit');
  const claim = analysis.claims.find((c) => c.kind === 'tests-pass' && c.verdict === 'contradicted') ?? analysis.claims.find((c) => c.verdict === 'contradicted');

  return (
    <div className="hbb" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()} aria-label="Open the sample run">
      <div className="hbb-canvas" ref={host} aria-hidden="true" />
      {failed && (
        <div className="hbb-chip c1">
          <span className="hbb-k">STEP {String(failed.id + 1).padStart(2, '0')} · RUN</span>
          <code>{failed.command!.cmd}</code>
          <span className="hbb-bad">exit {failed.command!.exitCode}</span>
        </div>
      )}
      {blind && (
        <div className="hbb-chip c2">
          <span className="hbb-k">BLIND EDIT</span>
          <span>
            <Rich text={blind.title} />
          </span>
        </div>
      )}
      {claim && (
        <div className="hbb-chip c3">
          <span className="hbb-k">THE AGENT SAID</span>
          <q>{claim.text.replace(/`/g, '')}</q>
          <span className="hbb-stamp">Contradicted</span>
        </div>
      )}
      <div className="hbb-cap">
        <span className="cap-dot" /> {trace.steps.length} steps on tape · click to open the replay
      </div>
    </div>
  );
}
