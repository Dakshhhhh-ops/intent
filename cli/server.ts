import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionInfo } from './sessions';

// A tiny local server: the viewer page plus the raw logs it asks for.
// Binds to 127.0.0.1 only.

export function viewerHtmlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../dist/index.html'), resolve(here, '../../dist/index.html'), resolve(process.cwd(), 'dist/index.html')];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error('Viewer build not found. Run `npm run build` first.');
  return hit;
}

export function injectBoot(html: string, boot: object, extra = ''): string {
  const tag = `<script>window.__INTENT_BOOT__=${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>${extra}`;
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html;
}

export function startServer(opts: {
  sessions: () => SessionInfo[];
  initial?: { id: string; path: string };
  port: number;
  cwd: string;
}): Promise<{ server: Server; url: string }> {
  const html = readFileSync(viewerHtmlPath(), 'utf8');
  const extraFiles = new Map<string, string>();
  if (opts.initial) extraFiles.set(opts.initial.id, opts.initial.path);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (code: number, type: string, body: string | Buffer) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(body);
    };
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return send(200, 'text/html; charset=utf-8', injectBoot(html, { api: '/api', session: opts.initial?.id ?? null, cwd: opts.cwd }));
      }
      if (url.pathname === '/api/sessions') {
        const list = opts.sessions().map(({ path: _p, ...rest }) => rest);
        return send(200, 'application/json', JSON.stringify(list));
      }
      const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/raw$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const path = extraFiles.get(id) ?? opts.sessions().find((s) => s.id === id)?.path;
        if (!path || !existsSync(path)) return send(404, 'text/plain', 'Session not found');
        return send(200, 'text/plain; charset=utf-8', readFileSync(path));
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
      server.listen(port, '127.0.0.1', () => resolveP({ server, url: `http://127.0.0.1:${port}/` }));
    };
    tryListen();
  });
}
