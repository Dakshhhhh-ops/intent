import type { EditInfo, Step, Trace } from '../types';
import { classifyCommand, shellReadTarget, shellReadTargets, shellWriteTargets } from '../analyze/commands';
import { redact } from '../redact';
import { countLines, countPatch, hash, oneLine, parseTime, relPath, stripAnsi, truncate } from '../util';

// Codex CLI writes ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Two generations exist in the wild:
//   older: response_item {message | reasoning | function_call(shell/exec_command) | custom_tool_call(apply_patch)}
//          + event_msg {exec_command_end | patch_apply_end}
//   newer: event_msg {item_completed: UserMessage | AgentMessage | Reasoning | CommandExecution | FileChange}
// When the newer item events are present we use only them, to avoid counting things twice.

type Json = Record<string, any>;
const MAX_OUTPUT = 20_000;

export function looksLikeCodex(firstLines: Json[]): boolean {
  return firstLines.some(
    (o) => o.type === 'session_meta' || ((o.type === 'response_item' || o.type === 'event_msg') && o.payload && typeof o.payload === 'object'),
  );
}

export function parseCodex(text: string, name = 'rollout.jsonl'): Trace {
  const records: Json[] = [];
  let bad = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      bad++;
    }
  }
  // Sessions can span CLI versions. Turns that have item events use only those;
  // other turns fall back to the older response_item records.
  const itemTurns = new Set<string>();
  let itemsWithoutTurn = false;
  for (const o of records) {
    if (o.type === 'event_msg' && o.payload?.type === 'item_completed') {
      if (o.payload.turn_id) itemTurns.add(String(o.payload.turn_id));
      else itemsWithoutTurn = true;
    }
  }
  const turnOf = (o: Json): string | undefined =>
    o.payload?.turn_id ?? o.payload?.internal_chat_message_metadata_passthrough?.turn_id ?? undefined;
  const coveredByItems = (o: Json): boolean => {
    const id = turnOf(o);
    return id ? itemTurns.has(String(id)) : itemsWithoutTurn;
  };

  const steps: Step[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let cwd: string | undefined;
  let model: string | undefined;
  let version: string | undefined;
  let gitBranch: string | undefined;
  let id: string | undefined;
  let first: number | null = null;
  let last: number | null = null;
  let turn = 0;
  let lastIntent: string | undefined;
  const calls = new Map<string, Step>();

  const rel = (p: string) => relPath(p, cwd);
  const push = (s: Omit<Step, 'id' | 'turn' | 'files'> & { files?: string[] }) => {
    const step: Step = { ...s, id: steps.length, turn, files: s.files ?? [] };
    steps.push(step);
    return step;
  };
  const prompt = (t: number | null, raw: string) => {
    const txt = cleanUserText(raw);
    if (!txt) return;
    turn++;
    lastIntent = undefined;
    push({ t, kind: 'prompt', actor: 'user', title: truncate(oneLine(txt), 120), text: redact(txt) });
  };
  const message = (t: number | null, raw: string) => {
    const body = redact(raw.trim());
    if (!body) return;
    push({ t, kind: 'message', actor: 'agent', title: truncate(oneLine(body), 120), text: body });
    lastIntent = body;
  };
  const thinking = (t: number | null, raw: string) => {
    const body = redact(raw.trim());
    if (!body) return;
    push({ t, kind: 'thinking', actor: 'agent', title: truncate(oneLine(body), 120), text: body });
  };
  const command = (t: number | null, cmd: string, exitCode: number | null, output: string, durationMs?: number, parsed?: Json[]) => {
    const c = redact(cmd);
    const categories = classifyCommand(c);
    const out = redact(stripAnsi(output)).slice(0, MAX_OUTPUT);
    const failed = exitCode !== null && exitCode !== 0;
    const readParsed = parsed?.filter((p) => p.type === 'read') ?? [];
    const target = readParsed[0]?.path ?? readParsed[0]?.name ?? shellReadTarget(c);
    const allRead = parsed && parsed.length > 0 && parsed.every((p) => p.type === 'read');
    const allSearch = parsed && parsed.length > 0 && parsed.every((p) => p.type === 'search' || p.type === 'list_files');
    if (allRead && target && !failed) {
      const path = rel(String(target));
      return push({
        t, kind: 'read', actor: 'agent', tool: 'shell', intent: lastIntent, title: `Read ${path}`, files: [path],
        read: { path, full: !/\b(sed\s+-n|head|tail|Select-Object\s+-(First|Last|Skip))\b/i.test(c), viaShell: true, content: undefined },
        command: { cmd: c, exitCode, failed, output: out, categories, durationMs },
      });
    }
    if (allSearch && !failed) {
      return push({
        t, kind: 'search', actor: 'agent', tool: 'shell', intent: lastIntent, title: truncate(oneLine(c), 120),
        search: { pattern: String(parsed![0].query ?? parsed![0].cmd ?? c), path: parsed![0].path ? rel(String(parsed![0].path)) : undefined, output: out.slice(0, 6000) },
        command: { cmd: c, exitCode, failed, output: out, categories, durationMs },
      });
    }
    const targets = readParsed.length ? readParsed.map((p) => String(p.path ?? p.name)) : shellReadTargets(c);
    const onlyLooking = !failed && categories.every((x) => x === 'read' || x === 'search');
    if (onlyLooking && targets.length) {
      // e.g. `Get-Content a.js; Get-Content b.js` or `cat a.js`
      const files = targets.map((x) => rel(x));
      const single = files.length === 1 && /^\s*(cat|type|Get-Content|gc)\s+(-Raw\s+)?["']?[^\s|;&]+["']?\s*$/i.test(c);
      return push({
        t, kind: 'read', actor: 'agent', tool: 'shell', intent: lastIntent,
        title: files.length === 1 ? `Read ${files[0]}` : `Read ${files.length} files: ${files.join(', ')}`,
        files,
        read: { path: files[0], full: single, viaShell: true, content: single ? out : undefined },
        command: { cmd: c, exitCode, failed, output: out, categories, durationMs },
      });
    }
    if (onlyLooking && categories.includes('search')) {
      return push({
        t, kind: 'search', actor: 'agent', tool: 'shell', intent: lastIntent, title: truncate(oneLine(c), 120),
        search: { pattern: c, output: out.slice(0, 6000) },
        command: { cmd: c, exitCode, failed, output: out, categories, durationMs },
      });
    }
    const s = push({
      t, kind: 'command', actor: 'agent', tool: 'shell', intent: lastIntent, title: truncate(oneLine(c), 120),
      files: targets.map((x) => rel(x)),
      command: { cmd: c, exitCode, failed, output: out, categories, durationMs, writes: shellWriteTargets(c).map((x) => rel(x)) },
      error: failed,
    });
    if (target && !failed) s.read = { path: rel(String(target)), full: true, viaShell: true };
    return s;
  };
  const fileChange = (t: number | null, path: string, kind: string, diff: string, movePath?: string | null, raw?: string) => {
    const p = rel(path);
    const op: EditInfo['op'] = kind === 'add' ? 'create' : kind === 'delete' ? 'delete' : 'update';
    let edit: EditInfo;
    if (raw !== undefined && op !== 'update') {
      // Newer Codex logs give added/deleted files as plain content, not a diff.
      const content = redact(raw);
      edit = op === 'create' ? { path: p, op, after: content, added: countLines(content), removed: 0 } : { path: p, op, before: content, added: 0, removed: countLines(content) };
    } else {
      const patch = redact(diff ?? '');
      const c = countPatch(patch);
      edit = { path: p, op, patch, added: c.added, removed: c.removed };
      if (op === 'create') edit.after = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
    }
    const stepKind = op === 'create' ? 'create' : op === 'delete' ? 'delete' : 'edit';
    const verb = op === 'create' ? 'Create' : op === 'delete' ? 'Delete' : 'Edit';
    push({
      t, kind: stepKind, actor: 'agent', tool: 'apply_patch', intent: lastIntent,
      title: `${verb} ${p}${movePath ? ` → ${rel(movePath)}` : ''}`, files: [p], edit,
    });
  };

  for (const o of records) {
    const t = parseTime(o.timestamp);
    if (t !== null) {
      first ??= t;
      last = t;
    }
    const p: Json = o.payload && typeof o.payload === 'object' ? o.payload : {};

    if (o.type === 'session_meta') {
      cwd ??= p.cwd;
      id ??= p.id ?? p.session_id;
      version ??= p.cli_version;
      gitBranch ??= p.git?.branch;
      continue;
    }
    if (o.type === 'turn_context') {
      cwd ??= p.cwd;
      model ??= p.model;
      continue;
    }

    if (o.type === 'event_msg' && p.type === 'item_completed') {
      const it: Json = p.item ?? {};
      switch (it.type) {
        case 'UserMessage':
          prompt(t, contentText(it.content));
          break;
        case 'AgentMessage':
          message(t, contentText(it.content));
          break;
        case 'Reasoning': {
          const txt = [...(it.summary_text ?? []), ...(it.raw_content ?? [])].map((x: unknown) => (typeof x === 'string' ? x : (x as Json)?.text ?? '')).join('\n');
          thinking(t, txt);
          break;
        }
        case 'CommandExecution': {
          const parsed: Json[] = Array.isArray(it.parsed_cmd) ? it.parsed_cmd : [];
          const cmdText = parsed.length ? parsed.map((x) => x.cmd).filter(Boolean).join(' && ') : Array.isArray(it.command) ? it.command.join(' ') : String(it.command ?? '');
          const exit = typeof it.exit_code === 'number' ? it.exit_code : it.status === 'failed' ? 1 : it.status === 'completed' ? 0 : null;
          const dur = it.duration ? (it.duration.secs ?? 0) * 1000 + Math.round((it.duration.nanos ?? 0) / 1e6) : undefined;
          command(t, cmdText, exit, String(it.aggregated_output ?? it.output ?? ''), dur, parsed);
          break;
        }
        case 'FileChange': {
          const changes: Json = it.changes ?? {};
          for (const [path, ch] of Object.entries(changes)) {
            const c = ch as Json;
            const raw = typeof c.content === 'string' && typeof c.unified_diff !== 'string' ? c.content : undefined;
            fileChange(t, path, String(c.type ?? 'update'), String(c.unified_diff ?? ''), c.move_path, raw);
          }
          break;
        }
        case 'WebSearch':
          push({ t, kind: 'web', actor: 'agent', title: `Search the web: ${it.query ?? ''}`, web: { query: it.query } });
          break;
        default:
          skipped++;
      }
      continue;
    }

    // ---- older generation (only for turns without item events)
    if ((o.type === 'response_item' || o.type === 'event_msg') && coveredByItems(o)) {
      skipped++;
      continue;
    }
    if (o.type === 'response_item') {
      switch (p.type) {
        case 'message': {
          const txt = contentText(p.content);
          if (p.role === 'user') prompt(t, txt);
          else if (p.role === 'assistant') message(t, txt);
          else skipped++;
          break;
        }
        case 'reasoning': {
          const txt = (p.summary ?? []).map((x: Json) => x?.text ?? '').join('\n');
          if (txt.trim()) thinking(t, txt);
          break;
        }
        case 'function_call':
        case 'local_shell_call': {
          const args = parseArgs(p.arguments ?? p.action);
          const name = String(p.name ?? 'shell');
          if (name === 'shell' || name === 'exec_command' || name === 'container.exec' || p.type === 'local_shell_call') {
            const cmd = Array.isArray(args.command) ? shellJoin(args.command) : String(args.cmd ?? args.command ?? '');
            const s = command(t, cmd, null, '');
            calls.set(String(p.call_id ?? p.id), s);
          } else if (name === 'apply_patch') {
            for (const f of parseApplyPatch(String(args.input ?? args.patch ?? ''))) fileChange(t, f.path, f.kind, f.diff, f.movePath);
          } else if (name === 'update_plan') {
            const items = (args.plan ?? []).map((x: Json) => ({ text: String(x.step ?? ''), status: x.status === 'completed' || x.status === 'in_progress' ? x.status : 'pending' }));
            push({ t, kind: 'plan', actor: 'agent', title: `Plan updated (${items.filter((i: Json) => i.status === 'completed').length}/${items.length} done)`, plan: { items } });
          } else {
            const s = push({ t, kind: 'tool', actor: 'agent', tool: name, intent: lastIntent, title: name, detail: truncate(JSON.stringify(args, null, 2), 3000) });
            calls.set(String(p.call_id ?? p.id), s);
          }
          break;
        }
        case 'function_call_output': {
          const s = calls.get(String(p.call_id));
          if (!s) break;
          const { output, exitCode, durationMs } = parseFnOutput(p.output);
          if (s.command) {
            s.command.output = redact(stripAnsi(output)).slice(0, MAX_OUTPUT);
            if (s.command.exitCode === null) s.command.exitCode = exitCode;
            s.command.failed = (s.command.exitCode ?? 0) !== 0;
            s.command.durationMs ??= durationMs;
            s.error = s.command.failed;
            if (s.kind === 'read' && s.command.failed) s.kind = 'command';
          } else s.output = redact(output).slice(0, 6000);
          break;
        }
        case 'custom_tool_call': {
          if (p.name === 'apply_patch') {
            for (const f of parseApplyPatch(String(p.input ?? ''))) fileChange(t, f.path, f.kind, f.diff, f.movePath);
          } else {
            // Newer "exec" cells wrap tool calls in JS; pull out commands and patches when no item events exist.
            const src = String(p.input ?? '');
            for (const patch of src.matchAll(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/g)) {
              const unescaped = unescapeJs(patch[0]);
              for (const f of parseApplyPatch(unescaped)) fileChange(t, f.path, f.kind, f.diff, f.movePath);
            }
            for (const m of src.matchAll(/\bcmd\s*:\s*"((?:[^"\\]|\\.)*)"/g)) command(t, unescapeJs(m[1]), null, '');
          }
          break;
        }
        default:
          skipped++;
      }
      continue;
    }
    if (o.type === 'event_msg') {
      if (p.type === 'exec_command_end') {
        const s = calls.get(String(p.call_id));
        if (s?.command) {
          s.command.exitCode = typeof p.exit_code === 'number' ? p.exit_code : s.command.exitCode;
          s.command.failed = (s.command.exitCode ?? 0) !== 0;
          s.error = s.command.failed;
          const out = String(p.aggregated_output ?? [p.stdout, p.stderr].filter(Boolean).join('\n'));
          if (out && !s.command.output) s.command.output = redact(stripAnsi(out)).slice(0, MAX_OUTPUT);
        }
      } else skipped++;
      continue;
    }
    skipped++;
  }

  // Commands we never saw a result for keep exitCode null (unknown), which the analyzer treats as "not verified".
  if (bad) warnings.push(`${bad} line${bad === 1 ? '' : 's'} could not be read as JSON and were skipped.`);
  const firstPrompt = steps.find((s) => s.kind === 'prompt');
  return {
    id: id ?? hash(text.slice(0, 4000)),
    source: 'codex',
    title: firstPrompt ? truncate(oneLine(firstPrompt.text ?? ''), 90) : name,
    cwd: cwd ? cwd.replace(/^file:\/\/\//, '') : undefined,
    model,
    agentVersion: version ? `Codex CLI ${version}` : 'Codex CLI',
    gitBranch,
    startedAt: first ?? undefined,
    endedAt: last ?? undefined,
    steps,
    warnings,
    skippedRecords: skipped,
  };
}

function contentText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x: Json) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n');
  return '';
}

function cleanUserText(raw: string): string | null {
  let t = raw;
  if (/^\s*<(environment_context|user_instructions|permissions instructions|turn_aborted)/.test(t)) return null;
  if (/^\s*# AGENTS\.md instructions/.test(t)) return null;
  const req = t.match(/## My request for Codex:\s*([\s\S]*)$/);
  if (req) t = req[1];
  t = t.replace(/<image[^>]*>[\s\S]*?<\/image>/g, '[image]').trim();
  return t || null;
}

function parseArgs(a: unknown): Json {
  if (a && typeof a === 'object') return a as Json;
  if (typeof a === 'string') {
    try {
      return JSON.parse(a);
    } catch {
      return { input: a };
    }
  }
  return {};
}

function shellJoin(parts: string[]): string {
  // ["bash","-lc","npm test"] → "npm test"
  if (parts.length >= 3 && /(^|\/)(ba|z)?sh$|powershell(\.exe)?$|pwsh$/i.test(parts[0]) && /^-(l?c|Command)$/i.test(parts[1])) return parts.slice(2).join(' ');
  return parts.map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(' ');
}

function parseFnOutput(out: unknown): { output: string; exitCode: number | null; durationMs?: number } {
  const text = typeof out === 'string' ? out : contentText(out);
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && 'output' in j) {
      return {
        output: String(j.output ?? ''),
        exitCode: typeof j.metadata?.exit_code === 'number' ? j.metadata.exit_code : null,
        durationMs: typeof j.metadata?.duration_seconds === 'number' ? j.metadata.duration_seconds * 1000 : undefined,
      };
    }
  } catch {
    /* plain text */
  }
  const m = text.match(/(?:Exit code|Process exited with code):?\s*(-?\d+)/i);
  const body = text.replace(/^[\s\S]*?\nOutput:\n/, '');
  return { output: body, exitCode: m ? Number(m[1]) : null };
}

function unescapeJs(s: string): string {
  try {
    return JSON.parse(`"${s.replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`);
  } catch {
    return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

export interface PatchFile {
  path: string;
  kind: 'add' | 'update' | 'delete';
  diff: string;
  movePath?: string;
}

/** Parses the apply_patch envelope into per-file diffs. */
export function parseApplyPatch(src: string): PatchFile[] {
  const files: PatchFile[] = [];
  let cur: PatchFile | null = null;
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const m = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (m) {
      cur = { path: m[2].trim(), kind: m[1].toLowerCase() as PatchFile['kind'], diff: '' };
      files.push(cur);
      continue;
    }
    const mv = line.match(/^\*\*\* Move to: (.+)$/);
    if (mv && cur) {
      cur.movePath = mv[1].trim();
      continue;
    }
    if (/^\*\*\* (Begin|End) Patch/.test(line) || line.startsWith('*** End of File')) continue;
    if (!cur) continue;
    cur.diff += (cur.diff ? '\n' : '') + line;
  }
  return files;
}
