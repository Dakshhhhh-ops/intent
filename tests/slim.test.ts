import { describe, it, expect } from 'vitest';
import { slimBytes, slimLine, slimLog } from '../src/core/parse/slim';

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = 'A'.repeat(5000);

describe('slim', () => {
  it('drops bookkeeping records the parser skips', () => {
    expect(slimLine('{"type":"api-request","body":"…"}')).toBeNull();
    expect(slimLine('{"type":"file-history-snapshot","snapshot":{}}')).toBeNull();
    expect(slimLine('{"type":"user","message":{}}')).toBe('{"type":"user","message":{}}');
  });

  it('strips base64 images but keeps the record', () => {
    const line = `{"type":"user","message":{"content":[{"type":"image","source":{"type":"base64","data":"${b64}"}}]}}`;
    const out = slimLine(line)!;
    expect(out.length).toBeLessThan(200);
    expect(JSON.parse(out).message.content[0].source.data).toBe('');
    const url = `{"payload":{"image_url":"data:image/png;base64,${b64}"}}`;
    expect(JSON.parse(slimLine(url)!).payload.image_url).toBe('data:image/png;base64,');
  });

  it('gives the same result however the bytes are chunked, including split multi-byte characters', () => {
    const log = ['{"type":"user","t":"héllo ✓ 日本"}', '{"type":"api-request","x":1}', `{"type":"assistant","data":"${b64}"}`, '{"type":"user","t":"end"}'].join('\n');
    const whole = slimLog(log);
    for (const size of [1, 3, 7, 64, 1000]) expect(slimBytes(enc(log), size)).toBe(whole);
    expect(whole.split('\n')).toHaveLength(3);
  });

  it('leaves a pretty-printed JSON document untouched', () => {
    const doc = JSON.stringify({ version: 1, steps: [{ type: 'api-request' }] }, null, 2);
    expect(slimBytes(enc(doc), 5)).toBe(doc);
  });
});
