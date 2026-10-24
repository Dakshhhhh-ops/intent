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
  { kind: 'env-secret', re: /(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Z0-9_]*\s*=\s*["']?)([^\s"'`]{8,})/g, group: 2 },
  // password: hunter2, "password": "correct-horse", api_key = '…' (YAML, JSON, config files)
  { kind: 'password', re: new RegExp(String.raw`(?<![«\w-])(["']?${KEY}["']?\s*[:=]\s*["']?)([^\s"'\x60,;}{)\]]{6,})`, 'gi'), group: 2 },
];

/** Values that are code or placeholders, not credentials ("token: string", "\${TOKEN}", "password: input.value"). */
function placeholder(value: string): boolean {
  return (
    value.startsWith('«secret') ||
    /^\$\{?\w+\}?$/.test(value) ||
    /^process\.env/.test(value) ||
    /\(|^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$.]*$/.test(value) ||
    /^(?:string|number|boolean|null|undefined|true|false|none|any|object|unknown|required|optional|redacted|masked|example\w*|your[_-]?\w*|changeme|placeholder|<[^>]*>|\*+|x+|\.{3,}|•+)$/i.test(value)
  );
}

export const SECRET_MARK = /«secret:([a-z-]+)»/g;

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    if (p.group) {
      out = out.replace(p.re, (...m: string[]) => {
        const prefix = m[1] ?? '';
        const value = m[2] ?? '';
        const suffix = typeof m[3] === 'string' ? m[3] : '';
        return placeholder(value) ? m[0] : `${prefix}«secret:${p.kind}»${suffix}`;
      });
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
