// Turns a real agent session log into a shareable sample: parses it with the same core
// the app uses, rewrites the machine-specific project path, and refuses to write the file
// if anything personal (home directory, user name, e-mail) is left.
//
//   npm run import-run -- <session.jsonl> <out-name> --root <project dir> --as /home/dev/<name> [--label "Recorded run"]
//     [--allow "PublicHandle,Name"]  names that are already public, such as a GitHub handle or git author
//     [--steps 187-295]  keep only that part of the run
//     [--drop-files docs/a.md,docs/b.md]  leave out steps that only touch these files
//     [--title "Short title"]
//     [--redact-lines "regex"]  replace matching lines with a visible "[line removed]" marker

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { parseTrace } from '../src/core/parse/detect';
import { toIntentTrace } from '../src/core/parse/intentTrace';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [src, outName] = args;
const root = flag('root');
const alias = flag('as') ?? '/home/dev/project';
const label = flag('label') ?? 'Recorded run';
const description = flag('description');
// Names that are already public (a GitHub handle, the git author on public commits). Anything else personal still blocks.
const allow = (flag('allow') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
if (!src || !outName || !root) {
  console.error('usage: import-run <session.jsonl> <out-name> --root <dir> --as <alias> [--label ..] [--description ..]');
  process.exit(2);
}

const variants = (p: string) => {
  const fwd = p.replace(/\\/g, '/');
  const back = p.replace(/\//g, '\\');
  // Git Bash spells C:\Users\you as /c/Users/you.
  const msys = '/' + fwd.replace(/^([A-Za-z]):/, (_m, d: string) => d.toLowerCase());
  const out = new Set([p, fwd, back, '/' + fwd, 'file:///' + fwd, msys]);
  for (const v of [...out]) {
    out.add(v.replace(/^([A-Za-z]):/, (_m, d: string) => `${d.toLowerCase()}:`));
    out.add(v.replace(/^([A-Za-z]):/, (_m, d: string) => `${d.toUpperCase()}:`));
  }
  return [...out].sort((a, b) => b.length - a.length);
};
const rootVariants = variants(root);
const homeVariants = variants(homedir());

function clean(s: string): string {
  let out = s;
  for (const v of rootVariants) out = out.split(v).join(alias);
  for (const v of homeVariants) out = out.split(v).join('~');
  return out;
}

function walk<T>(v: T): T {
  if (typeof v === 'string') return clean(v) as T;
  if (Array.isArray(v)) return v.map(walk) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) as T;
  return v;
}

// Clean the raw log first (titles get truncated later, which would hide a partial path),
// including the JSON-escaped form of Windows paths.
let raw = readFileSync(src, 'utf8');
const jsonEscaped = (v: string) => v.replace(/\\/g, '\\\\');
for (const v of rootVariants) raw = raw.split(jsonEscaped(v)).join(alias).split(v).join(alias);
for (const v of homeVariants) raw = raw.split(jsonEscaped(v)).join('~').split(v).join('~');
// Claude Code names per-project folders after the path with separators turned into dashes
// (C:\Users\you\app -> c--Users-you-app), and scratch paths carry that name.
const dashed = homedir().replace(/[\\/:]/g, '-');
for (const v of new Set([dashed, dashed.toLowerCase(), dashed.charAt(0).toUpperCase() + dashed.slice(1), dashed.charAt(0).toLowerCase() + dashed.slice(1)])) raw = raw.split(v).join('home');
const trace = walk(parseTrace(raw, src));
// --steps 187-295 keeps only that part of the run (1-based, inclusive), renumbered from the start.
const range = flag('steps')?.match(/^(\d+)-(\d+)$/);
// --drop-files a.md,b.md leaves out every step that only touches those files (say, drafts you won't publish).
const drop = (flag('drop-files') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
if (range || drop.length) {
  const [from, to] = range ? [Number(range[1]), Number(range[2])] : [1, trace.steps.length];
  const touchesOnlyDropped = (files: string[]) => files.length > 0 && files.every((f) => drop.some((d) => f === d || f.endsWith('/' + d)));
  trace.steps = trace.steps
    .slice(from - 1, to)
    .filter((s) => !touchesOnlyDropped(s.files))
    .map((s, i) => ({ ...s, id: i }));
  const times = trace.steps.map((s) => s.t).filter((t): t is number => t !== null);
  trace.startedAt = times.length ? times[0] : undefined;
  trace.endedAt = times.length ? times[times.length - 1] : undefined;
}
trace.cwd = alias;
trace.label = label;
if (description) trace.description = description;
// --redact-lines "regex" replaces every line that matches with a visible marker, so readers know
// something was taken out (for example notes about a separate document you won't publish).
const redactLines = flag('redact-lines');
if (redactLines) {
  const re = new RegExp(redactLines, 'i');
  const marker = '[line removed: about a separate submission draft]';
  const scrub = <T>(v: T): T => {
    if (typeof v === 'string') return (re.test(v) ? v.split('\n').map((l) => (re.test(l) ? marker : l)).join('\n') : v) as T;
    if (Array.isArray(v)) return v.map(scrub) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) as T;
    return v;
  };
  trace.steps = trace.steps.map(scrub);
}
const title = flag('title');
if (title) trace.title = title;
trace.id = `${outName}`;
const json = toIntentTrace(trace);

const user = userInfo().username;
let checked = json;
for (const a of allow) checked = checked.split(a).join('');
const leaks = [user, homedir(), homedir().replace(/\\/g, '/'), '@gmail.com', 'nith.ac.in'].filter((x) => x && checked.toLowerCase().includes(x.toLowerCase()));
if (leaks.length) {
  for (const l of leaks) {
    const i = checked.toLowerCase().indexOf(l.toLowerCase());
    console.error('…' + checked.slice(Math.max(0, i - 120), i + 60) + '…');
  }
  console.error(`refusing to write: personal data still present (${leaks.join(', ')})`);
  process.exit(1);
}
const out = join(process.cwd(), 'examples', `${outName}.intent.json`);
writeFileSync(out, json + '\n');
console.log(`wrote ${out} (${trace.steps.length} steps)`);
