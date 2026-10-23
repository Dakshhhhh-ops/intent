import { useMemo } from 'react';
import { failureHeadline } from '../core/analyze/commands';
import type { Step } from '../core/types';
import { Icon } from './Icon';
import { useNav, useRun } from './model';

// "What did the agent know at this moment?" — instruction in force, files seen,
// the last failure, the plan, and a map of every file it touched so far.

export function ContextPanel({ step }: { step: Step | undefined }) {
  const run = useRun();
  const nav = useNav();
  const id = step?.id ?? 0;
  const seen = useMemo(() => run.analysis.readBefore(id + 1), [run, id]);
  const seenBefore = useMemo(() => run.analysis.readBefore(id), [run, id]);
  if (!step) return <aside className="context" />;

  const prompt = run.promptAt[id] >= 0 ? run.trace.steps[run.promptAt[id]] : null;
  const failId = run.lastFailBefore[id];
  const fail = failId >= 0 ? run.trace.steps[failId] : null;
  const planId = run.planAt[id];
  const plan = planId >= 0 ? run.trace.steps[planId].plan : null;
  const editPath = step.edit?.path;
  const file = editPath ? run.fileByPath.get(editPath) : undefined;
  const createdHere = file?.created && file.edits[0] === step.id;
  const norm = (p: string) => p.replace(/^\.\//, '').toLowerCase();
  const readFirst = editPath ? [...seenBefore].some((p) => norm(p) === norm(editPath)) : false;
  const recent = [...seen].reverse().slice(0, 14);

  return (
    <aside className="context" aria-label="Context at this step">
      {editPath && !createdHere && (
        <div className="ctx-section">
          <h3>Before this edit</h3>
          <div className={`check-line ${readFirst ? 'good' : 'bad'}`}>
            <Icon name={readFirst ? 'check' : 'alert'} size={14} />
            <span>{readFirst ? 'The agent had read this file.' : 'The agent had not read this file.'}</span>
          </div>
          {fail && (
            <div className="check-line bad" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
              <Icon name="x" size={14} style={{ color: 'var(--high)' }} />
              <span>
                Last failure was{' '}
                <button className="link-btn" onClick={() => nav.go(fail.id)}>
                  step {fail.id + 1}
                </button>{' '}
                ({id - fail.id} steps earlier).
              </span>
            </div>
          )}
        </div>
      )}

      {prompt && (
        <div className="ctx-section">
          <h3>
            Instruction in force
            <button className="step-chip" onClick={() => nav.go(prompt.id)}>
              #{prompt.id + 1}
            </button>
          </h3>
          <p style={{ display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden', color: 'var(--text)' }}>{prompt.text}</p>
        </div>
      )}

      {fail && !editPath && (
        <div className="ctx-section">
          <h3>
            Last failure
            <button className="step-chip" onClick={() => nav.go(fail.id)}>
              #{fail.id + 1}
            </button>
          </h3>
          <p className="mono" style={{ fontSize: 11.5, color: 'var(--text)', wordBreak: 'break-word' }}>
            {fail.command!.cmd.slice(0, 140)}
          </p>
          {failureHeadline(fail.command!.output) && (
            <p className="mono" style={{ fontSize: 11.5, color: 'var(--high)', marginTop: 4, wordBreak: 'break-word' }}>
              {failureHeadline(fail.command!.output)!.slice(0, 160)}
            </p>
          )}
        </div>
      )}

      {plan && plan.items.length > 0 && (
        <div className="ctx-section">
          <h3>Plan at this point</h3>
          <ul className="plan-list" style={{ padding: 0 }}>
            {plan.items.slice(0, 10).map((it, i) => (
              <li key={i} className={it.status} style={{ fontSize: 12.5 }}>
                <Icon name={it.status === 'completed' ? 'check' : it.status === 'in_progress' ? 'next' : 'plan'} size={13} />
                {it.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ctx-section">
        <h3>
          Files seen so far <span className="num">{seen.size}</span>
        </h3>
        {recent.length === 0 && <p>Nothing read yet.</p>}
        {recent.map((p) => (
          <div key={p} className={`ctx-file ${step.files.includes(p) ? 'current' : ''}`} title={p}>
            <Icon name="read" size={12} style={{ color: 'var(--read)', flex: 'none' }} />
            <span>{p}</span>
          </div>
        ))}
        {seen.size > recent.length && <p style={{ marginTop: 4, fontSize: 11.5 }}>+ {seen.size - recent.length} earlier</p>}
      </div>

      <div className="ctx-section">
        <h3>File map</h3>
        <FileMap id={id} current={step.files} />
      </div>
    </aside>
  );
}

function FileMap({ id, current }: { id: number; current: string[] }) {
  const run = useRun();
  const rows = useMemo(() => {
    const touched = run.analysis.touched
      .filter((t) => !/^([a-zA-Z]:)?\//.test(t.path))
      .slice(0, 400)
      .sort((a, b) => a.path.localeCompare(b.path));
    return touched;
  }, [run]);
  let lastDir = '';
  return (
    <div className="filemap">
      {rows.length === 0 && <p style={{ fontFamily: 'var(--font-ui)' }}>No project files touched.</p>}
      {rows.map((t) => {
        const dir = t.path.includes('/') ? t.path.slice(0, t.path.lastIndexOf('/')) : '';
        const name = t.path.slice(dir ? dir.length + 1 : 0);
        const showDir = dir !== lastDir;
        lastDir = dir;
        const read = t.reads.some((r) => r <= id);
        const edited = t.edits.some((e) => e <= id);
        const f = run.fileByPath.get(t.path);
        const created = edited && f?.created;
        const now = current.includes(t.path);
        const cls = `${now ? 'now ' : ''}${created ? 'edited created' : edited ? 'edited' : read ? 'read' : ''}`;
        return (
          <div key={t.path}>
            {showDir && <div className="fm-dir">{dir || './'}</div>}
            <div className={`fm-row ${cls}`} style={{ paddingLeft: dir ? 10 : 0 }} title={t.path}>
              <span className="fm-dot" key={now ? `n${id}` : 'x'} />
              <span className="nm">{name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
