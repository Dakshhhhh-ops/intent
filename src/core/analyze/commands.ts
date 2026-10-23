import type { CommandCategory } from '../types';

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

export function classifyCommand(cmd: string): CommandCategory[] {
  const c = cmd.trim();
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
  /\b(npm ERR!|ERR_PNPM_|error TS\d+|SyntaxError|AssertionError|Traceback \(most recent call last\))/,
  /^FAILED\b/m,
  /\btest result: FAILED\b/,
  /\bBuild failed\b/i,
  /^\s*✗|^\s*×\s/m,
  /# fail\s+[1-9]/,
];

const PASS_ZERO = /\b0\s+(failed|failing|failures|errors)\b/gi;

/** True when a command's output clearly reports failure even if the exit code was masked. */
export function outputLooksFailed(output: string): boolean {
  if (!output) return false;
  const cleaned = output.replace(PASS_ZERO, '');
  return FAIL_PATTERNS.some((re) => re.test(cleaned));
}

/** Exit code was hidden by a pipe or `|| true`. */
export function masksExitCode(cmd: string): boolean {
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
