import { createContext, useContext } from 'react';
import { analyze, type AnalysisWithContext } from '../core/analyze';
import type { Claim, FileChange, Finding, PhaseKind, Step, Trace } from '../core/types';

export type Tab = 'brief' | 'replay' | 'changes' | 'findings';

export interface RunSource {
  kind: 'sample' | 'file' | 'cli' | 'embedded';
  name: string;
  sampleId?: string;
}

export interface RunData {
  trace: Trace;
  analysis: AnalysisWithContext;
  source: RunSource;
  findingsByStep: Map<number, Finding[]>;
  claimsByStep: Map<number, Claim[]>;
  fileByPath: Map<string, FileChange>;
  editSteps: number[];
  findingSteps: number[];
  /** Latest user prompt id at or before each step. */
  promptAt: number[];
  /** Latest failed command id strictly before each step (or -1). */
  lastFailBefore: number[];
  /** Latest plan step id at or before each step (or -1). */
  planAt: number[];
  t0: number | null;
}

export function buildRun(trace: Trace, source: RunSource): RunData {
  const analysis = analyze(trace);
  const findingsByStep = new Map<number, Finding[]>();
  for (const f of analysis.findings) {
    for (const s of f.steps) {
      const list = findingsByStep.get(s) ?? [];
      if (!list.includes(f)) list.push(f);
      findingsByStep.set(s, list);
    }
  }
  const claimsByStep = new Map<number, Claim[]>();
  for (const c of analysis.claims) {
    for (const s of [c.step, ...c.evidence]) {
      const list = claimsByStep.get(s) ?? [];
      if (!list.includes(c)) list.push(c);
      claimsByStep.set(s, list);
    }
  }
  const fileByPath = new Map(analysis.files.map((f) => [f.path, f]));
  const promptAt: number[] = [];
  const lastFailBefore: number[] = [];
  const planAt: number[] = [];
  let p = -1;
  let fail = -1;
  let plan = -1;
  for (const s of trace.steps) {
    if (s.kind === 'prompt') p = s.id;
    if (s.kind === 'plan') plan = s.id;
    promptAt.push(p);
    planAt.push(plan);
    lastFailBefore.push(fail);
    if (s.command?.failed) fail = s.id;
  }
  const times = trace.steps.map((s) => s.t).filter((t): t is number => t !== null);
  return {
    trace,
    analysis,
    source,
    findingsByStep,
    claimsByStep,
    fileByPath,
    editSteps: trace.steps.filter((s) => s.edit).map((s) => s.id),
    findingSteps: [...findingsByStep.keys()].sort((a, b) => a - b),
    promptAt,
    lastFailBefore,
    planAt,
    t0: trace.startedAt ?? (times.length ? Math.min(...times) : null),
  };
}

export interface Nav {
  tab: Tab;
  step: number;
  file: string | null;
  setTab: (t: Tab) => void;
  go: (step: number, tab?: Tab) => void;
  openFile: (path: string, line?: number | null) => void;
  line: number | null;
  setLine: (n: number | null) => void;
  toast: (msg: string) => void;
}

export const RunContext = createContext<RunData | null>(null);
export const NavContext = createContext<Nav | null>(null);

export function useRun(): RunData {
  const r = useContext(RunContext);
  if (!r) throw new Error('useRun outside a run');
  return r;
}

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav outside a run');
  return n;
}

export const PHASE_LABEL: Record<PhaseKind, string> = {
  ask: 'Ask',
  explore: 'Explore',
  change: 'Change',
  verify: 'Verify',
  repair: 'Repair',
  report: 'Report',
};

export function kindClass(s: Step): string {
  if (s.command?.failed && s.kind === 'command') return 'k-fail';
  return `k-${s.kind}`;
}

export function fmtOffset(ms: number | null): string {
  if (ms === null || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `+${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `+${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function fmtClock(t: number | null): string {
  if (t === null) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}

export function agentName(trace: Trace): string {
  if (trace.source === 'claude-code') return 'Claude Code';
  if (trace.source === 'codex') return 'Codex CLI';
  return trace.agentVersion?.split(' ')[0] ?? 'Agent';
}
