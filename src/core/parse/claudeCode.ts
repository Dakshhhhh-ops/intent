import type { EditInfo, PlanItem, Step, StepKind, Trace, Usage } from '../types';
import { classifyCommand, shellReadTargets, shellWriteTargets } from '../analyze/commands';
import { redact } from '../redact';
import { basename, countLines, countPatch, hash, oneLine, parseTime, relPath, stripAnsi, truncate } from '../util';

// Claude Code writes one JSON object per line to ~/.claude/projects/<project>/<session>.jsonl.
// Assistant messages are split into one line per content block (text, thinking, tool_use);
// tool results come back as `user` lines carrying a `toolUseResult` with structured data
// (old/new strings for edits, full file content for reads, stdout/stderr for shell).

type Json = Record<string, any>;

const BOOKKEEPING = new Set([
  'queue-operation',
  'attachment',
  'file-history-snapshot',
  'file-history-delta',
  'atis-latch',
  'last-prompt',
  'api-request-shape',
  'api-request-blob',
  'api-request',
  'mode',
  'system',
  'summary',
  'ai-title',
  'custom-title',
]);

const MAX_OUTPUT = 20_000;
const MAX_CONTENT = 400_000;

interface Pending {
  step: Step;
  name: string;
  input: Json;
}

export function looksLikeClaudeCode(firstLines: Json[]): boolean {
  return firstLines.some(
    (o) =>
      (o.type === 'user' || o.type === 'assistant') && typeof o.sessionId === 'string' && o.message && 'uuid' in o,
  ) || firstLines.some((o) => o.type === 'file-history-snapshot' || o.type === 'queue-operation');
}

export function parseClaudeCode(text: string, name = 'session.jsonl'): Trace {
  const steps: Step[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let bad = 0;
  let cwd: string | undefined;
  let model: string | undefined;
  let version: string | undefined;
  let gitBranch: string | undefined;
  let sessionId: string | undefined;
  let aiTitle: string | undefined;
  let first: number | null = null;
  let last: number | null = null;
  let turn = 0;
  let lastIntent: string | undefined;
  const pending = new Map<string, Pending>();
  const usageSeen = new Set<string>();

  const push = (s: Omit<Step, 'id' | 'turn' | 'files'> & { files?: string[] }) => {
    const step: Step = { ...s, id: steps.length, turn, files: s.files ?? [] };
    steps.push(step);
    return step;
  };
  const rel = (p: string) => relPath(p, cwd);

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let o: Json;
    try {
      o = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    if (o.type === 'ai-title' && typeof o.aiTitle === 'string') aiTitle = o.aiTitle;
    if (o.type === 'summary' && typeof o.summary === 'string' && !aiTitle) aiTitle = o.summary;
    if (o.type === 'custom-title' && typeof o.customTitle === 'string') aiTitle = o.customTitle;
    if (o.type === 'attachment' && o.attachment && typeof o.attachment === 'object') {
      const a: Json = o.attachment;
      cwd ??= o.cwd ?? a.snapshot?.workingDirectory;
      const t = parseTime(o.timestamp);
      if ((a.type === 'file' || a.type === 'compact_file_reference') && typeof a.filename === 'string') {
        // Files the harness put into the agent's context (an @-mention, or re-attached after compaction).
        const path = rel(a.filename);
        const file: Json | undefined = a.content?.file;
        const content = typeof file?.content === 'string' ? redact(file.content).slice(0, MAX_CONTENT) : undefined;
        const full = content !== undefined && (Number(file?.startLine ?? 1) <= 1) && (!file?.totalLines || Number(file?.numLines ?? 0) >= Number(file.totalLines));
        push({ t, kind: 'read', actor: 'user', tool: 'context', title: `In context: ${path}`, files: [path], read: { path, full, content } });
        continue;
      }
      if (a.type === 'edited_text_file' && typeof a.filename === 'string') {
        const path = rel(a.filename);
        push({ t, kind: 'tool', actor: 'user', tool: 'external-edit', title: `Changed outside the agent: ${path}`, files: [path], detail: 'This file was modified by you, an editor or a formatter while the agent was working.' });
        continue;
      }
      skipped++;
      continue;
    }
    if (BOOKKEEPING.has(o.type)) {
      skipped++;
      continue;
    }
    if (o.type !== 'user' && o.type !== 'assistant') {
      skipped++;
      continue;
    }
    if (o.isMeta) {
      skipped++;
      continue;
    }
    cwd ??= o.cwd;
    version ??= o.version;
    gitBranch ??= o.gitBranch;
    sessionId ??= o.sessionId;
    const t = parseTime(o.timestamp);
    if (t !== null) {
      first ??= t;
      last = t;
    }
    const actor = o.isSidechain ? 'subagent' : 'agent';
    const msg: Json = o.message ?? {};

    if (o.type === 'assistant') {
      model ??= msg.model && msg.model !== '<synthetic>' ? msg.model : undefined;
      const usage = readUsage(msg, usageSeen);
      const blocks: Json[] = Array.isArray(msg.content) ? msg.content : [];
      for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          const body = redact(b.text.trim());
          push({ t, kind: 'message', actor, title: truncate(oneLine(body), 120), text: body, usage });
          lastIntent = body;
        } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
          const body = redact(b.thinking.trim());
          push({ t, kind: 'thinking', actor, title: truncate(oneLine(body), 120), text: body, usage });
          lastIntent ??= body;
        } else if (b.type === 'tool_use') {
          const step = toolUseStep(b, t, actor, lastIntent, rel);
          step.usage = usage;
          const s = push(step);
          pending.set(b.id, { step: s, name: b.name, input: b.input ?? {} });
        }
      }
      continue;
    }

    // user line: either a real prompt or tool results
    const content = msg.content;
    if (typeof content === 'string') {
      const prompt = cleanPrompt(content);
      if (prompt) {
        turn++;
        lastIntent = undefined;
        push({ t, kind: 'prompt', actor: o.isSidechain ? 'agent' : 'user', title: truncate(oneLine(prompt), 120), text: redact(prompt) });
        steps[steps.length - 1].turn = turn;
      }
      continue;
    }
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    for (const b of content as Json[]) {
      if (b.type === 'tool_result') {
        const p = pending.get(b.tool_use_id);
        if (!p) continue;
        pending.delete(b.tool_use_id);
        completeTool(p, b, o.toolUseResult, rel);
      } else if (b.type === 'text' && typeof b.text === 'string') {
        texts.push(b.text);
      }
    }
    if (texts.length) {
      const prompt = cleanPrompt(texts.join('\n'));
      if (prompt) {
        turn++;
        lastIntent = undefined;
        push({ t, kind: 'prompt', actor: o.isSidechain ? 'agent' : 'user', title: truncate(oneLine(prompt), 120), text: redact(prompt) });
        steps[steps.length - 1].turn = turn;
      }
    }
  }

  for (const p of pending.values()) {
    if (p.step.kind === 'command' && p.step.command) {
      p.step.command.interrupted = true;
    }
  }
  if (bad) warnings.push(`${bad} line${bad === 1 ? '' : 's'} could not be read as JSON and were skipped.`);

  const firstPrompt = steps.find((s) => s.kind === 'prompt');
  const title = aiTitle ?? (firstPrompt ? truncate(oneLine(firstPrompt.text ?? ''), 90) : basename(name));
  return {
    id: sessionId ?? hash(text.slice(0, 4000)),
    source: 'claude-code',
    title,
    cwd,
    model,
    agentVersion: version ? `Claude Code ${version}` : 'Claude Code',
    gitBranch,
    startedAt: first ?? undefined,
    endedAt: last ?? undefined,
    steps,
    warnings,
    skippedRecords: skipped,
  };
}

function readUsage(msg: Json, seen: Set<string>): Usage | undefined {
  const u = msg.usage;
  if (!u || !msg.id || seen.has(msg.id)) return undefined;
  seen.add(msg.id);
  return {
    input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens ?? 0,
    cached: u.cache_read_input_tokens ?? 0,
  };
}

function cleanPrompt(s: string): string | null {
  let text = s;
  // Slash commands: <command-name>/foo</command-name><command-args>…</command-args>
  const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
    text = `${cmd[1].trim()} ${args ? args[1].trim() : ''}`.trim();
  }
  text = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-(stdout|stderr|caveat)>[\s\S]*?<\/local-command-\1>/g, '')
    .replace(/<command-(message|args)>[\s\S]*?<\/command-\1>/g, '')
    .replace(/<\/?ide_[a-z_]+>[\s\S]*?(?=\n|$)/g, '')
    .trim();
  if (!text) return null;
  if (/^\[Request interrupted by user/.test(text)) return null;
  if (/^Caveat: The messages below were generated/.test(text)) return null;
  return text;
}

function toolUseStep(
  b: Json,
  t: number | null,
  actor: 'agent' | 'subagent',
  intent: string | undefined,
  rel: (p: string) => string,
): Omit<Step, 'id' | 'turn'> {
  const name: string = b.name ?? 'tool';
  const input: Json = b.input ?? {};
  const base = { t, actor, tool: name, intent, files: [] as string[] };
  const fp: string | undefined = input.file_path ?? input.notebook_path ?? input.path;

  switch (name) {
    case 'Read': {
      const path = rel(fp ?? '');
      return { ...base, kind: 'read', title: `Read ${path}`, files: [path], read: { path, full: !input.offset && !input.limit } };
    }
    case 'Edit':
    case 'MultiEdit': {
      const path = rel(fp ?? '');
      const edits = name === 'Edit' ? [input] : Array.isArray(input.edits) ? input.edits : [];
      const se = edits.map((e: Json) => ({
        oldString: redact(String(e.old_string ?? '')),
        newString: redact(String(e.new_string ?? '')),
        replaceAll: !!e.replace_all,
      }));
      const added = se.reduce((n: number, e: { newString: string }) => n + countLines(e.newString), 0);
      const removed = se.reduce((n: number, e: { oldString: string }) => n + countLines(e.oldString), 0);
      return {
        ...base,
        kind: 'edit',
        title: `Edit ${path}`,
        files: [path],
        edit: { path, op: 'update', edits: se, added, removed },
      };
    }
    case 'Write': {
      const path = rel(fp ?? '');
      const content = redact(String(input.content ?? ''));
      return {
        ...base,
        kind: 'create',
        title: `Write ${path}`,
        files: [path],
        edit: { path, op: 'create', after: content.slice(0, MAX_CONTENT), added: countLines(content), removed: 0 },
      };
    }
    case 'NotebookEdit': {
      const path = rel(fp ?? '');
      return {
        ...base,
        kind: 'edit',
        title: `Edit notebook ${path}`,
        files: [path],
        edit: { path, op: 'update', opaque: true, added: countLines(input.new_source), removed: 0 },
      };
    }
    case 'Bash':
    case 'PowerShell':
    case 'BashOutput': {
      const cmd = redact(String(input.command ?? input.bash_id ?? ''));
      const categories = classifyCommand(cmd);
      const readTargets = shellReadTargets(cmd);
      const desc = typeof input.description === 'string' ? input.description : undefined;
      return {
        ...base,
        intent: intent ?? desc,
        kind: 'command',
        title: desc ? desc : truncate(oneLine(cmd), 120),
        files: readTargets.map(rel),
        command: { cmd, exitCode: null, failed: false, output: '', categories, description: desc, writes: shellWriteTargets(cmd).map(rel) },
      };
    }
    case 'Grep':
    case 'Glob':
    case 'LS': {
      const pattern = String(input.pattern ?? input.path ?? '');
      const where = input.path ? ` in ${rel(String(input.path))}` : '';
      return {
        ...base,
        kind: 'search',
        title: `${name === 'Glob' ? 'Find files' : name === 'LS' ? 'List' : 'Search'} ${pattern}${where}`,
        search: { pattern, path: input.path ? rel(String(input.path)) : undefined },
      };
    }
    case 'WebFetch':
    case 'WebSearch':
      return {
        ...base,
        kind: 'web',
        title: name === 'WebFetch' ? `Fetch ${input.url ?? ''}` : `Search the web: ${input.query ?? ''}`,
        web: { url: input.url, query: input.query },
      };
    case 'Task':
    case 'Agent':
      return {
        ...base,
        kind: 'subagent',
        title: `Sub-agent: ${input.description ?? input.subagent_type ?? 'task'}`,
        detail: redact(truncate(String(input.prompt ?? ''), 4000)),
      };
    case 'TodoWrite': {
      const items: PlanItem[] = (Array.isArray(input.todos) ? input.todos : []).map((x: Json) => ({
        text: String(x.content ?? x.activeForm ?? ''),
        status: x.status === 'completed' || x.status === 'in_progress' ? x.status : 'pending',
      }));
      const done = items.filter((i) => i.status === 'completed').length;
      return { ...base, kind: 'plan', title: `Plan updated (${done}/${items.length} done)`, plan: { items } };
    }
    default:
      return {
        ...base,
        kind: 'tool',
        title: prettyToolName(name),
        detail: redact(truncate(safeJson(input), 3000)),
      };
  }
}

function completeTool(p: Pending, block: Json, tur: unknown, rel: (p: string) => string) {
  const s = p.step;
  const isError = block.is_error === true;
  const resultText = redact(stripAnsi(blockText(block.content)));
  const r: Json | null = tur && typeof tur === 'object' ? (tur as Json) : null;

  if (s.kind === 'command' && s.command) {
    const stdout = r ? String(r.stdout ?? '') : '';
    const stderr = r ? String(r.stderr ?? '') : '';
    let out = r ? [stdout, stderr].filter(Boolean).join(stderr && stdout ? '\n' : '') : resultText;
    if (!r) out = resultText.replace(/^Exit code \d+\n?/, '');
    out = redact(stripAnsi(out));
    const code = resultText.match(/^Exit code (-?\d+)/);
    s.command.exitCode = code ? Number(code[1]) : isError ? 1 : 0;
    s.command.interrupted = !!r?.interrupted;
    s.command.failed = isError || (s.command.exitCode ?? 0) !== 0 || !!r?.interrupted;
    s.command.output = out.slice(0, MAX_OUTPUT);
    s.error = s.command.failed;
    const target = s.files[0];
    if (target && !s.command.failed) {
      s.read = { path: target, full: /^(cat|type|Get-Content|gc|bat)\b/i.test(s.command.cmd.trim()), content: undefined, viaShell: true };
    }
    if (/\bsed\s+-i\b|>\s*[^&|]|\bSet-Content\b|\bOut-File\b|\bmv\b|\brm\b|\bRemove-Item\b/.test(s.command.cmd)) {
      // File changes made through the shell are noted but can't be reconstructed.
      s.detail = 'This command may have changed files directly; the log does not record their contents.';
    }
    return;
  }

  if (isError) {
    s.error = true;
    s.output = resultText.replace(/<\/?tool_use_error>/g, '').slice(0, MAX_OUTPUT);
    if (s.edit) {
      // A failed edit changed nothing.
      s.title = `${s.title} (failed)`;
      s.edit = undefined;
      s.kind = 'tool';
    }
    return;
  }

  switch (s.kind) {
    case 'read': {
      const file = r?.file as Json | undefined;
      if (file && typeof file.content === 'string' && s.read) {
        const total = Number(file.totalLines ?? 0);
        const start = Number(file.startLine ?? 1);
        const num = Number(file.numLines ?? 0);
        s.read.full = start <= 1 && (total === 0 || num >= total);
        s.read.startLine = start;
        s.read.numLines = num;
        s.read.content = redact(file.content).slice(0, MAX_CONTENT);
      } else {
        s.output = resultText.slice(0, 2000);
      }
      return;
    }
    case 'edit': {
      if (s.edit && r) {
        if (typeof r.originalFile === 'string') s.edit.before = redact(r.originalFile).slice(0, MAX_CONTENT);
        const sp = Array.isArray(r.structuredPatch) ? r.structuredPatch : [];
        if (sp.length) {
          s.edit.patch = structuredToUnified(sp);
          const c = countPatch(s.edit.patch);
          s.edit.added = c.added;
          s.edit.removed = c.removed;
        }
      }
      return;
    }
    case 'create': {
      if (s.edit && r) {
        if (r.type === 'update') {
          s.edit.op = 'update';
          s.kind = 'edit';
          s.title = s.title.replace(/^Write /, 'Overwrite ');
        }
        if (typeof r.originalFile === 'string') s.edit.before = redact(r.originalFile).slice(0, MAX_CONTENT);
        const sp = Array.isArray(r.structuredPatch) ? r.structuredPatch : [];
        if (sp.length) {
          s.edit.patch = structuredToUnified(sp);
          const c = countPatch(s.edit.patch);
          s.edit.added = c.added;
          s.edit.removed = c.removed;
        }
      }
      return;
    }
    case 'search': {
      if (s.search) s.search.output = resultText.slice(0, 6000);
      return;
    }
    default:
      s.output = resultText.slice(0, 6000);
  }
  void rel;
}

function structuredToUnified(sp: Json[]): string {
  const out: string[] = [];
  for (const h of sp) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines ?? []) out.push(redact(String(l)));
  }
  return out.join('\n');
}

function blockText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((x: Json) => (x && x.type === 'text' ? String(x.text ?? '') : x && x.type === 'image' ? '[image]' : ''))
      .join('\n');
  }
  return '';
}

function prettyToolName(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    return `${parts[1] ?? 'mcp'} · ${parts.slice(2).join(' ')}`;
  }
  return name;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export const _internal = { cleanPrompt, structuredToUnified };
export type { EditInfo, StepKind };
