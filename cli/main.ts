import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { analyze, RULE_INFO } from '../src/core/analyze';
import { parseTrace } from '../src/core/parse/detect';
import { toIntentTrace } from '../src/core/parse/intentTrace';
import { formatDuration, toMarkdown } from '../src/core/report/markdown';
import type { Severity } from '../src/core/types';
import { injectBoot, startServer, viewerHtmlPath } from './server';
import { inside, listSessions, type SessionInfo } from './sessions';

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
  intent-replay report <target>      print a PR-ready Markdown report   [--out file] [--json]
  intent-replay check <target>       exit 1 if findings at/above a level [--fail-on high|medium|low]
  intent-replay export <target>      write a self-contained HTML replay  [-o replay.html]

${bold('Target')}  a number from ${cyan('list')}, ${cyan('latest')}, or a path to a .jsonl / .json file

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
  const known = ['list', 'open', 'report', 'check', 'export', 'help'];
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
  const hit = list.find((s) => s.id === target);
  if (!hit) fail(`No session "${target}". Run ${cyan('intent-replay list')} to see numbers.`);
  return { path: hit!.path, label: hit!.title };
}

function fail(msg: string): never {
  console.error(red('✗ ') + msg);
  process.exit(2);
}

function load(path: string) {
  const text = readFileSync(path, 'utf8');
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
    console.log(`${dim(s.id.padStart(3))}  ${agent}  ${dim(ago(s.mtime).padEnd(9))} ${s.title.slice(0, 80)}`);
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

async function serve(flags: Args['flags'], initial?: { path: string }) {
  const all = !!flags.all;
  const { url } = await startServer({
    sessions: () => scoped(all).list,
    initial: initial ? { id: 'file', path: initial.path } : undefined,
    port: Number(flags.port ?? 4848),
    cwd: process.cwd(),
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
    case 'export': {
      const t = resolveTarget(args.target, !!flags.all);
      const { trace } = load(t.path);
      const out = typeof flags.out === 'string' ? flags.out : `intent-replay-${trace.id.slice(0, 8)}.html`;
      const html = readFileSync(viewerHtmlPath(), 'utf8');
      const json = toIntentTrace(trace).replace(/</g, '\\u003c');
      writeFileSync(out, injectBoot(html, { embedded: true }, `<script id="intent-trace" type="application/json">${json}</script>`));
      console.log(`${green('✓')} wrote ${out} ${dim('(self-contained, secrets masked)')}`);
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => fail((e as Error).message));
