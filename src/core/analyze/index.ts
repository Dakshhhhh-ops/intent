import type { Analysis, ReviewItem, Severity, Stats, Trace } from '../types';
import { checkClaims } from './claims';
import { trackFiles } from './files';
import { buildPhases, labelSteps } from './phases';
import { RULE_INFO, runRules } from './rules';

export { RULE_INFO } from './rules';
export { trackFiles } from './files';

export interface AnalysisWithContext extends Analysis {
  touched: { path: string; reads: number[]; edits: number[] }[];
  readBefore: (stepId: number) => Set<string>;
}

export function analyze(trace: Trace): AnalysisWithContext {
  const { steps } = trace;
  const tracking = trackFiles(steps);
  const files = tracking.changed;
  const stepPhase = labelSteps(steps);
  const phases = buildPhases(steps, stepPhase);
  const claims = checkClaims(steps, files);
  const findings = runRules({ steps, files, claims, readBefore: tracking.readBefore });

  // Caveat "tests pass" when the agent changed tests before that claim.
  for (const c of claims) {
    if (c.kind !== 'tests-pass' || c.verdict !== 'supported') continue;
    const weakened = findings.find((f) => f.rule === 'weakened-tests' && f.steps.some((s) => s < c.step));
    if (weakened) c.caveat = `True, but only after the agent weakened tests (${weakened.files.join(', ')}).`;
  }

  // Flags on files come from findings that point at them.
  for (const f of findings) {
    for (const p of f.files) {
      const file = files.find((x) => x.path === p);
      const name = RULE_INFO[f.rule].name;
      if (file && !file.flags.includes(name)) file.flags.push(name);
    }
  }

  const stats = computeStats(trace, files.length, tracking.touched.filter((t) => t.reads.length).length);
  const review = buildReview(findings, files);
  const high = findings.filter((f) => f.severity === 'high').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  const contradicted = claims.filter((c) => c.verdict === 'contradicted').length;
  const verdict =
    high > 0
      ? { level: 'risky' as const, label: 'Needs review', summary: summaryLine(high, medium, contradicted) }
      : medium > 0
        ? { level: 'review' as const, label: 'Worth a look', summary: summaryLine(high, medium, contradicted) }
        : { level: 'clean' as const, label: 'Looks clean', summary: files.length ? 'No red flags in how this change was made.' : 'No files were changed.' };

  return { stats, files, phases, findings, claims, review, verdict, stepPhase, touched: tracking.touched, readBefore: tracking.readBefore };
}

function summaryLine(high: number, medium: number, contradicted: number): string {
  const parts: string[] = [];
  if (high) parts.push(`${high} high`);
  if (medium) parts.push(`${medium} medium`);
  let s = `${parts.join(', ')} severity finding${high + medium === 1 ? '' : 's'}`;
  if (contradicted) s += ` · ${contradicted} claim${contradicted === 1 ? '' : 's'} contradicted`;
  return s;
}

function computeStats(trace: Trace, filesChanged: number, filesRead: number): Stats {
  const s = trace.steps;
  const cmds = s.filter((x) => x.command);
  let tokensIn = 0;
  let tokensOut = 0;
  let tokensCached = 0;
  for (const x of s) {
    if (!x.usage) continue;
    tokensIn += x.usage.input;
    tokensOut += x.usage.output;
    tokensCached += x.usage.cached;
  }
  // A loop, not Math.min(...times): spreading a very long run overflows the call stack.
  let first: number | null = null;
  let lastT: number | null = null;
  for (const x of s) {
    if (x.t === null) continue;
    if (first === null || x.t < first) first = x.t;
    if (lastT === null || x.t > lastT) lastT = x.t;
  }
  const start = trace.startedAt ?? first;
  const end = trace.endedAt ?? lastT;
  let added = 0;
  let removed = 0;
  for (const x of s) {
    if (!x.edit) continue;
    added += x.edit.added;
    removed += x.edit.removed;
  }
  return {
    durationMs: start !== null && end !== null ? end - start : null,
    steps: s.length,
    toolCalls: s.filter((x) => !['prompt', 'message', 'thinking'].includes(x.kind)).length,
    filesRead,
    filesChanged,
    linesAdded: added,
    linesRemoved: removed,
    commands: cmds.length,
    commandsFailed: cmds.filter((x) => x.command!.failed).length,
    tokensIn,
    tokensOut,
    tokensCached,
    prompts: s.filter((x) => x.kind === 'prompt').length,
  };
}

function buildReview(findings: Analysis['findings'], files: Analysis['files']): ReviewItem[] {
  const items: ReviewItem[] = [];
  // Claims have their own panel; review-first lists everything else.
  for (const f of findings.filter((x) => (x.severity === 'high' || x.severity === 'medium') && x.rule !== 'contradicted-claim').slice(0, 6)) {
    items.push({ title: f.title, why: f.detail, step: f.steps[f.steps.length - 1] ?? null, file: f.files[0], severity: f.severity });
  }
  const seen = new Set(items.map((i) => i.file).filter(Boolean));
  const ranked = [...files]
    .filter((f) => !seen.has(f.path))
    .sort((a, b) => b.flags.length - a.flags.length || b.added + b.removed - (a.added + a.removed));
  for (const f of ranked.slice(0, Math.max(0, 7 - items.length))) {
    const sev: Severity = f.flags.length ? 'medium' : 'info';
    items.push({
      title: `${f.created ? 'New file' : f.deleted ? 'Deleted' : 'Changed'} ${f.path}`,
      why: `+${f.added} −${f.removed} across ${f.edits.length} edit${f.edits.length === 1 ? '' : 's'}${f.flags.length ? ` · ${f.flags.join(', ')}` : ''}`,
      step: f.edits[0] ?? null,
      file: f.path,
      severity: sev,
    });
  }
  return items;
}
