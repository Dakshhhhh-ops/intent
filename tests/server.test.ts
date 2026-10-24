import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startServer } from '../cli/server';
import type { SessionInfo } from '../cli/sessions';

// The local server must not hand session logs to other websites (DNS rebinding, cross-site reads).

const hasViewer = existsSync('dist/index.html');

function get(port: number, path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe.skipIf(!hasViewer)('local server', () => {
  let server: Server;
  let port = 0;
  let token = '';
  const dir = mkdtempSync(join(tmpdir(), 'ir-server-'));
  const log = join(dir, 'session.jsonl');
  writeFileSync(log, '{"type":"user","message":{"role":"user","content":"deploy with OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"}}\n');
  const sessions = (): SessionInfo[] => [{ id: '1', key: 'sabc', path: log, agent: 'claude-code', title: 'demo', mtime: 0, size: 1 }];

  beforeAll(async () => {
    const r = await startServer({ sessions, port: 48600 + Math.floor(Math.random() * 300), cwd: dir });
    server = r.server;
    token = r.token;
    port = Number(new URL(r.url).port);
  });
  afterAll(() => server?.close());

  it('refuses requests addressed to another host (DNS rebinding)', async () => {
    const r = await get(port, `/api/${token}/sessions`, 'attacker.example');
    expect(r.status).toBe(403);
    expect(r.body).not.toContain('demo');
  });

  it('refuses the page and the API without the token', async () => {
    expect((await get(port, '/')).status).toBe(403);
    expect((await get(port, '/api/sessions')).status).toBe(404);
    expect((await get(port, '/api/wrong-token/sessions')).status).toBe(404);
  });

  it('serves the page and the API with the token, and masks secrets in logs', async () => {
    expect((await get(port, `/?token=${token}`)).status).toBe(200);
    const list = await get(port, `/api/${token}/sessions`, `localhost:${port}`);
    expect(list.status).toBe(200);
    expect(list.body).toContain('demo');
    const raw = await get(port, `/api/${token}/sessions/sabc/raw`);
    expect(raw.status).toBe(200);
    expect(raw.body).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });
});
