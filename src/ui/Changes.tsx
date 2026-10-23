import { useEffect, useMemo, useState } from 'react';
import type { DiffLine, FileChange } from '../core/types';
import { DiffView } from './DiffView';
import { Icon } from './Icon';
import { useNav, useRun } from './model';

export function Changes() {
  const run = useRun();
  const nav = useNav();
  const files = run.analysis.files;
  const file = files.find((f) => f.path === nav.file) ?? files[0];
  const [mode, setMode] = useState<'diff' | 'final'>('diff');
  const [sel, setSel] = useState<{ i: number; line: DiffLine } | null>(null);

  useEffect(() => setSel(null), [file?.path, mode]);

  const finalLines: DiffLine[] = useMemo(
    () => (file?.final ? file.final.map((l, i) => ({ type: l.step !== null && l.step >= 0 ? 'add' : 'ctx', text: l.text, step: l.step, newNo: i + 1 })) : []),
    [file],
  );

  if (!files.length) {
    return (
      <div className="page">
        <div className="panel">
          <div className="empty">This run didn't change any files.</div>
        </div>
      </div>
    );
  }

  const lines = mode === 'final' && file.final ? finalLines : file.diff;
  const blame = { steps: run.trace.steps, phaseOf: (id: number) => run.analysis.stepPhase[id] };

  return (
    <div className="changes">
      <aside className="filelist" aria-label="Changed files">
        {files.map((f) => (
          <button key={f.path} className="file-item" aria-current={f.path === file.path} onClick={() => nav.openFile(f.path)}>
            <span className="fp">
              <Icon name={f.created ? 'create' : f.deleted ? 'delete' : 'edit'} size={13} style={{ color: f.created ? 'var(--create)' : f.deleted ? 'var(--fail)' : 'var(--edit)', flex: 'none' }} />
              <span title={f.path}>{f.path}</span>
            </span>
            <span className="fm">
              <span className="plus">+{f.added}</span>
              <span className="minus">−{f.removed}</span>
              <span>
                · {f.edits.length} edit{f.edits.length === 1 ? '' : 's'}
              </span>
              {f.isTest && <span className="chip low">test</span>}
              {f.flags.map((fl) => (
                <span key={fl} className="chip medium">
                  {fl}
                </span>
              ))}
            </span>
          </button>
        ))}
      </aside>
      <div className={`diffpane ${sel ? 'with-why' : ''}`}>
        <div className="diff-scroll">
          <div className="diff-toolbar">
            <span className="path" title={file.path}>
              {file.path}
            </span>
            <span className="plus num">+{file.added}</span>
            <span className="minus num">−{file.removed}</span>
            <span className="grow" />
            {file.final && (
              <div className="segmented" role="group" aria-label="View">
                <button aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>
                  Net diff
                </button>
                <button aria-pressed={mode === 'final'} onClick={() => setMode('final')}>
                  Final file
                </button>
              </div>
            )}
            <button className="icon-btn" onClick={() => nav.go(file.edits[0])} title="Replay the first edit">
              <Icon name="rewind" size={14} /> Replay
            </button>
          </div>
          {!file.reconstructed && (
            <div className="note">
              <Icon name="alert" size={14} style={{ color: 'var(--medium)', flex: 'none', marginTop: 2 }} />
              <span>
                {file.original === null
                  ? "The agent never read this whole file, so its original content isn't in the log. Showing each edit as it happened, attributed to its step."
                  : 'Some edits could not be placed exactly (the file also changed outside the logged edits). Showing each edit as it happened.'}
              </span>
            </div>
          )}
          <div className="note" style={{ background: 'none', border: 0, padding: '0 0 4px', margin: '10px 14px 4px', color: 'var(--text-3)' }}>
            <Icon name="target" size={14} style={{ flex: 'none', marginTop: 2 }} />
            Click any changed line to see why it was written and what the agent knew at that moment.
          </div>
          <DiffView lines={lines} blame={blame} selected={sel?.i ?? null} onSelect={(i, line) => setSel({ i, line })} highlightStep={sel?.line.step ?? null} />
        </div>
        {sel && <Why file={file} line={sel.line} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

function Why({ file, line, onClose }: { file: FileChange; line: DiffLine; onClose: () => void }) {
  const run = useRun();
  const nav = useNav();
  const step = line.step !== null && line.step >= 0 ? run.trace.steps[line.step] : null;
  const seen = useMemo(() => (step ? [...run.analysis.readBefore(step.id)] : []), [run, step]);
  if (!step) {
    return (
      <aside className="why" aria-label="Why this line">
        <div className="why-head">
          <h3>About this line</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="ctx-section">
          <p>{line.step === -1 ? 'This line changed outside the agent’s logged edits (a formatter, a shell command, or you).' : 'This line was already in the file before the run.'}</p>
        </div>
      </aside>
    );
  }
  const norm = (p: string) => p.replace(/^\.\//, '').toLowerCase();
  const readIt = file.created && file.edits[0] <= step.id ? null : seen.some((p) => norm(p) === norm(file.path));
  const failId = run.lastFailBefore[step.id];
  const fail = failId >= 0 ? run.trace.steps[failId] : null;
  const prompt = run.promptAt[step.id] >= 0 ? run.trace.steps[run.promptAt[step.id]] : null;
  const findings = run.findingsByStep.get(step.id) ?? [];

  return (
    <aside className="why" aria-label="Why this line">
      <div className="why-head">
        <h3>
          Why line{line.newNo ? ` ${line.newNo}` : ''} {line.type === 'del' ? 'was removed' : 'was written'}
        </h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="line-preview" style={line.type === 'del' ? { background: 'var(--del-bg)', color: 'var(--del-text)' } : undefined}>
        {line.text || ' '}
      </div>
      <div className="ctx-section">
        <h3>
          Written at
          <button className="step-chip" onClick={() => nav.go(step.id)}>
            #{step.id + 1} · open in replay
          </button>
        </h3>
        <p style={{ color: 'var(--text)' }}>{step.title}</p>
      </div>
      <div className="ctx-section">
        <h3>The agent's reason</h3>
        {step.intent ? <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', maxHeight: 220, overflow: 'auto' }}>{step.intent}</p> : <p>The agent didn't say anything before this edit.</p>}
      </div>
      <div className="ctx-section">
        <h3>Evidence it had</h3>
        {readIt !== null && (
          <div className={`check-line ${readIt ? 'good' : 'bad'}`}>
            <Icon name={readIt ? 'check' : 'alert'} size={14} />
            <span>{readIt ? `It had read ${file.path}.` : `It had never read ${file.path}.`}</span>
          </div>
        )}
        {fail && (
          <div className="check-line" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
            <Icon name="x" size={14} style={{ color: 'var(--high)' }} />
            <span>
              {step.id - fail.id <= 6 ? 'Right after' : 'After'} a failure at{' '}
              <button className="link-btn" onClick={() => nav.go(fail.id)}>
                step {fail.id + 1}
              </button>
              : <span className="mono">{fail.command!.cmd.slice(0, 60)}</span>
            </span>
          </div>
        )}
        <p>
          {seen.length} file{seen.length === 1 ? '' : 's'} seen before this step
          {seen.length ? ':' : '.'}
        </p>
        {seen
          .slice(-8)
          .reverse()
          .map((p) => (
            <div key={p} className="ctx-file" title={p}>
              <Icon name="read" size={12} style={{ color: 'var(--read)', flex: 'none' }} />
              <span>{p}</span>
            </div>
          ))}
      </div>
      {prompt && (
        <div className="ctx-section">
          <h3>Instruction in force</h3>
          <p style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{prompt.text}</p>
        </div>
      )}
      {findings.length > 0 && (
        <div className="ctx-section">
          <h3>Flags on this step</h3>
          {findings.map((f) => (
            <div key={f.id} className={`banner ${f.severity}`} style={{ marginBottom: 6 }}>
              <Icon name="alert" size={14} />
              <div>
                <div className="bt" style={{ fontSize: 12.5 }}>
                  {f.title}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
