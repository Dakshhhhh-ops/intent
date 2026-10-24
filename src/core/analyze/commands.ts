import type { CommandCategory, CommandInfo } from '../types';

// Classifies shell commands so claims like "tests pass" can be checked against
// what actually ran. A command can belong to several categories
// (`npm run build && npm test` is both build and test).

const RULES: [CommandCategory, RegExp][] = [
  [
    'test',
    /\b(vitest|jest|mocha|ava|tap|pytest|py\.test|nose2?|rspec|phpunit|minitest|karma|cypress run|playwright test|deno test|bun test|ctest)\b|\bgo test\b|\bcargo (nextest|test)\b|\bdotnet test\b|\bmvn\b[^|;&]*\btest\b|\bgradlew?\b[^|;&]*\btest\b|\bnode\b[^|;&]*--test\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test(:\S+)?\b|\bnpm t\b|\bpython3?\s+-m\s+(unittest|pytest)\b|\bmake\s+(test|check)\b|\btox\b|\bnpx\s+(vitest|jest|playwright test)\b/i,
  ],
  [
    'typecheck',
    /\btsc\b|\bvue-tsc\b|\bmypy\b|\bpyright\b|\bbasedpyright\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(typecheck|type-check|check-types|tsc)\b|\bcargo check\b|\bflow check\b/i,
  ],
  [
    'build',
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\bvite build\b|\bnext build\b|\bwebpack\b|\brollup\b|\btsup\b|\besbuild\b|\bcargo build\b|\bgo build\b|\bmvn\b[^|;&]*\b(package|compile|install)\b|\bgradlew?\b[^|;&]*\b(build|assemble)\b|\bdotnet build\b|\bmake\b(?!\s+(test|check))|\bcmake --build\b|\bflutter build\b|\bpython3?\s+-m\s+build\b/i,
  ],
  [
    'lint',
    /\b(eslint|ruff|flake8|pylint|biome|stylelint|golangci-lint|clippy|rubocop|shellcheck|ktlint|swiftlint)\b|\bprettier\b[^|;&]*--check\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?lint\b|\bgo vet\b/i,
  ],
  [
    'install',
    /\b(npm|pnpm|bun)\s+(install|i|add|ci)\b|\byarn(\s+(add|install))?\s*($|&&|;)|\byarn add\b|\bpip3?\s+install\b|\buv\s+(add|pip install|sync)\b|\bpoetry (add|install)\b|\bcargo add\b|\bgo get\b|\bgem install\b|\bbundle install\b|\bcomposer (require|install)\b|\bdotnet add\b/i,
  ],
  ['git', /(^|[;&|]\s*)git\s+\w+/i],
  [
    'run',
    /\b(node|deno|bun|python3?|ruby|php|java|go run|cargo run|dotnet run)\b|\b(npm|pnpm|yarn)\s+(run\s+)?(dev|start|serve|preview)\b|\bcurl\b|\bInvoke-WebRequest\b/i,
  ],
  [
    'read',
    /^\s*(cat|head|tail|less|more|type|bat|nl|Get-Content|gc|sed\s+-n)\b/i,
  ],
  [
    'search',
    /^\s*(grep|rg|ag|ack|find|fd|ls|dir|tree|Get-ChildItem|gci|Select-String|wc|du|Test-Path|pwd|which|where|Get-Command)\b/i,
  ],
];

/**
 * The shell code of a command line, without heredoc bodies or commit messages. A Python script fed
 * through `<<EOF` or a commit message that mentions "pytest" is not a command that ran.
 */
export function shellCode(cmd: string): string {
  return cmd
    .replace(/<<-?\s*(['"]?)([\w.-]+)\1([^\n]*)\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, (_m, _q, _tag, rest: string) => `<<HEREDOC${rest}`)
    .replace(/(\s-[mF]\s*|\s--message[= ])("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1""')
    // Inline scripts (node -e "…", python -c "…") are code, not commands: a script that mentions
    // "test" or crashes is not a test run.
    .replace(/(\b(?:node|deno|bun|python3?|py|ruby|perl|php)(?:\.exe)?(?:\s+-{1,2}[\w-]+(?:=\S+)?)*?\s+(?:-e|-c|-p|--eval|--print))\s+("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1 ""');
}

export function classifyCommand(cmd: string): CommandCategory[] {
  const c = shellCode(cmd).trim();
  const cats: CommandCategory[] = [];
  for (const [cat, re] of RULES) {
    if (re.test(c)) cats.push(cat);
  }
  // A bare `cat x | grep` is a read, not "run". Remove run if it's only read/search.
  if (cats.includes('run') && (cats.includes('read') || cats.includes('search')) && !/\b(node|python3?|npm|pnpm|yarn|bun|deno|go run|cargo run)\b/i.test(c)) {
    cats.splice(cats.indexOf('run'), 1);
  }
  if (cats.length === 0) cats.push('other');
  return cats;
}

export const VERIFY_CATEGORIES: CommandCategory[] = ['test', 'typecheck', 'build', 'lint'];

export function isVerify(cats: CommandCategory[]): boolean {
  return cats.some((c) => VERIFY_CATEGORIES.includes(c));
}

const FAIL_PATTERNS: RegExp[] = [
  /\b([1-9]\d*)\s+(failed|failing|failures?|errors?)\b/i,
  /^\s*FAIL\b/m,
  /\bTests?:\s+[^\n]*\b[1-9]\d*\s+failed/i,
  /\b(npm ERR!|ERR_PNPM_|error TS\d+|SyntaxError|AssertionError|ERR_ASSERTION|Traceback \(most recent call last\))/,
  /^FAILED\b/m,
  /\btest result: FAILED\b/,
  /\bBuild failed\b/i,
  /^\s*[✗×✖]\s/m,
  /^\s*(#|ℹ)\s*fail\s+[1-9]/m,
];

const PASS_ZERO = /\b0\s+(failed|failing|failures|errors)\b/gi;

/** ESLint's summary when there are only warnings: "✖ 12 problems (0 errors, 12 warnings)". */
const WARNINGS_ONLY = /^.*\b\d+\s+problems?\s+\(0 errors?,.*$/gim;

/** "tests 6 … pass 4" (node:test / TAP) — fewer passes than tests means something failed or was hidden. */
function countsShowFailure(output: string): boolean {
  const total = output.match(/^\s*(?:#|ℹ)\s*tests\s+(\d+)/m);
  const pass = output.match(/^\s*(?:#|ℹ)\s*pass\s+(\d+)/m);
  const skipped = output.match(/^\s*(?:#|ℹ)\s*(?:skipped|todo)\s+(\d+)/gm);
  if (!total || !pass) return false;
  const skip = (skipped ?? []).reduce((n, l) => n + Number(l.match(/(\d+)/)![1]), 0);
  return Number(pass[1]) + skip < Number(total[1]);
}

/** True when a command's output clearly reports failure even if the exit code was masked. */
export function outputLooksFailed(output: string): boolean {
  if (!output) return false;
  const cleaned = output.replace(WARNINGS_ONLY, '').replace(PASS_ZERO, '');
  return FAIL_PATTERNS.some((re) => re.test(cleaned)) || countsShowFailure(output);
}

/** What kind of check each failure line in an output belongs to. Generic errors (npm ERR!) belong to none. */
const FAILURE_KINDS: [CommandCategory, RegExp][] = [
  ['test', /^\s*FAIL\b|^FAILED\b|\b[1-9]\d*\s+(failed|failing)\b|AssertionError|ERR_ASSERTION|^\s*(#|ℹ)\s*fail\s+[1-9]|\btest result: FAILED|^\s*[✗×]\s|^not ok\b|\bTests?:\s+[^\n]*\b[1-9]\d*\s+failed/im],
  ['typecheck', /\berror TS\d+|:\s*error:.*\[[\w-]+\]\s*$|\bFound [1-9]\d* errors? in \d+ files?|\b[1-9]\d* errors?, \d+ warnings?, \d+ (informations|notes)/im],
  ['lint', /\b\d+ problems? \([1-9]\d* errors?|\bFound [1-9]\d* errors?\.|\b[1-9]\d* errors? \(\d+ fixable/im],
  ['build', /\bBuild failed\b|\berror during build\b|\bfailed to compile\b|\bCould not resolve\b|^ERROR in\b/im],
];

/** The kinds of check an output shows failing. Empty when the failure can't be placed. */
export function failureKinds(output: string): Set<CommandCategory> {
  const cleaned = output.replace(WARNINGS_ONLY, '').replace(PASS_ZERO, '');
  const out = new Set<CommandCategory>();
  for (const [cat, re] of FAILURE_KINDS) if (re.test(cleaned)) out.add(cat);
  return out;
}

/**
 * Did this command fail as a check of this kind? `npm test && npx tsc` run as one command reports one
 * exit code; when its output shows only test failures, the type check part did not fail.
 */
export function failedAs(c: CommandInfo, cat: CommandCategory): boolean {
  if (!c.failed && !outputLooksFailed(c.output)) return false;
  // Exit 0 with failure words somewhere: the test runner's own final summary decides.
  if (cat === 'test' && !c.failed) {
    const summary = testSummary(c.output);
    if (summary) return summary === 'fail';
  }
  const verifyCats = c.categories.filter((x) => VERIFY_CATEGORIES.includes(x));
  if (verifyCats.length <= 1) return true;
  const kinds = failureKinds(c.output);
  if (!kinds.size) return true;
  // tsc errors fail a build only when no separate type check ran in the same command.
  return kinds.has(cat) || (cat === 'build' && kinds.has('typecheck') && !c.categories.includes('typecheck'));
}

/** The last summary line a test runner printed, read as pass or fail. Null when there is none. */
export function testSummary(output: string): 'pass' | 'fail' | null {
  let verdict: 'pass' | 'fail' | null = null;
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^Ran \d+ tests? in /.test(l)) {
      const next = lines.slice(i + 1).find((x) => x.trim())?.trim() ?? '';
      if (/^OK\b/.test(next)) verdict = 'pass';
      else if (/^FAILED\b/.test(next)) verdict = 'fail';
    } else if (/^=*\s*(?:\d+ \w+, )*\d+ (passed|failed|errors?)\b.* in [\d.]+s\b/.test(l)) {
      verdict = /\b[1-9]\d* (failed|errors?)\b/.test(l) ? 'fail' : 'pass'; // pytest
    } else if (/^Tests:?\s+.*\b\d+ (passed|failed)\b/.test(l)) {
      verdict = /\b[1-9]\d* failed\b/.test(l) ? 'fail' : 'pass'; // vitest, jest
    } else if (/^ℹ fail \d+$/.test(l) || /^# fail \d+$/.test(l)) {
      verdict = /\s0$/.test(l) ? 'pass' : 'fail'; // node:test, TAP
    } else if (/^[1-9]\d* failed\b/.test(l)) {
      verdict = 'fail'; // playwright
    } else if (/^\d+ passed \([\d.]+m?s\)$/.test(l)) {
      verdict ??= 'pass';
    } else if (/^test result: (ok|FAILED)\./.test(l)) {
      verdict = l.includes('FAILED') ? 'fail' : 'pass'; // cargo
    } else if (/^\d+ passing\b/.test(l)) {
      verdict ??= 'pass'; // mocha
    } else if (/^[1-9]\d* failing\b/.test(l)) {
      verdict = 'fail';
    }
  }
  return verdict;
}

/** The shell could not even parse the command, so nothing in it ran. */
export function shellBroke(c: CommandInfo): boolean {
  return /^(?:\/\S+\/)?(?:ba|z)?sh: .*(?:unexpected EOF while looking for matching|syntax error near unexpected token|syntax error: unexpected end of file)/m.test(c.output);
}

/** A test command that only runs some tests (name filter, .only, a single file). */
export function partialTestFilter(cmd: string): string | null {
  const name = cmd.match(/--test-name-pattern[= ]["']?([^"'\s]+(?:\s[^"'-][^"']*)?)["']?|--testNamePattern[= ]["']?([^"']+)["']?|\s-t\s+["']([^"']+)["']|\s--grep\s+["']?([^"'\s]+)|\s-k\s+["']?([^"'\s]+)|::(\w+)/);
  if (name) return `tests matching “${(name.slice(1).find(Boolean) ?? '').trim().replace(/\\(.)/g, '$1')}”`;
  if (/--test-only\b|\.only\b/.test(cmd)) return 'tests marked .only';
  const file = cmd.match(/\b(?:vitest(?:\s+run)?|jest|pytest|node\s+--test|mocha|go\s+test)\s+(?:-[\w-]+\s+)*([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?|[\w./-]*test_\w+\.py|[\w./-]+_test\.go|[\w./-]+\.test\.\w+)\b/);
  if (file) return `only ${file[1]}`;
  return null;
}

const SCRATCH_DIR = /scratch|\/(?:Temp|tmp)\/|^\/tmp\b|^\$\{?(?:TMPDIR|TEMP|TMP)\b|\$env:(?:TEMP|TMP)\b/i;

/**
 * The command moves into a scratch or temp folder before it runs, so it checks a throwaway copy,
 * not the project. Simple `X=...` variables are filled in; the last `cd` wins.
 */
export function runsInScratch(cmd: string): boolean {
  const code = shellCode(cmd);
  const vars = new Map<string, string>();
  for (const m of code.matchAll(/(?:^|[\s;&(])\$?([A-Za-z_]\w*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g)) vars.set(m[1], m[2] ?? m[3] ?? m[4] ?? '');
  const expand = (t: string) => t.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (all, v: string) => vars.get(v) ?? all);
  let last: string | null = null;
  for (const m of code.matchAll(/(?:^|[;&|(]\s*)(?:cd|Set-Location|pushd)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/gi)) last = expand(m[1] ?? m[2] ?? m[3]);
  return last !== null && SCRATCH_DIR.test(last.replace(/\\/g, '/'));
}

/** A command that looks at a CI run (GitHub Actions through gh, or act running a workflow locally). */
export function looksAtCi(cmd: string): boolean {
  return /\bgh\s+(?:run|workflow|pr\s+checks)\b|\bact\s+(?:-|push|pull_request)|api\.github\.com\/repos\/\S+\/actions/i.test(cmd);
}

/**
 * The exit code belongs to the checks: no pipe hides it, and no later command after a `;`
 * replaces it (`pytest; git status` exits with git's code, not pytest's).
 */
export function exitReflectsChecks(cmd: string): boolean {
  if (masksExitCode(cmd)) return false;
  const segs = shellCode(cmd)
    .split(/;|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length <= 1) return true;
  return isVerify(classifyCommand(segs[segs.length - 1]));
}

/** Exit code was hidden by a pipe or `|| true`. */
export function masksExitCode(cmd: string): boolean {
  cmd = shellCode(cmd);
  return /\|\s*(head|tail|grep|tee|Select-Object|select|more|less|sort|wc)\b|\|\|\s*(true|exit 0|:)\b|;\s*exit\s+0\b|2>\s*\/dev\/null\s*\|/i.test(cmd);
}

function tokens(seg: string): string[] {
  const out: string[] = [];
  for (const m of seg.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const looksLikePath = (t: string) => /[\w-]\.[\w]{1,8}$|\//.test(t) && !/[*?{}$<>]/.test(t) && !/^https?:/.test(t);

function segmentReadTargets(seg: string): string[] {
  const tk = tokens(seg.trim());
  if (!tk.length) return [];
  const cmd = tk[0].toLowerCase();
  const args = tk.slice(1);
  if (['cat', 'head', 'tail', 'less', 'more', 'type', 'bat', 'nl'].includes(cmd)) {
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith('-')) {
        if (/^-[nc]$/.test(a)) i++;
        continue;
      }
      if (/^\d+$/.test(a)) continue;
      if (looksLikePath(a)) files.push(a);
    }
    return files;
  }
  if (cmd === 'get-content' || cmd === 'gc') {
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (/^-(Path|LiteralPath)$/i.test(a)) continue;
      if (a.startsWith('-')) {
        if (!/^-(Raw|Wait)$/i.test(a)) i++;
        continue;
      }
      for (const part of a.split(',')) if (looksLikePath(part)) files.push(part);
    }
    return files;
  }
  if (cmd === 'sed' && args.includes('-n')) {
    const rest = args.filter((a) => a !== '-n' && !a.startsWith('-'));
    return rest.slice(1).filter(looksLikePath);
  }
  if (cmd === 'grep' || cmd === 'rg' || cmd === 'select-string') {
    // A search in explicit files shows their content too (partially).
    const rest = args.filter((a) => !a.startsWith('-'));
    return rest.slice(1).filter((a) => looksLikePath(a) && /\.[\w]{1,8}$/.test(a));
  }
  return [];
}

/** Files a shell command reads, including inside `cd x && sed -n 1,40p a.py; cat b.py c.py`. */
export function shellReadTargets(cmd: string): string[] {
  const out: string[] = [];
  for (const seg of cmd.split(/&&|\|\||;|\n/)) {
    const first = seg.split(/(?<![|])\|(?![|])/)[0];
    for (const t of segmentReadTargets(first)) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Files a shell command writes with redirects, tee, Set-Content, sed -i… (contents unknown). */
export function shellWriteTargets(cmd: string): string[] {
  const out = new Set<string>();
  for (const m of cmd.matchAll(/(?:^|[^>&\d-])>{1,2}\s*["']?([^\s"'|;&<>()]+)["']?/g)) {
    const p = m[1];
    if (!/^\/dev\/|^nul$|^&|^\$null$/i.test(p) && looksLikePath(p)) out.add(p);
  }
  for (const m of cmd.matchAll(/\btee\s+(?:-a\s+)?["']?([^\s"'|;&<>]+)/g)) if (looksLikePath(m[1])) out.add(m[1]);
  for (const m of cmd.matchAll(/\b(?:Set-Content|Out-File|Add-Content)\s+(?:-(?:Path|FilePath|LiteralPath)\s+)?["']?([^\s"'|;&<>]+)/gi)) if (looksLikePath(m[1])) out.add(m[1]);
  for (const m of cmd.matchAll(/\bsed\s+-i(?:\s*\S*)?\s+(?:-e\s+)?(?:"[^"]*"|'[^']*')\s+["']?([^\s"'|;&<>]+)/g)) if (looksLikePath(m[1])) out.add(m[1]);
  return [...out];
}

/** Extracts the first file a read-like shell command reads, if obvious. */
export function shellReadTarget(cmd: string): string | null {
  return shellReadTargets(cmd)[0] ?? null;
}

/** First line of output that explains a failure — used in claim explanations. */
export function failureHeadline(output: string): string | null {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hit =
    lines.find((l) => /\b(AssertionError|Expected|expected|FAIL|✗|×|Error:|error TS\d+|failed|Traceback)/.test(l) && l.length < 240) ??
    lines.find((l) => l.length < 240);
  return hit ?? null;
}
