import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootTag, injectIntoHead, stripInjected } from '../src/core/embed';
import { slimBytes } from '../src/core/parse/slim';
import { redact } from '../src/core/redact';
import type { SessionInfo } from './sessions';

// A tiny local server: the viewer page plus the logs it asks for.
// Binds to 127.0.0.1 only, and on top of that:
// - answers only requests addressed to 127.0.0.1 or localhost on its own port, which stops a web
//   page from reaching it through DNS rebinding;
// - requires a random per-run token (in the link the CLI opens, and in every API path);
// - masks secrets before a log leaves the process.

export function viewerHtmlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../dist/index.html'), resolve(here, '../../dist/index.html'), resolve(process.cwd(), 'dist/index.html')];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error('Viewer build not found. Run `npm run build` first.');
  return hit;
}

/** The lighter page for exported replays (no home page or 3D code); falls back to the full viewer. */
export function exportHtmlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../dist-export/export.html'), resolve(here, '../../dist-export/export.html'), resolve(process.cwd(), 'dist-export/export.html')];
  return candidates.find((p) => existsSync(p)) ?? viewerHtmlPath();
}

export function injectBoot(html: string, boot: object, extra = ''): string {
  return injectIntoHead(stripInjected(html), bootTag(boot) + extra);
}

export function startServer(opts: {
  sessions: () => SessionInfo[];
  initial?: { id: string; path: string };
  port: number;
  cwd: string;
  live?: boolean;
}): Promise<{ server: Server; url: string; token: string }> {
  const html = readFileSync(viewerHtmlPath(), 'utf8');
  const token = randomBytes(18).toString('base64url');
  let boundPort = opts.port;
  const extraFiles = new Map<string, string>();
  if (opts.initial) extraFiles.set(opts.initial.id, opts.initial.path);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (code: number, type: string, body: string | Buffer) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(body);
    };
    try {
      const host = (req.headers.host ?? '').toLowerCase();
      if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) {
        return send(403, 'text/plain', 'Forbidden: this server only answers requests to 127.0.0.1 or localhost.');
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (url.searchParams.get('token') !== token) {
          return send(403, 'text/plain; charset=utf-8', 'Open the link printed in the terminal (it includes an access token).');
        }
        return send(200, 'text/html; charset=utf-8', injectBoot(html, { api: `/api/${token}`, session: opts.initial?.id ?? null, cwd: opts.cwd, live: !!opts.live }));
      }
      if (!url.pathname.startsWith(`/api/${token}/`)) return send(404, 'text/plain', 'Not found');
      url.pathname = url.pathname.slice(`/api/${token}`.length).replace(/^/, '/api');
      if (url.pathname === '/api/sessions') {
        const list = opts.sessions().map(({ path: _p, ...rest }) => rest);
        return send(200, 'application/json', JSON.stringify(list));
      }
      const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(raw|stat)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const path = extraFiles.get(id) ?? opts.sessions().find((s) => s.key === id || s.id === id)?.path;
        if (!path || !existsSync(path)) return send(404, 'text/plain', 'Session not found');
        if (m[2] === 'stat') {
          const st = statSync(path);
          return send(200, 'application/json', JSON.stringify({ size: st.size, mtime: st.mtimeMs }));
        }
        // Slimmed (no API request dumps or base64 images) and masked before it leaves this process.
        return send(200, 'text/plain; charset=utf-8', redact(slimBytes(readFileSync(path))));
      }
      send(404, 'text/plain', 'Not found');
    } catch (e) {
      send(500, 'text/plain', String((e as Error).message));
    }
  });

  return new Promise((resolveP, reject) => {
    let port = opts.port;
    const tryListen = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < opts.port + 20) {
          port++;
          tryListen();
        } else reject(err);
      });
      server.listen(port, '127.0.0.1', () => {
        boundPort = port;
        resolveP({ server, url: `http://127.0.0.1:${port}/?token=${token}`, token });
      });
    };
    tryListen();
  });
}
