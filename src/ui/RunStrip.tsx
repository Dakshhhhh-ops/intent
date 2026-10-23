import { useMemo, useState } from 'react';
import type { Severity, Step } from '../core/types';
import { useRun } from './model';

// A fingerprint of the run: one segment per step, coloured by kind, with markers where
// findings point. Click a segment to jump to that step.

export function kindColor(s: Step): string {
  if (s.command?.failed || (s.error && s.kind !== 'message')) return 'var(--fail)';
  switch (s.kind) {
    case 'prompt':
      return 'var(--prompt)';
    case 'read':
    case 'search':
    case 'web':
      return 'var(--read)';
    case 'edit':
      return 'var(--edit)';
    case 'create':
      return 'var(--create)';
    case 'delete':
      return 'var(--fail)';
    case 'command':
      return 'var(--verify)';
    default:
      return 'var(--strip-idle)';
  }
}

const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };

export function RunStrip({ current, onJump, height = 8, markers = true }: { current?: number; onJump: (id: number) => void; height?: number; markers?: boolean }) {
  const run = useRun();
  const steps = run.trace.steps;
  const n = steps.length;
  const [hover, setHover] = useState<number | null>(null);

  // Long runs: bucket steps so the strip stays readable (the most notable step wins a bucket).
  const buckets = useMemo(() => {
    const max = 400;
    const size = Math.max(1, Math.ceil(n / max));
    const out: { from: number; to: number; color: string; title: string }[] = [];
    for (let i = 0; i < n; i += size) {
      const chunk = steps.slice(i, i + size);
      const pick =
        chunk.find((s) => s.command?.failed) ?? chunk.find((s) => s.edit) ?? chunk.find((s) => s.command) ?? chunk.find((s) => s.kind === 'prompt') ?? chunk[0];
      out.push({ from: i, to: Math.min(n - 1, i + size - 1), color: kindColor(pick), title: pick.title });
    }
    return out;
  }, [steps, n]);

  const marks = useMemo(() => {
    const out: { id: number; sev: Severity }[] = [];
    for (const [id, fs] of run.findingsByStep) {
      const sev = fs.reduce<Severity>((m, f) => (SEV_RANK[f.severity] > SEV_RANK[m] ? f.severity : m), 'info');
      if (sev === 'high' || sev === 'medium') out.push({ id, sev });
    }
    return out;
  }, [run.findingsByStep]);

  return (
    <div className="runstrip" style={{ '--strip-h': `${height}px` } as React.CSSProperties} onPointerLeave={() => setHover(null)}>
      {markers && (
        <div className="runstrip-marks" aria-hidden="true">
          {marks.map((m) => (
            <span key={m.id} className={`rs-mark ${m.sev}`} style={{ left: `${((m.id + 0.5) / n) * 100}%` }} />
          ))}
        </div>
      )}
      <div className="runstrip-bar" role="group" aria-label="Every step of the run">
        {buckets.map((b, i) => (
          <button
            key={i}
            className={`rs-seg ${current !== undefined && current >= b.from && current <= b.to ? 'on' : ''}`}
            style={{ background: b.color }}
            onClick={() => onJump(b.from)}
            onPointerEnter={() => setHover(i)}
            aria-label={`Step ${b.from + 1}: ${b.title}`}
          />
        ))}
      </div>
      {hover !== null && buckets[hover] && (
        <div className="runstrip-tip" style={{ left: `${((buckets[hover].from + 0.5) / n) * 100}%` }}>
          <b>#{buckets[hover].from + 1}</b> {buckets[hover].title}
        </div>
      )}
    </div>
  );
}
