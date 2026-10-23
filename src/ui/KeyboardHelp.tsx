import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

const KEYS: [string, string][] = [
  ['1 – 4', 'Brief · Replay · Changes · Findings'],
  ['j / k  or  ← →', 'Next / previous step'],
  ['space', 'Play / pause the replay'],
  ['[ / ]', 'Previous / next edit'],
  ['f / F', 'Next / previous flagged step'],
  ['Home / End', 'First / last step'],
  ['/', 'Filter steps'],
  ['?', 'Show this help'],
  ['Esc', 'Close'],
];

export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="kh" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="kh">Keyboard shortcuts</h2>
          <button ref={ref} className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="keys">
          {KEYS.map(([k, d]) => (
            <div key={k} style={{ display: 'contents' }}>
              <span>
                {k.split('  or  ').map((part, i) => (
                  <span key={i}>
                    {i > 0 && <span style={{ color: 'var(--text-3)' }}> or </span>}
                    <kbd>{part}</kbd>
                  </span>
                ))}
              </span>
              <span style={{ color: 'var(--text-2)' }}>{d}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
