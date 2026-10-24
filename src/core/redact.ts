// Masks credentials before anything is shown or exported.
// Masked values become «secret:kind» so the secret-exposure rule can still see them.

interface Pattern {
  kind: string;
  re: RegExp;
  /** Group index holding the secret value (0 = whole match). Groups before it are kept as a prefix, the one after as a suffix. */
  group?: number;
}

// Key names that hold credentials, used by the "key: value" patterns below.
const KEY = String.raw`(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|private[_-]?key|connection[_-]?string)`;

const PATTERNS: Pattern[] = [
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'huggingface-token', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { kind: 'sendgrid-key', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { kind: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Authorization: Bearer <token> / Basic <base64>
  { kind: 'bearer-token', re: /(\b(?:Bearer|Basic|Token)\s+)([A-Za-z0-9._~+\/-]{16,}=*)/g, group: 2 },
  // scheme://user:password@host
  { kind: 'url-password', re: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:\/@"'`]+:)([^\s@\/"'`]{3,})(@)/gi, group: 2 },
  // Azure storage / service bus connection strings
  { kind: 'azure-key', re: /(\b(?:AccountKey|SharedAccessKey|sig)=)([A-Za-z0-9+\/%=]{20,})/g, group: 2 },
  // NAME_KEY=…, NAME_TOKEN=…, NAME_SECRET=…, NAME_PASSWORD=… (env files, shell exports)
  // The value starts right after "=": "LLM_API_KEY= python …" is an empty assignment, not a key.
  { kind: 'env-secret', re: /(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Z0-9_]*=["']?)([^\s"'`]{8,})/g, group: 2 },
  // password: hunter2, "password": "correct-horse", api_key = '…' (YAML, JSON, config files)
  { kind: 'password', re: new RegExp(String.raw`(?<![«\w-])(["']?${KEY}["']?\s*[:=]\s*["']?)([^\s"'\x60,;}{)\]]{6,})`, 'gi'), group: 2 },
];

/** Values that are code or placeholders, not credentials ("token: string", "\${TOKEN}", "password: input.value"). */
function placeholder(value: string): boolean {
  return (
    value.startsWith('«secret') ||
    value.startsWith('«masked') ||
    /^\$\{?\w+\}?$/.test(value) ||
    /^process\.env/.test(value) ||
    /\(|^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$.]*$/.test(value) ||
    /^(?:string|number|boolean|null|undefined|true|false|none|any|object|unknown|required|optional|redacted|masked|example\w*|your[_-]?\w*|changeme|placeholder|<[^>]*>|\*+|x+|\.{3,}|•+)$/i.test(value)
  );
}

/**
 * Does a masked value look like a real credential? Everything is masked either way; only real-looking
 * values become «secret:…» (and a finding). Placeholders ("your-key-here", "xxxx", "example"), values
 * made of a few repeated characters, short plain words, and local dev database passwords become «masked:…».
 */
function looksReal(value: string, kind: string, after: string): boolean {
  if (kind === 'private-key') return true;
  const v = value.replace(/^(?:sk-(?:proj-|ant-(?:api\d+-)?)?|gh[pousr]_|github_pat_|glpat-|npm_|hf_|xox[abprs]-|SG\.|AKIA|ASIA|AIza|(?:sk|rk)_(?:live|test)_)/, '');
  if (v.length < 8) return false;
  if (new Set(v.replace(/[^A-Za-z0-9]/g, '')).size < Math.min(8, Math.ceil(v.length / 3))) return false;
  if (/(.)\1{4,}/.test(v)) return false;
  if (/your|example|sample|dummy|fake|changeme|placeholder|redacted|xxx|here|todo|replace|insert|(?:^|[-_.])test(?:$|[-_.])/i.test(v)) return false;
  if (kind === 'url-password' && (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])\b/.test(after) || /^(?:postgres|password|admin|root|secret|dev|test|mysql|guest|pass)$/i.test(v))) return false;
  return true;
}

export const SECRET_MARK = /«secret:([a-z-]+)»/g;
const KNOWN_KINDS = new Set(PATTERNS.map((p) => p.kind));

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    // The arguments after the groups are the match offset and the whole string.
    const mark = (value: string, args: unknown[]) => {
      const offset = args[args.length - 2] as number;
      const whole = args[args.length - 1] as string;
      const after = whole.slice(offset + String(args[0]).length);
      return looksReal(value, p.kind, after) ? `«secret:${p.kind}»` : `«masked:${p.kind}»`;
    };
    if (p.group) {
      out = out.replace(p.re, (...m: unknown[]) => {
        const prefix = (m[1] as string) ?? '';
        const value = (m[2] as string) ?? '';
        const suffix = typeof m[3] === 'string' ? m[3] : '';
        return placeholder(value) ? (m[0] as string) : `${prefix}${mark(value, m)}${suffix}`;
      });
    } else {
      out = out.replace(p.re, (...m: unknown[]) => mark(m[0] as string, m));
    }
  }
  return out;
}

export function secretKinds(text: string | undefined): string[] {
  if (!text) return [];
  const kinds = new Set<string>();
  // Only kinds this module produces: text that merely mentions the marker format doesn't count.
  for (const m of text.matchAll(SECRET_MARK)) if (KNOWN_KINDS.has(m[1])) kinds.add(m[1]);
  return [...kinds];
}
