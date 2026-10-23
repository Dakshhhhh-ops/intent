import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { ParticleWordmark } from './ParticleWordmark';

// Footer with the 3D "step rain" behind it (layout inspired by Lusion's Oryzo footer).

const INSTALL = 'npm i -g github:Dakshhhhh-ops/intent';
const REPO = 'https://github.com/Dakshhhhh-ops/intent';

export function SiteFooter({ onSample }: { onSample?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    // Load Three.js only when the footer gets close to the viewport.
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(
      async ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const { startStepRain } = await import('./stepRain');
        if (cancelled || !host.current) return;
        dispose = startStepRain(host.current)?.dispose;
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      dispose?.();
    };
  }, []);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked; nothing to do */
    }
  };

  return (
    <footer className="site-footer">
      <div className="sf-canvas" ref={host} aria-hidden="true" />
      <div className="sf-vignette" aria-hidden="true" />
      <div className="sf-inner">
        <div className="sf-top">
          <h2 className="sf-headline">
            If your agent says
            <br />
            “all tests pass,”
            <br />
            check the tape.
          </h2>
          {onSample && (
            <button className="sf-pill" onClick={onSample}>
              Open the replay <Icon name="next" size={16} />
            </button>
          )}
        </div>

        <div className="sf-grid">
          <div className="sf-box">
            <p className="sf-orange">
              Built for Build With AI: Basics
              <br />
              by Daksh <span aria-hidden="true">♥</span>
            </p>
            <p className="sf-strong sf-right">
              Share it if it saved
              <br />
              you a bad merge
            </p>
            <button className="sf-mini-pill" onClick={() => copy(location.href.split('#')[0], 'url')}>
              {copied === 'url' ? 'Copied' : 'Copy URL'}
            </button>
          </div>

          <div className="sf-col">
            <p className="sf-label">Install the CLI:</p>
            <button className="sf-field" onClick={() => copy(INSTALL, 'install')} title="Copy">
              <span>{copied === 'install' ? 'Copied to clipboard' : INSTALL}</span>
              <Icon name={copied === 'install' ? 'check' : 'copy'} size={18} />
            </button>
            <div className="sf-pairs">
              <div>
                <p className="sf-label">Source:</p>
                <a className="sf-strong" href={REPO} target="_blank" rel="noreferrer">
                  github.com/Dakshhhhh-ops/intent
                </a>
              </div>
              <div>
                <p className="sf-label">Reads:</p>
                <p className="sf-strong">Claude Code · Codex CLI · Intent Trace</p>
              </div>
            </div>
          </div>

          <nav className="sf-links" aria-label="Project links">
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href={`${REPO}/blob/main/docs/TRACE_FORMAT.md`} target="_blank" rel="noreferrer">
              Trace format
            </a>
            <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
              MIT license
            </a>
          </nav>
        </div>

        <ParticleWordmark />
        <div className="sf-bottom">
          <span className="sf-strong">© 2026 · MIT</span>
          <span className="sf-fine">
            Runs locally. No log ever leaves your machine.
            <br />
            Secrets are masked before anything is shown or exported.
          </span>
        </div>
      </div>
    </footer>
  );
}
