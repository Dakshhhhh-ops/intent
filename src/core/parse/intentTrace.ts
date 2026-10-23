import type { Step, StepKind, Trace } from '../types';
import { classifyCommand } from '../analyze/commands';
import { redact } from '../redact';
import { countLines, hash, oneLine, parseTime, truncate } from '../util';

// Intent Trace: a small open JSON format any agent can emit (see docs/TRACE_FORMAT.md).
// It is also what `Export → JSON` writes, so exported runs can be re-opened.

type Json = Record<string, any>;

const KINDS: StepKind[] = ['prompt', 'message', 'thinking', 'plan', 'read', 'search', 'edit', 'create', 'delete', 'command', 'web', 'subagent', 'tool'];

export function looksLikeIntentTrace(o: unknown): boolean {
  return !!o && typeof o === 'object' && ((o as Json).format === 'intent-trace' || (Array.isArray((o as Json).steps) && 'source' in (o as Json)));
}

export function parseIntentTrace(text: string): Trace {
  const o: Json = JSON.parse(text);
  if (!Array.isArray(o.steps)) throw new Error('Intent Trace JSON needs a "steps" array.');
  let turn = 0;
  const steps: Step[] = o.steps.map((raw: Json, i: number): Step => {
    const kind: StepKind = KINDS.includes(raw.kind) ? raw.kind : 'tool';
    if (kind === 'prompt') turn++;
    const s: Step = {
      id: i,
      t: parseTime(raw.t ?? raw.timestamp),
      kind,
      actor: raw.actor === 'user' || raw.actor === 'subagent' ? raw.actor : kind === 'prompt' ? 'user' : 'agent',
      title: String(raw.title ?? defaultTitle(raw, kind)),
      intent: raw.intent ? redact(String(raw.intent)) : undefined,
      text: raw.text ? redact(String(raw.text)) : undefined,
      tool: raw.tool,
      files: Array.isArray(raw.files) ? raw.files.map(String) : [],
      turn: typeof raw.turn === 'number' ? raw.turn : turn,
      error: !!raw.error,
      detail: raw.detail ? redact(String(raw.detail)) : undefined,
      output: raw.output ? redact(String(raw.output)) : undefined,
    };
    if (raw.read) s.read = { ...raw.read, content: raw.read.content ? redact(raw.read.content) : undefined };
    if (raw.search) s.search = raw.search;
    if (raw.plan) s.plan = raw.plan;
    if (raw.web) s.web = raw.web;
    if (raw.usage) s.usage = raw.usage;
    if (raw.edit) {
      const e = raw.edit;
      s.edit = {
        path: String(e.path),
        op: e.op === 'create' || e.op === 'delete' ? e.op : 'update',
        before: e.before != null ? redact(String(e.before)) : undefined,
        after: e.after != null ? redact(String(e.after)) : undefined,
        edits: Array.isArray(e.edits) ? e.edits.map((x: Json) => ({ oldString: redact(String(x.oldString ?? '')), newString: redact(String(x.newString ?? '')), replaceAll: !!x.replaceAll })) : undefined,
        patch: e.patch != null ? redact(String(e.patch)) : undefined,
        added: Number(e.added ?? countLines(e.after)),
        removed: Number(e.removed ?? 0),
        opaque: !!e.opaque,
      };
      if (!s.files.length) s.files = [s.edit.path];
    }
    if (raw.command) {
      const c = raw.command;
      const cmd = redact(String(c.cmd ?? ''));
      const exitCode = typeof c.exitCode === 'number' ? c.exitCode : null;
      s.command = {
        cmd,
        exitCode,
        failed: typeof c.failed === 'boolean' ? c.failed : exitCode !== null && exitCode !== 0,
        output: redact(String(c.output ?? '')),
        categories: Array.isArray(c.categories) && c.categories.length ? c.categories : classifyCommand(cmd),
        durationMs: c.durationMs,
        description: c.description,
      };
      s.error ||= s.command.failed;
    }
    return s;
  });
  const first = steps.find((s) => s.t !== null)?.t ?? undefined;
  const last = [...steps].reverse().find((s) => s.t !== null)?.t ?? undefined;
  const prompt = steps.find((s) => s.kind === 'prompt');
  return {
    id: String(o.id ?? hash(text.slice(0, 4000))),
    source: 'intent-trace',
    title: String(o.title ?? (prompt ? truncate(oneLine(prompt.text ?? prompt.title), 90) : 'Agent run')),
    cwd: o.cwd,
    model: o.model,
    agentVersion: o.agentVersion ?? o.agent,
    gitBranch: o.gitBranch,
    startedAt: parseTime(o.startedAt) ?? first,
    endedAt: parseTime(o.endedAt) ?? last,
    steps,
    warnings: Array.isArray(o.warnings) ? o.warnings : [],
    skippedRecords: Number(o.skippedRecords ?? 0),
    label: o.label,
    description: o.description,
  };
}

function defaultTitle(raw: Json, kind: StepKind): string {
  if (raw.command?.cmd) return truncate(oneLine(String(raw.command.cmd)), 120);
  if (raw.edit?.path) return `${kind === 'create' ? 'Create' : kind === 'delete' ? 'Delete' : 'Edit'} ${raw.edit.path}`;
  if (raw.read?.path) return `Read ${raw.read.path}`;
  if (raw.text) return truncate(oneLine(String(raw.text)), 120);
  return kind;
}

/** Serialize a trace to Intent Trace JSON (used by Export → JSON and the CLI). */
export function toIntentTrace(trace: Trace): string {
  return JSON.stringify({ format: 'intent-trace', version: 1, ...trace }, null, 0);
}
