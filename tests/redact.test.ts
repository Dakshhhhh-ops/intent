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
    expect(out).toMatch(/^token is «secret:.+» ok$/);
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
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('«secret:aws-key»');
    expect(redact('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----')).toBe('«secret:private-key»');
  });
});

describe('secretKinds', () => {
  it('lists the distinct masked kinds in a text', () => {
    expect(secretKinds('a «secret:jwt» b «secret:password» c «secret:jwt»')).toEqual(['jwt', 'password']);
    expect(secretKinds(undefined)).toEqual([]);
  });
});
