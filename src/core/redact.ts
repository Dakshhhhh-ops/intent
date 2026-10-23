// Masks credentials before anything is shown or exported.
// Masked values become «secret:kind» so the secret-exposure rule can still see them.

interface Pattern {
  kind: string;
  re: RegExp;
  /** Group index holding the secret value (0 = whole match). */
  group?: number;
}

const PATTERNS: Pattern[] = [
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    kind: 'password',
    re: /(?<![«\w])((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?)([^\s"'`,;]{8,})/gi,
    group: 2,
  },
];

export const SECRET_MARK = /«secret:([a-z-]+)»/g;

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    if (p.group) {
      out = out.replace(p.re, (_m, prefix: string, value: string) =>
        value.startsWith('«secret') || /^\$\{?\w+\}?$/.test(value) || /^process\.env/.test(value)
          ? `${prefix}${value}`
          : `${prefix}«secret:${p.kind}»`,
      );
    } else {
      out = out.replace(p.re, `«secret:${p.kind}»`);
    }
  }
  return out;
}

export function secretKinds(text: string | undefined): string[] {
  if (!text) return [];
  const kinds = new Set<string>();
  for (const m of text.matchAll(SECRET_MARK)) kinds.add(m[1]);
  return [...kinds];
}
