import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Finds agent session logs on this machine. Nothing is uploaded anywhere.

export interface SessionInfo {
  id: string;
  path: string;
  agent: 'claude-code' | 'codex';
  title: string;
  cwd?: string;
  mtime: number;
  size: number;
}

export function claudeRoot(): string {
  return process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, 'projects') : join(homedir(), '.claude', 'projects');
}

export function codexRoot(): string {
  return process.env.CODEX_HOME ? join(process.env.CODEX_HOME, 'sessions') : join(homedir(), '.codex', 'sessions');
}

function head(path: string, bytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function walk(dir: string, out: string[], depth = 0) {
  if (depth > 5 || !existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
}

const clean = (s: string) => s.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function claudeMeta(path: string): { title: string; cwd?: string } {
  let title = '';
  let cwd: string | undefined;
  let aiTitle = '';
  for (const line of head(path, 256 * 1024).split('\n')) {
    try {
      const o = JSON.parse(line);
      cwd ??= o.cwd;
      if (o.type === 'ai-title' && o.aiTitle) aiTitle = o.aiTitle;
      if (!title && o.type === 'user' && !o.isMeta && o.message) {
        const c = o.message.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ') : '';
        const t = clean(text);
        if (t && !t.startsWith('Caveat:')) title = t;
      }
      if (title && cwd && aiTitle) break;
    } catch {
      /* partial last line */
    }
  }
  return { title: aiTitle || title, cwd };
}

function codexMeta(path: string): { title: string; cwd?: string } {
  let title = '';
  let cwd: string | undefined;
  for (const line of head(path, 512 * 1024).split('\n')) {
    try {
      const o = JSON.parse(line);
      const p = o.payload ?? {};
      if (o.type === 'session_meta') cwd ??= p.cwd;
      if (!title && o.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'UserMessage') {
        const t = (p.item.content ?? []).map((x: any) => x.text ?? '').join(' ');
        const req = t.match(/## My request for Codex:\s*([\s\S]*)$/);
        title = clean(req ? req[1] : t);
      }
      if (!title && o.type === 'response_item' && p.type === 'message' && p.role === 'user') {
        const t = (p.content ?? []).map((x: any) => x.text ?? '').join(' ');
        if (!/^\s*<(environment_context|user_instructions|permissions)/.test(t) && !/^\s*# AGENTS\.md/.test(t)) {
          const req = t.match(/## My request for Codex:\s*([\s\S]*)$/);
          title = clean(req ? req[1] : t);
        }
      }
      if (title && cwd) break;
    } catch {
      /* ignore */
    }
  }
  return { title, cwd };
}

export function listSessions(): SessionInfo[] {
  const out: SessionInfo[] = [];
  const claude: string[] = [];
  const root = claudeRoot();
  if (existsSync(root)) {
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = join(root, d.name);
      for (const f of readdirSync(dir, { withFileTypes: true })) if (f.isFile() && f.name.endsWith('.jsonl')) claude.push(join(dir, f.name));
    }
  }
  for (const p of claude) {
    const st = statSync(p);
    if (st.size < 200) continue;
    const m = claudeMeta(p);
    if (!m.title) continue;
    out.push({ id: '', path: p, agent: 'claude-code', title: m.title, cwd: m.cwd, mtime: st.mtimeMs, size: st.size });
  }
  const codex: string[] = [];
  walk(codexRoot(), codex);
  for (const p of codex) {
    const st = statSync(p);
    if (st.size < 200) continue;
    const m = codexMeta(p);
    out.push({ id: '', path: p, agent: 'codex', title: m.title || 'Codex session', cwd: m.cwd, mtime: st.mtimeMs, size: st.size });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  out.forEach((s, i) => (s.id = String(i + 1)));
  return out;
}

export function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const n = (p: string) => resolve(p.replace(/^file:\/\/\//, '')).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return n(a) === n(b);
}

export function inside(child?: string, parent?: string): boolean {
  if (!child || !parent) return false;
  const n = (p: string) => resolve(p.replace(/^file:\/\/\//, '')).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const c = n(child);
  const p = n(parent);
  return c === p || c.startsWith(p + '/');
}
