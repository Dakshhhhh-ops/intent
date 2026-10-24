// Small helpers shared by parsers and analyzer. No DOM or Node APIs here.

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Make `p` relative to `cwd` when it lives inside it. Handles Windows drive-letter case. */
export function relPath(p: string, cwd?: string): string {
  if (!p) return p;
  let path = toPosix(shortenScratch(p.trim()));
  if (path.startsWith('file:///')) path = path.slice(8);
  if (!cwd) return path;
  let base = toPosix(cwd);
  if (base.startsWith('file:///')) base = base.slice(8);
  base = base.replace(/\/+$/, '');
  const winLike = /^[a-zA-Z]:\//.test(base) || /^[a-zA-Z]:\//.test(path);
  const a = winLike ? path.toLowerCase() : path;
  const b = winLike ? base.toLowerCase() : base;
  if (a === b) return '.';
  if (a.startsWith(b + '/')) return path.slice(base.length + 1);
  // Git-bash style /c/Users/... vs C:/Users/...
  const gb = base.replace(/^([a-zA-Z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
  if (path.toLowerCase().startsWith(gb.toLowerCase() + '/')) return path.slice(gb.length + 1);
  if (!/^([a-zA-Z]:)?\//.test(path)) return path.replace(/^\.\//, '');
  return path;
}

/** Claude Code's per-session scratch folder: …/Temp/claude/<project>/<session id>/scratchpad. */
const SCRATCH_ROOT = /(?:[A-Za-z]:)?[^\s"'`]*?[\\/](?:Temp|tmp)[\\/]claude[^\\/\s"'`]*[\\/][^\\/\s"'`]+[\\/][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\\/]scratchpad(?=[\\/\s"'`]|$)/gi;

/** Long scratch paths read as $SCRATCH, so file lists and commands stay readable. */
export function shortenScratch(s: string): string {
  return s.includes('scratchpad') ? s.replace(SCRATCH_ROOT, '$SCRATCH') : s;
}

/**
 * Outside the project: the parsers make project files relative, so anything absolute, under the
 * home folder (`~/…`, as shared samples spell it) or in the scratch folder is not the code under review.
 */
export function outsideProject(p: string): boolean {
  return /^([a-zA-Z]:)?[\\/]|^~[\\/]|^\$SCRATCH\b/.test(p);
}

export function basename(p: string): string {
  const parts = toPosix(p).split('/');
  return parts[parts.length - 1] || p;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function countLines(text: string | undefined): number {
  return text ? splitLines(text).length : 0;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function parseTime(v: unknown): number | null {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

const TEST_FILE =
  /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb|ts|js)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs)$|_spec\.rb$/i;

export function isTestFile(p: string): boolean {
  return TEST_FILE.test(toPosix(p));
}

const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$/i;
export function isDocFile(p: string): boolean {
  return DOC_FILE.test(p);
}

/** Count unified-diff +/- lines (ignores headers). */
export function countPatch(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of splitLines(patch)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
