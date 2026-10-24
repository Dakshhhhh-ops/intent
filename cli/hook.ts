// Claude Code Stop hook: when the agent tries to finish, check the claims in its final message
// against its own log. A contradicted claim sends the agent back to work (exit 2) instead of
// letting a false "all tests pass" reach the user.
// Docs: https://code.claude.com/docs/en/hooks (Stop input, exit code 2, stop_hook_active).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { analyze } from '../src/core/analyze';
import { parseTrace } from '../src/core/parse/detect';
import { slimBytes } from '../src/core/parse/slim';
import type { Claim, Step, Trace } from '../src/core/types';

export interface StopInput {
  hook_event_name?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
}

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Claims in the agent's final message that the log contradicts. The transcript file can lag behind
 * the conversation at Stop time, so the final text comes from the hook input when it has it.
 */
export function finalMessageClaims(trace: Trace, lastMessage?: string): Claim[] {
  const steps = trace.steps.slice();
  const last = norm(lastMessage);
  let target: Step | undefined;
  if (last) {
    // Drop trailing messages already written for this reply (all or part of it), then add the full text.
    while (steps.length) {
      const s = steps[steps.length - 1];
      if (s.kind === 'message' && s.actor === 'agent' && norm(s.text) && last.includes(norm(s.text))) steps.pop();
      else break;
    }
    const prev = steps[steps.length - 1];
    target = {
      id: steps.length ? Math.max(...steps.map((s) => s.id)) + 1 : 0,
      t: Date.now(),
      kind: 'message',
      actor: 'agent',
      title: 'Final message',
      text: lastMessage,
      files: [],
      turn: prev?.turn ?? 0,
    };
    steps.push(target);
  } else {
    target = [...steps].reverse().find((s) => s.kind === 'message' && s.actor === 'agent');
  }
  if (!target) return [];
  const id = target.id;
  return analyze({ ...trace, steps }).claims.filter((c) => c.step === id && c.verdict === 'contradicted');
}

const quote = (s: string, n = 140) => {
  const t = norm(s);
  return `“${t.length > n ? t.slice(0, n - 1) + '…' : t}”`;
};

export function feedback(claims: Claim[]): string {
  const lines = claims.map((c) => `- You said ${quote(c.text)}, but your own log disagrees: ${c.explanation}`);
  return [
    `Intent Replay checked your final message against this session's log and found ${claims.length === 1 ? 'a claim' : `${claims.length} claims`} it contradicts:`,
    ...lines,
    'Fix the problem and rerun the check, or correct your summary so it says what the log shows.',
  ].join('\n');
}

export type HookResult = { exit: 0 | 2; stderr?: string; stdout?: string };

/** Decide what the hook does. Never blocks on its own errors: a broken check must not trap the agent. */
export function runStopHook(input: StopInput, read: (path: string) => Trace): HookResult {
  if (input.hook_event_name && input.hook_event_name !== 'Stop') return { exit: 0 };
  if (!input.transcript_path || !existsSync(input.transcript_path)) return { exit: 0 };
  let claims: Claim[];
  try {
    claims = finalMessageClaims(read(input.transcript_path), input.last_assistant_message);
  } catch {
    return { exit: 0 };
  }
  if (!claims.length) return { exit: 0 };
  // Already sent back once: tell the person instead of blocking again, so the hook can't loop.
  if (input.stop_hook_active) {
    const msg = `Intent Replay: the final message still makes ${claims.length === 1 ? 'a claim' : `${claims.length} claims`} the log contradicts. ${claims.map((c) => `${quote(c.text, 80)}: ${c.explanation}`).join(' ')}`;
    return { exit: 0, stdout: JSON.stringify({ systemMessage: msg }) };
  }
  return { exit: 2, stderr: feedback(claims) };
}

export function readTranscript(path: string): Trace {
  return parseTrace(slimBytes(readFileSync(path)), basename(path));
}

export function hookMain(): never {
  let input: StopInput = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }
  const r = runStopHook(input, readTranscript);
  if (r.stdout) process.stdout.write(r.stdout + '\n');
  if (r.stderr) process.stderr.write(r.stderr + '\n');
  process.exit(r.exit);
}

/** The Stop hook entry this tool adds to a Claude Code settings file. */
export function hookCommand(script: string): string {
  return `node "${resolve(script).replace(/\\/g, '/')}" hook`;
}

/**
 * Add the Stop hook to a Claude Code settings file (~/.claude/settings.json, or the project's .claude/settings.json).
 * Keeps every other setting and hook; replaces an earlier Intent Replay entry instead of adding a second.
 */
export function settingsPath(project: boolean): string {
  return project ? join(process.cwd(), '.claude', 'settings.json') : join(homedir(), '.claude', 'settings.json');
}

export function installHook(script: string, path: string): { path: string; changed: boolean; command: string } {
  const command = hookCommand(script);
  let settings: Record<string, any> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw) settings = JSON.parse(raw); // throws on a broken file: better than overwriting it
  }
  const hooks = (settings.hooks ??= {});
  const stop: any[] = (hooks.Stop ??= []);
  const ours = (h: any) => typeof h?.command === 'string' && /intent-replay(?:\.mjs)?["']?\s+hook\b/.test(h.command);
  for (const group of stop) {
    if (Array.isArray(group?.hooks)) group.hooks = group.hooks.filter((h: any) => !(ours(h) && h.command !== command));
  }
  hooks.Stop = stop.filter((g) => !Array.isArray(g?.hooks) || g.hooks.length);
  const present = hooks.Stop.some((g: any) => g?.hooks?.some((h: any) => h.command === command));
  if (present) return { path, changed: false, command };
  hooks.Stop.push({ hooks: [{ type: 'command', command, timeout: 60 }] });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  return { path, changed: true, command };
}
