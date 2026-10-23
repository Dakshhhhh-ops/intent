import { useEffect, useRef, useState } from 'react';
import { toIntentTrace } from '../core/parse/intentTrace';
import { toMarkdown } from '../core/report/markdown';
import { Icon } from './Icon';
import { useNav, useRun } from './model';

declare global {
  interface Window {
    __IR_PRISTINE__?: string;
  }
}

function download(name: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'run'
  );
}

/** One self-contained HTML file: this viewer with the run baked in. */
export function buildReplayHtml(traceJson: string): string {
  const base = window.__IR_PRISTINE__ ?? `<!doctype html>${document.documentElement.outerHTML}`;
  const cleaned = base
    .replace(/<script>window\.__INTENT_BOOT__=[\s\S]*?<\/script>/g, '')
    .replace(/<script id="intent-trace" type="application\/json">[\s\S]*?<\/script>/g, '');
  const inject = `<script>window.__INTENT_BOOT__={"embedded":true}</script><script id="intent-trace" type="application/json">${traceJson.replace(/</g, '\\u003c')}</script>`;
  const html = cleaned.includes('</head>') ? cleaned.replace('</head>', `${inject}</head>`) : inject + cleaned;
  return html.startsWith('<!doctype') || html.startsWith('<!DOCTYPE') ? html : `<!doctype html>\n${html}`;
}

export function ExportMenu() {
  const run = useRun();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const name = slug(run.trace.title);
  const md = () => toMarkdown(run.trace, run.analysis);

  const actions = [
    {
      icon: 'copy',
      t: 'Copy PR report',
      d: 'Markdown with verdict, claims and findings',
      run: async () => {
        try {
          await navigator.clipboard.writeText(md());
          nav.toast('Report copied — paste it into your pull request');
        } catch {
          download(`${name}-report.md`, md(), 'text/markdown');
          nav.toast('Clipboard unavailable — downloaded the report instead');
        }
      },
    },
    {
      icon: 'markdown',
      t: 'Download report (.md)',
      d: 'The same report as a file',
      run: () => download(`${name}-report.md`, md(), 'text/markdown'),
    },
    {
      icon: 'download',
      t: 'Download replay (.html)',
      d: 'One offline file anyone can open · secrets masked',
      run: () => {
        download(`${name}-replay.html`, buildReplayHtml(toIntentTrace(run.trace)), 'text/html');
        nav.toast('Replay saved — it opens offline in any browser');
      },
    },
    {
      icon: 'code',
      t: 'Download trace (.json)',
      d: 'Normalized Intent Trace format',
      run: () => download(`${name}.intent.json`, toIntentTrace(run.trace), 'application/json'),
    },
  ];

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="upload" />
        <span className="tab-label">Share</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {actions.map((a) => (
            <button
              key={a.t}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void a.run();
              }}
            >
              <Icon name={a.icon} />
              <span className="mt">{a.t}</span>
              <span className="md">{a.d}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
