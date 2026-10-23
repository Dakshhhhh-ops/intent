import { useEffect, useMemo, useRef } from 'react';
import { outputLooksFailed, partialTestFilter } from '../../core/analyze/commands';
import { formatDuration } from '../../core/report/markdown';
import type { Analysis, Step, Trace } from '../../core/types';
import type { CrtLine } from './crt';

// "The black box": the sample run typed onto a phosphor CRT, one line per step with a status
// tag, ending on the claim the agent made and what the log says about it.

const KIND: Record<string, string> = {
  prompt: 'TASK',
  message: 'SAID',
  thinking: 'THINK',
  read: 'READ',
  search: 'SEARCH',
  edit: 'EDIT',
  create: 'CREATE',
  delete: 'DELETE',
  command: 'RUN',
  plan: 'PLAN',
  web: 'WEB',
  tool: 'TOOL',
  subagent: 'AGENT',
};

function fit(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').replace(/`/g, '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function linesFor(trace: Trace, a: Analysis): CrtLine[] {
  const flagged = new Map<number, string[]>();
  for (const f of a.findings) for (const s of f.steps) flagged.set(s, [...(flagged.get(s) ?? []), f.rule]);
  const out: CrtLine[] = [
    { text: 'INTENT REPLAY  v0.1   FLIGHT DATA RECORDER', tone: 'head' },
    { text: `session ${trace.id.slice(0, 8)} · ${trace.source} · ${trace.steps.length} steps · ${formatDuration(a.stats.durationMs)}`, tone: 'dim' },
    { text: '', tone: 'dim' },
  ];
  const statusOf = (s: Step): { status: string; tone: CrtLine['tone'] } => {
    const rules = flagged.get(s.id) ?? [];
    if (s.kind === 'prompt') return { status: 'RECEIVED', tone: 'ok' };
    if (s.edit) {
      if (rules.includes('weakened-tests')) return { status: 'WEAKENED', tone: 'bad' };
      if (rules.includes('blind-edit')) return { status: 'NO READ', tone: 'warn' };
      return { status: 'WRITE', tone: 'ok' };
    }
    if (s.command) {
      const c = s.command;
      if (c.failed) return { status: `EXIT ${c.exitCode ?? 1}`, tone: 'bad' };
      if (outputLooksFailed(c.output)) return { status: 'MASKED', tone: 'warn' };
      if (c.categories.includes('test') && partialTestFilter(c.cmd)) return { status: 'FILTERED', tone: 'warn' };
      return { status: 'EXIT 0', tone: 'ok' };
    }
    if (s.kind === 'message') return { status: 'SAID', tone: 'dim' };
    return { status: 'OK', tone: 'ok' };
  };
  for (const s of trace.steps.slice(0, 40)) {
    const { status, tone } = statusOf(s);
    const label = `${String(s.id + 1).padStart(2, '0')}  ${(KIND[s.kind] ?? 'STEP').padEnd(6)}  ${fit(s.command ? s.command.cmd : s.title, 44)}`;
    out.push({ text: label, status, tone: s.kind === 'message' ? 'dim' : tone });
  }
  const bad = a.claims.filter((c) => c.verdict === 'contradicted');
  if (bad.length) out.push({ text: '', tone: 'dim' });
  for (const c of bad.slice(0, 2)) out.push({ text: `CLAIM  “${fit(c.text, 42)}”`, status: 'CONTRADICTED', tone: 'claim' });
  out.push({ text: '', tone: 'dim' });
  out.push({ text: `VERDICT  ${a.verdict.label.toLowerCase()} · ${a.verdict.summary.replace(/ severity findings?/, '')}`, tone: a.verdict.level === 'clean' ? 'ok' : 'warn' });
  return out;
}

export function CrtSection({ trace, analysis, onOpen }: { trace: Trace; analysis: Analysis; onOpen?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => linesFor(trace, analysis), [trace, analysis]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(
      async ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const { startCrt } = await import('./crt');
        if (cancelled || !host.current) return;
        dispose = startCrt(host.current, lines)?.dispose;
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      dispose?.();
    };
  }, [lines]);

  return (
    <section className="crt-section" aria-label="The raw run, replayed on a terminal">
      <div className="crt-head">
        <p className="eyebrow-mono">The black box</p>
        <h2 className="h-h2" data-reveal>
          Every step, <em>on the record.</em>
        </h2>
        <p className="h-sub">This is the sample run straight from its log: what the agent read, wrote and ran, the exit codes it got, and the claim it made at the end.</p>
      </div>
      <div className="crt-monitor" data-rise>
        <div className="crt-bezel">
          <div className="crt-screen" ref={host} role="img" aria-label={lines.map((l) => `${l.text} ${l.status ?? ''}`).join('. ')} />
        </div>
        <div className="crt-chin">
          <span className="crt-brand">INTENT · IR-1</span>
          <span className="crt-led" />
          {onOpen && (
            <button className="crt-open" onClick={onOpen}>
              Open this run →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
