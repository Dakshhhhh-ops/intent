import { Fragment, type ReactNode } from 'react';
import { outputLooksFailed } from '../core/analyze/commands';
import type { Step } from '../core/types';
import { splitLines } from '../core/util';
import { DiffView, stepDiff } from './DiffView';
import { Icon, KIND_ICON } from './Icon';
import { Rich } from './Rich';
import { RULE_INFO } from '../core/analyze/rules';
import { fmtClock, fmtOffset, kindClass, PHASE_LABEL, useNav, useRun } from './model';

const KIND_LABEL: Record<string, string> = {
  prompt: 'Instruction',
  message: 'Agent said',
  thinking: 'Reasoning',
  plan: 'Plan',
  read: 'Read',
  search: 'Search',
  edit: 'Edit',
  create: 'Create',
  delete: 'Delete',
  command: 'Command',
  web: 'Web',
  subagent: 'Sub-agent',
  tool: 'Tool',
};

const FAIL_LINE = /\b(fail(ed|ing|ure)?|error|✗|×|not ok|assert(ion)?error|expected|traceback|exception)\b/i;
const PASS_LINE = /\b(pass(ed|ing)?|ok\b|✓|✔|success(ful)?)\b/i;

function Output({ text }: { text: string }) {
  if (!text) return <pre className="output" style={{ color: 'var(--text-3)' }}>(no output)</pre>;
  const lines = text.split(/\r?\n/);
  const shown = lines.slice(0, 600);
  return (
    <pre className="output">
      {shown.map((l, i) => (
        <Fragment key={i}>
          <span className={FAIL_LINE.test(l) && !/\b0 (fail|error)/i.test(l) ? 'hl-fail' : PASS_LINE.test(l) ? 'hl-pass' : undefined}>{l}</span>
          {'\n'}
        </Fragment>
      ))}
      {lines.length > shown.length ? `… ${lines.length - shown.length} more lines` : null}
    </pre>
  );
}

function FilePreview({ content, start = 1 }: { content: string; start?: number }) {
  const lines = splitLines(content).slice(0, 400);
  return (
    <div className="diff">
      {lines.map((l, i) => (
        <div key={i} className="diff-line">
          <span />
          <span className="ln num" />
          <span className="ln num">{start + i}</span>
          <span className="sg" />
          <span className="tx">{l || ' '}</span>
        </div>
      ))}
    </div>
  );
}

export function Inspector({ step }: { step: Step | undefined }) {
  const run = useRun();
  const nav = useNav();
  if (!step) return <section className="inspector" />;
  const phase = run.analysis.stepPhase[step.id];
  const findings = run.findingsByStep.get(step.id) ?? [];
  const claims = run.claimsByStep.get(step.id) ?? [];
  const showIntent = step.intent && !['prompt', 'message', 'thinking'].includes(step.kind);

  let body: ReactNode = null;
  if (step.edit) {
    const lines = stepDiff(step.edit, step.id);
    body = (
      <div className="block">
        <div className="block-head">
          <Icon name={step.kind === 'create' ? 'create' : 'edit'} size={14} />
          <button className="link-btn path" onClick={() => nav.openFile(step.edit!.path)} title="Open in Changes">
            {step.edit.path}
          </button>
          <span className="grow" />
          <span className="plus num">+{step.edit.added}</span>
          <span className="minus num">−{step.edit.removed}</span>
        </div>
        {lines.length ? <DiffView lines={lines} max={1500} /> : <div className="note">The log doesn't include the content of this change{step.edit.opaque ? ' (it was made through a notebook or the shell)' : ''}.</div>}
      </div>
    );
  } else if (step.command) {
    const c = step.command;
    const masked = !c.failed && outputLooksFailed(c.output);
    body = (
      <div className="block">
        <div className="block-head">
          <Icon name="command" size={14} />
          <span>{c.categories.filter((x) => x !== 'other').join(' · ') || 'shell'}</span>
          <span className="grow" />
          {c.durationMs ? <span className="num">{(c.durationMs / 1000).toFixed(1)}s</span> : null}
          <span className={`exit ${c.exitCode === null ? 'unk' : c.failed || masked ? 'bad' : 'ok'}`}>
            {c.exitCode === null ? 'exit ?' : `exit ${c.exitCode}`}
            {masked ? ' · output shows failures' : ''}
            {c.interrupted ? ' · interrupted' : ''}
          </span>
        </div>
        <div className="cmdline">{c.cmd}</div>
        <Output text={c.output} />
      </div>
    );
  } else if (step.read) {
    const r = step.read;
    body = (
      <div className="block">
        <div className="block-head">
          <Icon name="read" size={14} />
          <span className="path">{r.path}</span>
          <span className="grow" />
          <span>{r.viaShell ? 'via shell' : step.tool === 'context' ? 'attached to context' : r.full ? 'whole file' : r.startLine ? `from line ${r.startLine}${r.numLines ? `, ${r.numLines} lines` : ''}` : 'part of file'}</span>
        </div>
        {r.content ? <FilePreview content={r.content} start={r.startLine ?? 1} /> : <div className="note">The log records that this file was read, not its content.</div>}
      </div>
    );
  } else if (step.search) {
    body = (
      <div className="block">
        <div className="block-head">
          <Icon name="search" size={14} />
          <span className="path">{step.search.pattern}</span>
          {step.search.path ? <span>in {step.search.path}</span> : null}
        </div>
        <Output text={step.search.output ?? ''} />
      </div>
    );
  } else if (step.plan) {
    body = (
      <div className="block">
        <ul className="plan-list">
          {step.plan.items.map((it, i) => (
            <li key={i} className={it.status}>
              <Icon name={it.status === 'completed' ? 'check' : it.status === 'in_progress' ? 'next' : 'plan'} size={14} />
              {it.text}
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (step.text) {
    body = <p className={`prose ${step.kind === 'prompt' ? 'user' : ''}`}>{step.text}</p>;
  } else if (step.detail || step.output) {
    body = (
      <>
        {step.detail && (
          <div className="block">
            <div className="block-head">Input</div>
            <pre className="output">{step.detail}</pre>
          </div>
        )}
        {step.output && (
          <div className="block">
            <div className="block-head">Result</div>
            <Output text={step.output} />
          </div>
        )}
      </>
    );
  }

  return (
    <section className="inspector" aria-label="Step detail" key={step.id}>
      <div className={`insp-head ${kindClass(step)}`}>
        <div className="big-icon">
          <Icon name={KIND_ICON[step.kind]} size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h2>{step.title}</h2>
          <div className="sub">
            <span>
              {KIND_LABEL[step.kind]}
              {step.actor === 'subagent' ? ' · sub-agent' : step.actor === 'user' && step.kind !== 'prompt' ? ' · from the harness' : ''}
            </span>
            <span className={`chip phase-${phase}`} style={{ color: 'var(--phase-color)', background: 'var(--phase-soft)', borderColor: 'transparent', height: 19 }}>
              {PHASE_LABEL[phase]}
            </span>
            {step.t ? (
              <span className="num" title={new Date(step.t).toLocaleString()}>
                {fmtClock(step.t)} {run.t0 ? `(${fmtOffset(step.t - run.t0)})` : ''}
              </span>
            ) : null}
            <span className="num">step {step.id + 1}</span>
          </div>
        </div>
      </div>

      {(findings.length > 0 || claims.length > 0) && (
        <div className="flags">
          <p className="mono-label">
            Flags on this step <span className="flags-n">{findings.length + claims.length}</span>
          </p>
          {findings.map((f) => (
            <details key={f.id} className={`flag-row ${f.severity}`}>
              <summary>
                <span className={`sev-dot ${f.severity}`} />
                <span className="flag-t">
                  <Rich text={f.title} />
                </span>
                <span className="flag-rule">{RULE_INFO[f.rule].name}</span>
              </summary>
              <p>
                <Rich text={f.detail} />
              </p>
            </details>
          ))}
          {claims.map((c) => (
            <details key={c.id} className={`flag-row is-claim ${c.verdict}`}>
              <summary>
                <span className={`flag-stamp ${c.verdict}`}>{c.verdict}</span>
                <span className="flag-t">
                  {c.step === step.id ? 'Claim made here' : 'Evidence for'}: “<Rich text={c.text.length > 90 ? c.text.slice(0, 88) + '…' : c.text} />”
                </span>
              </summary>
              <p>
                <Rich text={c.explanation} />
                {c.step !== step.id && (
                  <>
                    {' '}
                    <button className="link-btn" onClick={() => nav.go(c.step)}>
                      see the claim (#{c.step + 1})
                    </button>
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      )}

      {showIntent && (
        <div className="intent">
          <div className="lbl">
            <Icon name="message" size={12} /> Why — what the agent said before this
          </div>
          <p>{step.intent}</p>
        </div>
      )}

      {body}
    </section>
  );
}
