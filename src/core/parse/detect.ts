import type { Trace } from '../types';
import { looksLikeClaudeCode, parseClaudeCode } from './claudeCode';
import { looksLikeCodex, parseCodex } from './codex';
import { looksLikeIntentTrace, parseIntentTrace } from './intentTrace';

export class UnsupportedFormatError extends Error {
  constructor(message = 'This file is not a Claude Code session, a Codex session, or an Intent Trace JSON file.') {
    super(message);
    this.name = 'UnsupportedFormatError';
  }
}

export type DetectedFormat = 'claude-code' | 'codex' | 'intent-trace';

export function detectFormat(text: string): DetectedFormat | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') && !trimmed.slice(0, 2_000_000).includes('\n{')) {
    try {
      const o = JSON.parse(trimmed);
      if (looksLikeIntentTrace(o)) return 'intent-trace';
    } catch {
      /* may still be JSONL with one line */
    }
  }
  const head: Record<string, any>[] = [];
  for (const line of trimmed.split('\n', 60)) {
    const l = line.trim();
    if (!l) continue;
    try {
      head.push(JSON.parse(l));
    } catch {
      /* ignore */
    }
  }
  if (!head.length) return null;
  if (head.length === 1 && looksLikeIntentTrace(head[0])) return 'intent-trace';
  if (looksLikeCodex(head)) return 'codex';
  if (looksLikeClaudeCode(head)) return 'claude-code';
  return null;
}

export function parseTrace(text: string, name?: string): Trace {
  const fmt = detectFormat(text);
  switch (fmt) {
    case 'claude-code':
      return parseClaudeCode(text, name);
    case 'codex':
      return parseCodex(text, name);
    case 'intent-trace':
      return parseIntentTrace(text);
    default:
      throw new UnsupportedFormatError();
  }
}
