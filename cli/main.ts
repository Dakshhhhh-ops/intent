import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { basename, dirname, join, resolve } from 'node:path';
import { analyze, RULE_INFO } from '../src/core/analyze';
import { parseTrace } from '../src/core/parse/detect';
import { slimBytes } from '../src/core/parse/slim';
import { toIntentTrace } from '../src/core/parse/intentTrace';
import { formatDuration, toMarkdown } from '../src/core/report/markdown';
import type { Severity } from '../src/core/types';
import { traceTag } from '../src/core/embed';
import { exportHtmlPath, injectBoot, startServer } from './server';
import { inside, listSessions, type SessionInfo } from './sessions';
import { hookMain, installHook, settingsPath } from './hook';

const VERSION = '0.1.0';
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c('2');
const bold = c('1');
const red = c('31');
const yellow = c('33');
const green = c('32');
const cyan = c('36');
const violet = c('35');

const HELP = `
${bold('intent-replay')} ${dim(VERSION)} — debug what an AI coding agent actually did

${bold('Usage')}
  intent-replay                      open the session picker for this folder in your browser
  intent-replay list [--all]         list Claude Code / Codex sessions (this folder, or all)
  intent-replay open <target>        replay a session in the browser
  intent-replay watch [target]       follow a session live while the agent works (default: latest)
  intent-replay report <target>      print a PR-ready Markdown report   [--out file] [--json]
  intent-replay check <target>       exit 1 if findings at/above a level [--fail-on high|medium|low]
  intent-replay export <target>      write a self-contained HTML replay  [-o replay.html]
  intent-replay audit                fact-check every local session at once, counts only [--json]
  intent-replay hook install         check claims when Claude Code stops; a false one sends it back [--project]

${bold('Target')}  a key like ${cyan('s1abc23')} (stable) or a number from ${cyan('list')}, ${cyan('latest')}, or a path to a .jsonl / .json file

${bold('Options')}
  --port <n>    port for the local viewer (default 4848)
  --no-open     don't open a browser
  --all         include sessions from every folder

Everything runs locally. Logs are never uploaded.
`;

interface Args {
  cmd: string;
  target?: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') flags.out = argv[++i];
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (['out', 'port', 'fail-on', 'format'].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else pos.push(a);
  }
  const known = ['list', 'open', 'watch', 'report', 'check', 'export', 'audit', 'hook', 'help'];
  if (pos[0] && !known.includes(pos[0])) return { cmd: 'open', target: pos[0], flags };
  return { cmd: pos[0] ?? 'picker', target: pos[1], flags };
}

function scoped(all: boolean): { list: SessionInfo[]; scopedToCwd: boolean } {
  const sessions = listSessions();
  if (all) return { list: sessions, scopedToCwd: false };
  const here = sessions.filter((s) => inside(s.cwd, process.cwd()));
  return here.length ? { list: here, scopedToCwd: true } : { list: sessions, scopedToCwd: false };
}

function resolveTarget(target: string | undefined, all: boolean): { path: string; label: string } {
  if (target && existsSync(target)) return { path: resolve(target), label: basename(target) };
  const { list } = scoped(all);
  if (!list.length) fail('No Claude Code or Codex sessions found. Pass a path to a .jsonl file instead.');
  if (!target || target === 'latest') return { path: list[0].path, label: list[0].title };
  // A stable key (from `list` or `audit`) works across folders and doesn't shift when new sessions appear.
  const hit = list.find((s) => s.id === target || s.key === target) ?? listSessions().find((s) => s.key === target);
  if (!hit) fail(`No session "${target}". Run ${cyan('intent-replay list')} to see keys and numbers.`);
  return { path: hit!.path, label: hit!.title };
}

function fail(msg: string): never {
  console.error(red('✗ ') + msg);
  process.exit(2);
}

function load(path: string) {
  // Read as bytes and slim in chunks: some sessions are bigger than the largest possible string.
  const text = slimBytes(readFileSync(path));
  const trace = parseTrace(text, basename(path));
  return { trace, analysis: analyze(trace) };
}

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function printList(all: boolean) {
  const { list, scopedToCwd } = scoped(all);
  if (!list.length) {
    console.log('No sessions found in ~/.claude/projects or ~/.codex/sessions.');
    return;
  }
  console.log(dim(scopedToCwd ? `Sessions for ${process.cwd()}` : 'Recent sessions (all folders)'));
  for (const s of list.slice(0, 30)) {
    const agent = s.agent === 'claude-code' ? violet('claude') : cyan('codex ');
    console.log(`${dim(s.id.padStart(3))}  ${cyan(s.key.padEnd(9))} ${agent}  ${dim(ago(s.mtime).padEnd(9))} ${s.title.slice(0, 70)}`);
  }
  if (list.length > 30) console.log(dim(`  … ${list.length - 30} more`));
}

function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
  } catch {
    /* print the URL instead */
  }
}

async function serve(flags: Args['flags'], initial?: { path: string }, live = false) {
  const all = !!flags.all;
  const { url } = await startServer({
    sessions: () => scoped(all).list,
    initial: initial ? { id: 'file', path: initial.path } : undefined,
    port: Number(flags.port ?? 4848),
    cwd: process.cwd(),
    live,
  });
  console.log(`${green('●')} Intent Replay is running at ${bold(url)}  ${dim('(Ctrl+C to stop)')}`);
  if (!flags['no-open']) openBrowser(url);
}

function printSummary(path: string) {
  const { trace, analysis: a } = load(path);
  const v = a.verdict.level === 'risky' ? red : a.verdict.level === 'review' ? yellow : green;
  console.log(`${v('■')} ${bold(a.verdict.label)}  ${dim(a.verdict.summary)}`);
  console.log(dim(`${trace.agentVersion ?? trace.source} · ${formatDuration(a.stats.durationMs)} · ${a.stats.steps} steps · ${a.stats.filesChanged} file${a.stats.filesChanged === 1 ? '' : 's'} changed`));
  for (const cl of a.claims) {
    const tag = cl.verdict === 'supported' ? green('supported   ') : cl.verdict === 'contradicted' ? red('contradicted') : yellow(cl.verdict.padEnd(12));
    console.log(`  ${tag} “${cl.text.slice(0, 90)}”`);
  }
  for (const f of a.findings) {
    const sev = f.severity === 'high' ? red('high  ') : f.severity === 'medium' ? yellow('medium') : dim(f.severity.padEnd(6));
    console.log(`  ${sev} ${f.title} ${dim(`(${RULE_INFO[f.rule].name})`)}`);
  }
}

/** One session's audit result: counts only, nothing from the log itself. */
interface AuditSummary {
  verdicts: Record<string, number>;
  contradicted: number;
  high: number;
  highRules: Record<string, number>;
}

function summarize(path: string): AuditSummary {
  const { analysis: a } = load(path);
  const verdicts: Record<string, number> = { supported: 0, contradicted: 0, stale: 0, unverified: 0 };
  for (const c of a.claims) verdicts[c.verdict]++;
  const highRules: Record<string, number> = {};
  for (const f of a.findings) if (f.severity === 'high') highRules[f.rule] = (highRules[f.rule] ?? 0) + 1;
  return { verdicts, contradicted: verdicts.contradicted, high: a.findings.filter((f) => f.severity === 'high').length, highRules };
}

/** Worker thread: summarize the sessions it was given and report each one back. */
function auditWorker() {
  const paths = (workerData as { paths: string[] }).paths;
  for (const path of paths) {
    try {
      parentPort!.postMessage({ path, summary: summarize(path) });
    } catch {
      parentPort!.postMessage({ path, summary: null });
    }
  }
}

// Results are cached per file (size + modified time) and per build of this CLI, so a second audit is instant.
const CACHE = join(tmpdir(), 'intent-replay', 'audit-cache.json');
type Cache = { build: string; entries: Record<string, { size: number; mtime: number; summary: AuditSummary | null }> };

function buildId(): string {
  try {
    return `${VERSION}:${statSync(fileURLToPath(import.meta.url)).mtimeMs}`;
  } catch {
    return VERSION;
  }
}

function readCache(): Cache {
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8')) as Cache;
    if (c.build === buildId()) return c;
  } catch {
    /* no cache yet */
  }
  return { build: buildId(), entries: {} };
}

/** Every local session at once: how often did an agent claim something its own log contradicts? Counts only. */
async function audit(json: boolean) {
  const list = listSessions();
  if (!list.length) fail('No Claude Code or Codex sessions found in ~/.claude/projects or ~/.codex/sessions.');
  const t0 = Date.now();
  const cache = readCache();
  const results = new Map<string, AuditSummary | null>();
  const todo: SessionInfo[] = [];
  for (const s of list) {
    const hit = cache.entries[s.path];
    if (hit && hit.size === s.size && hit.mtime === s.mtime) results.set(s.path, hit.summary);
    else todo.push(s);
  }
  if (todo.length) {
    // Biggest sessions first, each to the least-loaded worker, so one huge log doesn't hold up the rest.
    const n = Math.max(1, Math.min(4, (availableParallelism?.() ?? cpus().length) - 1, todo.length));
    const buckets: { paths: string[]; bytes: number }[] = Array.from({ length: n }, () => ({ paths: [], bytes: 0 }));
    for (const s of [...todo].sort((a, b) => b.size - a.size)) {
      const b = buckets.reduce((m, x) => (x.bytes < m.bytes ? x : m));
      b.paths.push(s.path);
      b.bytes += s.size;
    }
    let done = 0;
    const byPath = new Map(todo.map((s) => [s.path, s]));
    await Promise.all(
      buckets.map(
        (b) =>
          new Promise<void>((resolveP) => {
            const w = new Worker(fileURLToPath(import.meta.url), { workerData: { paths: b.paths }, resourceLimits: { maxOldGenerationSizeMb: 4096 } });
            w.on('message', (m: { path: string; summary: AuditSummary | null }) => {
              results.set(m.path, m.summary);
              const s = byPath.get(m.path)!;
              cache.entries[m.path] = { size: s.size, mtime: s.mtime, summary: m.summary };
              done++;
              if (!json) process.stderr.write(`\r${dim(`Checking ${done}/${todo.length}…`)}`);
            });
            w.on('error', () => resolveP());
            w.on('exit', () => resolveP());
          }),
      ),
    );
    try {
      mkdirSync(dirname(CACHE), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(cache));
    } catch {
      /* caching is a convenience */
    }
  }

  const verdicts: Record<string, number> = { supported: 0, contradicted: 0, stale: 0, unverified: 0 };
  const rules: Record<string, number> = {};
  const caught: { session: SessionInfo; n: number }[] = [];
  let withClaims = 0;
  let risky = 0;
  let failed = 0;
  for (const s of list) {
    const r = results.get(s.path);
    if (!r) {
      failed++;
      continue;
    }
    const total = Object.values(r.verdicts).reduce((x, y) => x + y, 0);
    if (total) withClaims++;
    for (const [k, v] of Object.entries(r.verdicts)) verdicts[k] += v;
    if (r.contradicted) caught.push({ session: s, n: r.contradicted });
    if (r.high) risky++;
    for (const [k, v] of Object.entries(r.highRules)) rules[k] = (rules[k] ?? 0) + v;
  }
  const claims = Object.values(verdicts).reduce((x, y) => x + y, 0);
  const result = {
    sessions: list.length,
    claudeCode: list.filter((s) => s.agent === 'claude-code').length,
    codex: list.filter((s) => s.agent === 'codex').length,
    unreadable: failed,
    sessionsWithClaims: withClaims,
    claims,
    verdicts,
    sessionsWithContradictedClaim: caught.length,
    sessionsWithHighFinding: risky,
    highFindingsByRule: rules,
    // Stable keys only: no titles or prompts, so this output is safe to share.
    contradictedSessions: caught.map((c) => ({ key: c.session.key, agent: c.session.agent, contradicted: c.n })),
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    fromCache: list.length - todo.length,
  };
  if (json) return console.log(JSON.stringify(result, null, 2));
  process.stderr.write('\r' + ' '.repeat(30) + '\r');
  const pct = (x: number, d: number) => (d ? `${Math.round((x / d) * 100)}%` : '0%');
  console.log(`${bold(`Audited ${list.length} sessions`)} ${dim(`(${result.claudeCode} Claude Code, ${result.codex} Codex) in ${result.seconds}s${result.fromCache ? `, ${result.fromCache} from cache` : ''} · counts only, nothing leaves this machine`)}`);
  console.log(`  ${withClaims} ended with checkable claims ${dim('(tests pass, build passes, CI is green, fixed, only changed X…)')}, ${claims} claims in all`);
  console.log(`  ${red('✗')} ${bold(String(verdicts.contradicted))} contradicted by the agent's own log, in ${bold(String(caught.length))} sessions ${dim(`(${pct(caught.length, withClaims)} of sessions with claims)`)}`);
  console.log(`  ${yellow('~')} ${verdicts.stale} stale, ${verdicts.unverified} unproven   ${green('✓')} ${verdicts.supported} supported`);
  console.log(`  ${red('■')} ${risky} sessions with a high-severity finding`);
  const top = Object.entries(rules).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) console.log(dim(`    ${top.map(([r, n]) => `${RULE_INFO[r as keyof typeof RULE_INFO].name.toLowerCase()} ${n}`).join(' · ')}`));
  if (caught.length) {
    console.log(`\n${bold('Where the log disagrees')} ${dim('(stable keys; titles are left out so this is safe to paste)')}`);
    for (const c of caught.slice(0, 10)) console.log(`  ${cyan(c.session.key.padEnd(9))} ${dim(c.session.agent === 'codex' ? 'codex ' : 'claude')}  ${red(`${c.n}×`)} ${dim(ago(c.session.mtime))}`);
    console.log(dim(`\n  Open one: intent-replay open <key>`));
  }
  if (failed) console.log(dim(`  ${failed} sessions could not be read.`));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { flags } = args;
  if (flags.version) return console.log(VERSION);
  if (flags.help || args.cmd === 'help') return console.log(HELP);

  switch (args.cmd) {
    case 'picker':
      printList(!!flags.all);
      console.log('');
      return serve(flags);
    case 'list':
      return printList(!!flags.all);
    case 'open': {
      const t = resolveTarget(args.target, !!flags.all);
      printSummary(t.path);
      console.log('');
      return serve(flags, t);
    }
    case 'watch': {
      const t = resolveTarget(args.target ?? 'latest', !!flags.all);
      console.log(`${violet('●')} Following ${bold(t.label.slice(0, 70))}`);
      console.log(dim('  The replay updates as the agent works. Claims are checked the moment they are made.'));
      console.log('');
      return serve(flags, t, true);
    }
    case 'report': {
      const t = resolveTarget(args.target, !!flags.all);
      const { trace, analysis } = load(t.path);
      const body = flags.json ? JSON.stringify({ trace: { ...trace, steps: undefined }, analysis: { ...analysis, readBefore: undefined } }, null, 2) : toMarkdown(trace, analysis);
      if (typeof flags.out === 'string') {
        writeFileSync(flags.out, body);
        console.error(`${green('✓')} wrote ${flags.out}`);
      } else console.log(body);
      return;
    }
    case 'check': {
      const t = resolveTarget(args.target, !!flags.all);
      const level = String(flags['fail-on'] ?? 'high') as Severity;
      const rank: Record<string, number> = { high: 3, medium: 2, low: 1, info: 0 };
      if (!(level in rank)) fail('--fail-on must be high, medium or low');
      const { analysis } = load(t.path);
      printSummary(t.path);
      const blocking = analysis.findings.filter((f) => rank[f.severity] >= rank[level]);
      if (blocking.length) {
        console.log(`\n${red('✗')} ${blocking.length} finding${blocking.length === 1 ? '' : 's'} at or above "${level}".`);
        process.exit(1);
      }
      console.log(`\n${green('✓')} No findings at or above "${level}".`);
      return;
    }
    case 'audit':
      return audit(!!flags.json);
    case 'hook': {
      if (args.target === 'install') {
        const script = fileURLToPath(import.meta.url);
        const r = installHook(script, settingsPath(!!flags.project));
        console.log(r.changed ? `${green('✓')} Added the Stop hook to ${r.path}` : `${green('✓')} The Stop hook is already in ${r.path}`);
        console.log(dim(`  ${r.command}`));
        if (/[\\/]_npx[\\/]/.test(script)) console.log(yellow('! This copy runs from the npx cache, which can be cleared. Install it first: npm i -g github:Dakshhhhh-ops/intent, then run intent-replay hook install.'));
        console.log(dim('  From the next session on, a final message whose claims the log contradicts is sent back to the agent once.'));
        return;
      }
      if (process.stdin.isTTY) return console.log('Claude Code runs this as a Stop hook (it reads the hook input on stdin). To set it up: intent-replay hook install');
      return hookMain();
    }
    case 'export': {
      const t = resolveTarget(args.target, !!flags.all);
      const { trace } = load(t.path);
      const out = typeof flags.out === 'string' ? flags.out : `intent-replay-${trace.id.slice(0, 8)}.html`;
      const html = readFileSync(exportHtmlPath(), 'utf8');
      writeFileSync(out, injectBoot(html, { embedded: true }, traceTag(toIntentTrace(trace))));
      console.log(`${green('✓')} wrote ${out} ${dim('(self-contained, secrets masked)')}`);
      return;
    }
    default:
      console.log(HELP);
  }
}

// The same file also runs as the audit worker threads.
if (isMainThread) main().catch((e) => fail((e as Error).message));
else auditWorker();
