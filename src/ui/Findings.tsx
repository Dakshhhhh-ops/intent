import { useState } from 'react';
import { RULE_INFO } from '../core/analyze/rules';
import type { Finding, RuleId, Severity } from '../core/types';
import { Evidence } from './Evidence';
import { Icon } from './Icon';
import { useNav, useRun } from './model';
import { Rich } from './Rich';
import { RunStrip } from './RunStrip';

const SEV_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };

export const RULE_ICON: Record<RuleId, string> = {
  'weakened-tests': 'flag',
  'contradicted-claim': 'quote',
  'blind-edit': 'eye',
  'failure-loop': 'rewind',
  'silenced-errors': 'x',
  'risky-command': 'command',
  'secret-exposure': 'lock',
  'new-dependency': 'layers',
  churn: 'edit',
  'unverified-finish': 'help',
  'sensitive-files': 'shield',
  'masked-exit-code': 'filter',
};

/** The steps worth showing as evidence: the step that proves it, and (for claims) where it was said. */
function evidenceSteps(f: Finding): number[] {
  if (f.rule === 'contradicted-claim') return [...f.steps].sort((a, b) => b - a).slice(0, 2);
  if (f.rule === 'failure-loop') return f.steps.slice(-2);
  return f.steps.slice(0, 2);
}

export function Findings() {
  const run = useRun();
  const nav = useNav();
  const [rule, setRule] = useState<RuleId | 'all'>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const all = run.analysis.findings;
  const lookAt = all.filter((f) => f.severity !== 'info').length;
  const counts = new Map<RuleId, number>();
  for (const f of all) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  const list = rule === 'all' ? all : all.filter((f) => f.rule === rule);
  const sevCount = (s: Severity) => all.filter((f) => f.severity === s).length;
  const passed = (Object.keys(RULE_INFO) as RuleId[]).filter((r) => !counts.has(r));
  const isOpen = (f: Finding) => open[f.id] ?? f.severity === 'high';

  return (
    <div className="page findings2">
      <section className="fx-summary">
        <div className="fx-title">
          <p className="mono-label">Findings</p>
          <h1>
            {/* Info notes are listed but not counted as things to look at. */}
            {lookAt === 0 ? (all.length ? 'Nothing that needs a look.' : 'Nothing to flag.') : `${lookAt} thing${lookAt === 1 ? '' : 's'} to look at.`}
          </h1>
          <p className="fx-sub">
            {run.analysis.verdict.summary.replace(/\.$/, '')}. {passed.length} of {Object.keys(RULE_INFO).length} checks came back clean.
          </p>
        </div>
        <div className="fx-meters">
          {(['high', 'medium', 'low'] as Severity[]).map((s) => (
            <div key={s} className={`fx-meter ${s} ${sevCount(s) === 0 ? 'zero' : ''}`}>
              <span className="fx-meter-n">{sevCount(s)}</span>
              <span className="fx-meter-k">{SEV_LABEL[s]}</span>
              <span className="fx-meter-bar">
                <i style={{ width: all.length ? `${(sevCount(s) / all.length) * 100}%` : '0%' }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="fx-where">
        <p className="mono-label">Where in the run</p>
        <RunStrip onJump={(id) => nav.go(id)} height={26} />
        <div className="fx-where-legend">
          <span>
            <i className="rs-mark-l high" /> high
          </span>
          <span>
            <i className="rs-mark-l medium" /> medium
          </span>
          <span>step 1</span>
          <span style={{ marginLeft: 'auto' }}>step {run.trace.steps.length}</span>
        </div>
      </section>

      <div className="fx-layout">
        <nav className="fx-rules" aria-label="Filter by rule">
          <button aria-pressed={rule === 'all'} onClick={() => setRule('all')}>
            <span className="fx-rule-i">
              <Icon name="layers" size={14} />
            </span>
            All findings <span className="c">{all.length}</span>
          </button>
          {(Object.keys(RULE_INFO) as RuleId[])
            .filter((r) => counts.has(r))
            .map((r) => (
              <button key={r} aria-pressed={rule === r} onClick={() => setRule(r)}>
                <span className="fx-rule-i">
                  <Icon name={RULE_ICON[r]} size={14} />
                </span>
                {RULE_INFO[r].name} <span className="c">{counts.get(r)}</span>
              </button>
            ))}
          {passed.length > 0 && (
            <div className="fx-passed">
              <p className="mono-label">Passed</p>
              {passed.map((r) => (
                <span key={r} title={RULE_INFO[r].why}>
                  <Icon name="check" size={13} /> {RULE_INFO[r].name}
                </span>
              ))}
            </div>
          )}
        </nav>

        <div className="fx-list">
          {all.length === 0 && (
            <div className="fx-clean vf">
              <Icon name="shield" size={28} />
              <h2>All {Object.keys(RULE_INFO).length} checks came back clean.</h2>
              <p>No weakened tests, blind edits, failure loops, silenced errors, risky commands, leaked secrets or unsupported claims in this run.</p>
            </div>
          )}
          {list.map((f) => (
            <article key={f.id} className={`fx-card ${f.severity}`}>
              <div className="fx-card-top">
                <span className="fx-rule-tag">
                  <Icon name={RULE_ICON[f.rule]} size={13} /> {RULE_INFO[f.rule].name}
                </span>
                <span className={`fx-sev ${f.severity}`}>{SEV_LABEL[f.severity]}</span>
                <span className="fx-steps">
                  {f.steps.slice(0, 6).map((s) => (
                    <button key={s} className="step-chip" onClick={() => nav.go(s)}>
                      #{s + 1}
                    </button>
                  ))}
                  {f.steps.length > 6 && <span className="chip">+{f.steps.length - 6}</span>}
                </span>
              </div>
              <h3>
                <Rich text={f.title} />
              </h3>
              <p className="fx-detail">
                <Rich text={f.detail} />
              </p>
              <p className="fx-why">
                <Icon name="help" size={13} /> {RULE_INFO[f.rule].why}
              </p>
              {isOpen(f) && (
                <div className="fx-evidence">
                  {evidenceSteps(f).map((id) => {
                    const st = run.trace.steps[id];
                    return st ? <Evidence key={id} step={st} onOpen={(x) => nav.go(x)} /> : null;
                  })}
                </div>
              )}
              <div className="fx-card-foot">
                <button className="fx-toggle" onClick={() => setOpen((o) => ({ ...o, [f.id]: !isOpen(f) }))} aria-expanded={isOpen(f)}>
                  {isOpen(f) ? 'Hide evidence' : 'Show evidence'}
                </button>
                {f.files.slice(0, 3).map((p) =>
                  run.fileByPath.has(p) ? (
                    <button key={p} className="fx-file" onClick={() => nav.openFile(p)}>
                      <Icon name="code" size={12} /> {p}
                    </button>
                  ) : null,
                )}
                <button className="fx-go" onClick={() => nav.go(f.steps[f.steps.length - 1] ?? 0)}>
                  Open in replay <Icon name="next" size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
