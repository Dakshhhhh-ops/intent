import { useEffect, useMemo, useRef } from 'react';
import { classifyCommand, outputLooksFailed, partialTestFilter, shellCode } from '../../core/analyze/commands';
import { formatDuration } from '../../core/report/markdown';
import type { Analysis, Step, Trace } from '../../core/types';
import type { CrtLine } from './crt';

// "The black box": a real run typed onto a phosphor CRT, one line per step with a status tag,
// ending on the claim the agent made and what the log says about it. Long runs show the task,
// then the stretch that leads to the contradicted claim, so the screen tells the story in ~20 lines.

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

/** Step lines shown on screen; the rest are folded into one "… N steps …" line. */
const MAX_STEPS = 15;

function fit(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').replace(/`/g, '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** A long claim cut around what it claims ("…all 6 tests pass…"), not just its opening words. */
function claimPart(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').replace(/`/g, '').trim();
  if (t.length <= n) return t;
  const m = t.match(/\b(?:all\s+)?(?:\d+\s+)?(?:\w+\s+)?(?:tests?|build|checks?|lint|types?)\b.{0,12}?\b(?:pass\w*|succeed\w*|green|clean)\b|\bfixed\b|\bonly changed\b/i);
  if (!m || m.index === undefined || m.index + m[0].length <= n - 1) return fit(t, n);
  const start = Math.max(0, Math.min(m.index, t.length - (n - 2)));
  const body = t.slice(start, start + n - 2);
  return `…${body}${start + n - 2 < t.length ? '…' : ''}`;
}

/** The part of a long shell script worth a terminal line: the test run (with its pipe) or the first real command. */
function shortCmd(cmd: string): string {
  const parts = shellCode(cmd)
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const test = [...parts].reverse().find((p) => classifyCommand(p).includes('test'));
  return test ?? parts.find((p) => !/^(?:[A-Za-z_]\w*=|cd\s|cp\s|mkdir\s|export\s|cat\s*>)/.test(p)) ?? parts[0] ?? cmd;
}

/** The steps worth showing: the task, then the run-up to the worst claim (its evidence included). */
export function pickSteps(trace: Trace, a: Analysis): (Step | { gap: number })[] {
  const steps = trace.steps.filter((s) => s.kind !== 'thinking');
  if (steps.length <= MAX_STEPS) return steps;
  const claim = a.claims.find((c) => c.verdict === 'contradicted');
  const found = claim ? steps.findIndex((s) => s.id >= claim.step) : -1;
  const last = found < 0 ? steps.length - 1 : found;
  const proof = claim?.evidence.length ? steps.findIndex((s) => s.id >= Math.min(...claim.evidence)) : -1;
  // The task, a few steps around the proof, then fill backwards from the claim.
  const keep = new Set<number>([0]);
  if (proof > 0) for (let i = proof - 3; i <= Math.min(proof + 1, last); i++) if (i > 0) keep.add(i);
  for (let i = last; i > 0 && keep.size < MAX_STEPS; i--) keep.add(i);
  const out: (Step | { gap: number })[] = [];
  let prev = -1;
  for (const i of [...keep].sort((x, y) => x - y)) {
    if (i - prev > 1) out.push({ gap: i - prev - 1 });
    out.push(steps[i]);
    prev = i;
  }
  return out;
}

function linesFor(trace: Trace, a: Analysis): CrtLine[] {
  const flagged = new Map<number, string[]>();
  for (const f of a.findings) for (const s of f.steps) flagged.set(s, [...(flagged.get(s) ?? []), f.rule]);
  const out: CrtLine[] = [
    { text: 'INTENT REPLAY  v0.1   FLIGHT DATA RECORDER', tone: 'head' },
    { text: `session ${fit(trace.id, 20)} · ${trace.source} · ${trace.steps.length} steps · ${formatDuration(a.stats.durationMs)}`, tone: 'dim' },
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
  const width = String(trace.steps.length).length;
  const picked = pickSteps(trace, a);
  for (let i = 0; i < picked.length; i++) {
    const s = picked[i];
    if ('gap' in s) {
      out.push({ text: `${' '.repeat(width)}  ……  ${s.gap} more step${s.gap === 1 ? '' : 's'}`, tone: 'dim' });
      continue;
    }
    const { status, tone } = statusOf(s);
    // Back-to-back edits of one file read as one line: "Edit src/a.ts ×4".
    let times = 1;
    while (s.edit) {
      const n = picked[i + 1];
      if (!n || 'gap' in n || n.edit?.path !== s.edit.path || statusOf(n).status !== status) break;
      times++;
      i++;
    }
    // The task line uses the run's title: a first prompt is often a follow-up ("till then…"), the title says what the run was.
    const what = s.kind === 'prompt' && s === trace.steps.find((x) => x.kind === 'prompt') ? trace.title || s.title : s.command ? shortCmd(s.command.cmd) : s.text ?? s.title;
    const label = `${String(s.id + 1).padStart(width, '0')}  ${(KIND[s.kind] ?? 'STEP').padEnd(6)}  ${times > 1 ? `${fit(what, 37)} ×${times}` : fit(what, 42)}`;
    out.push({ text: label, status, tone: s.kind === 'message' ? 'dim' : tone });
  }
  const bad = a.claims.filter((c) => c.verdict === 'contradicted');
  if (bad.length) out.push({ text: '', tone: 'dim' });
  for (const c of bad.slice(0, 1)) out.push({ text: `CLAIM  “${claimPart(c.text, 40)}”`, status: 'CONTRADICTED', tone: 'claim' });
  out.push({ text: '', tone: 'dim' });
  out.push({ text: `VERDICT  ${a.verdict.label.toLowerCase()} · ${a.verdict.summary.replace(/ severity findings?/, '')}`, tone: a.verdict.level === 'clean' ? 'ok' : 'warn' });
  return out;
}

export function CrtSection({ trace, analysis, source, onOpen }: { trace: Trace; analysis: Analysis; source?: string; onOpen?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => linesFor(trace, analysis), [trace, analysis]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const el = host.current;
    if (!el) return;
    // The WebGL screen loads only when the section comes near, so it never slows the first paint.
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
    <section className="crt-section" aria-label="The run, replayed on a terminal">
      <div className="crt-head">
        <p className="eyebrow-mono">The black box</p>
        <h2 className="h-h2" data-reveal>
          Every step, <em>on the record.</em>
        </h2>
        <p className="h-sub">
          {source ? `A ${source.charAt(0).toLowerCase() + source.slice(1)}, straight from its log` : 'A run straight from its log'}: the task, what the agent read, wrote and ran, the exit codes it got, and the claim it made at the end.
        </p>
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
