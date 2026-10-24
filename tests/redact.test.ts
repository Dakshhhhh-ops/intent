import { describe, it, expect } from 'vitest';
import { redact, secretKinds } from '../src/core/redact';

describe('redact', () => {
  it.each([
    ['AKIAIOSFODNN7EXAMPLE'],
    ['ghp_' + 'a'.repeat(36)],
    ['sk-ant-api03-' + 'b'.repeat(30)],
    ['sk-proj-' + 'c'.repeat(30)],
    ['xoxb-1234567890-abcdef'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ])('masks %s', (secret) => {
    const out = redact(`token is ${secret} ok`);
    expect(out).not.toContain(secret);
    // Hidden either way; repeated-character and EXAMPLE values are marked as placeholders.
    expect(out).toMatch(/^token is «(?:secret|masked):.+» ok$/);
  });

  it('masks a whole private key block', () => {
    const out = redact('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----');
    expect(out).not.toContain('MIIabc');
    expect(out).not.toContain('BEGIN');
  });

  it('keeps the kind for short kind names (jwt)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(secretKinds(redact(jwt))).toEqual(['jwt']);
  });

  it('masks password-like assignments but keeps the key name', () => {
    expect(redact('password=hunter2hunter2')).toBe('password=«secret:password»');
    expect(redact('API_KEY: "abcdefgh12345"')).toBe('API_KEY: "«secret:password»"');
  });

  it('leaves env-var references, short values and plain text alone', () => {
    for (const s of ['password=${DB_PASSWORD}', 'apiKey: process.env.API_KEY', 'password=short', 'nothing to see here', '']) {
      expect(redact(s)).toBe(s);
    }
  });

  it('is stable when applied twice', () => {
    const once = redact('password=hunter2hunter2 and AKIAIOSFODNN7EXAMPLE');
    expect(redact(once)).toBe(once);
  });

  // Regression, fixed (redact.ts PATTERNS 'password'): after a key is masked as «secret:aws-key», the password
  // pattern matches "secret:aws-key»" (secret + ':' + 8 chars) and re-masks it, producing
  // «secret:«secret:password». The real kind is lost and secretKinds() reports "password".
  // Affects every kind whose name is 7+ chars (aws-key, github-token, private-key, ...); only jwt survives.
  it('keeps the specific kind of a masked key', () => {
    expect(redact('AKIAZ7QW4ERT9YUP3LMN')).toBe('«secret:aws-key»');
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('«masked:aws-key»');
    expect(redact('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----')).toBe('«secret:private-key»');
  });
});

describe('secretKinds', () => {
  it('lists the distinct masked kinds in a text', () => {
    expect(secretKinds('a «secret:jwt» b «secret:password» c «secret:jwt»')).toEqual(['jwt', 'password']);
    expect(secretKinds(undefined)).toEqual([]);
  });
});

describe('redact: common credential formats (from a security audit)', () => {
  it.each([
    ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123', 'abcdefghijklmnopqrstuvwxyz0123'],
    ['postgres://admin:Sup3rS3cretPw@db.example.com:5432/app', 'Sup3rS3cretPw'],
    ['npm_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', 'npm_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'],
    ['hf_' + 'abcdefghijklmnopqrstuvwxyzABCDEFGH', 'hf_' + 'abcdefghijklmnopqrstuvwxyzABCDEFGH'],
    ['glpat-' + 'abcdefghij0123456789', 'glpat-abcdefghij0123456789'],
    ['SG.' + 'abcdefghijklmnopqrstuv' + '.' + 'ABCDEFGHIJKLMNOPQRSTUVWX', 'SG.abcdefghijklmnopqrstuv'],
    ['{"password": "correct-horse-battery"}', 'correct-horse-battery'],
    ['password: hunter2', 'hunter2'],
    ['token: ' + 'g'.repeat(32), 'g'.repeat(32)],
    ['DefaultEndpointsProtocol=https;AccountName=x;AccountKey=' + 'Q'.repeat(40) + '==;', 'Q'.repeat(40)],
    ['STRIPE_SECRET=' + 'whsec_abcdefghijklmnop', 'whsec_abcdefghijklmnop'],
    ['OPENAI_KEY=sk-' + 'z'.repeat(30), 'z'.repeat(30)],
  ])('masks %s', (text, secret) => {
    expect(redact(text)).not.toContain(secret);
    expect(redact(text)).toMatch(/«(?:secret|masked):/);
  });

  it.each([
    'interface Props { token: string; password?: string }',
    'const password = input.value;',
    'password: ${DB_PASSWORD}',
    'api_key = process.env.API_KEY',
    'Reset your password from the settings page.',
    'git clone https://github.com/Dakshhhhh-ops/intent',
  ])('leaves code and prose alone: %s', (text) => {
    expect(redact(text)).toBe(text);
  });
});

describe('redact: prose about passing checks', () => {
  it('leaves "checks pass: backend, web" alone', () => {
    const t = 'All three CI checks pass: backend, web and Docker.';
    expect(redact(t)).toBe(t);
  });
});

describe('redact: real-looking secrets versus placeholders', () => {
  it.each([
    ['OPENAI_API_KEY=sk-proj-Xk9pL2mQ8rT4vW7yB3nC6dF1gH5jK0sZ'],
    ['GITHUB_TOKEN=ghp_Zq8Lm3Vt7Rk2Wp9Xn4Bc6Hd1Fs5Gj0Ya2Tu4'],
    ['postgres://app:N7#qLz2!vR9kWm4@db.prod.internal:5432/app'],
    ['{"api_key": "f3Kq9Lm2Zx7Vt4Rp8Wn1Bc5"}'],
  ])('flags a real-looking value: %s', (text) => {
    expect(secretKinds(redact(text)).length).toBe(1);
  });

  it.each([
    ['OPENAI_API_KEY=your-key-here'],
    ['API_TOKEN=xxxxxxxxxxxxxxxxxxxx'],
    ['STRIPE_SECRET=sk_test_' + 'a'.repeat(24)],
    ['SECRET_KEY=changeme-in-production'],
    ['DATABASE_URL=postgres://postgres:postgres@localhost:5432/dev'],
    ['DATABASE_URL=postgres://app:s3cretLocalPw@localhost:5432/dev'],
    ['AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'],
  ])('does not flag a placeholder or local dev value: %s', (text) => {
    const out = redact(text);
    // Masked, or left as is when it is plainly a placeholder; never counted as a secret.
    expect(out).not.toMatch(/«secret:/);
    expect(secretKinds(out)).toEqual([]);
  });
});

describe('redact: edge cases from a real-session review', () => {
  it('reads "KEY= command" as an empty assignment, not a key', () => {
    const t = 'GITHUB_REPO= LLM_API_KEY= .venv/Scripts/python -m pytest -q';
    expect(redact(t)).toBe(t);
  });

  it('ignores text that only mentions the marker format', () => {
    expect(secretKinds('Masked values become «secret:kind» so rules can see them.')).toEqual([]);
  });
});

const FAKE_DISCORD = ['MTA5MjQ3NjE0NTc5MzcxNzI4OA', 'Gx7YzA', 'k3LmQ9pR2vT8wZ4xB6nC1dF5gH0jK7sL3a'].join('.');
const FAKE_HOOK = 'q8Zx3Lm9' + 'Vt2Rk7Wp' + '4Bn6Hd1F';

describe('redact: second audit round', () => {
  it.each([
    ['curl -u admin:Sup3rS3cret99 https://api.example.com', 'Sup3rS3cret99'],
    ['aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLEKEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLEKEY'],
    ['"private_key_id": "3f9a1c2b7d4e5f60718293a4b5c6d7e8f9012345"', '3f9a1c2b7d4e5f60718293a4b5c6d7e8f9012345'],
    // Fake values assembled from parts, so repository secret scanners don't mistake the test for a leak.
    ['DISCORD_TOKEN=' + FAKE_DISCORD, FAKE_DISCORD],
    ['https://hooks.slack.' + 'com/services/T0ABCDEF1/B0GHIJKL2/' + FAKE_HOOK, FAKE_HOOK],
  ])('masks %s', (text, secret) => {
    expect(redact(text)).not.toContain(secret);
  });

  it('still leaves code paths alone', () => {
    for (const t of ['token: config.apiToken', 'password = form.values.password']) expect(redact(t)).toBe(t);
  });
});

describe('redact: user IDs are not passwords', () => {
  it('leaves docker -u 1000:1000 alone', () => {
    const t = 'docker run -u 1000:1000 node:20 npm test';
    expect(redact(t)).toBe(t);
  });
});
