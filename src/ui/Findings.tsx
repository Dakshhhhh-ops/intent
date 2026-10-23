import { useState } from 'react';
import { RULE_INFO } from '../core/analyze/rules';
import type { RuleId, Severity } from '../core/types';
import { Icon } from './Icon';
import { Rich } from './Rich';
import { useNav, useRun } from './model';

const SEV_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };

export function Findings() {
  const run = useRun();
  const nav = useNav();
  const [rule, setRule] = useState<RuleId | 'all'>('all');
  const all = run.analysis.findings;
  const counts = new Map<RuleId, number>();
  for (const f of all) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  const list = rule === 'all' ? all : all.filter((f) => f.rule === rule);

  return (
    <div className="page">
      <div className="findings-layout">
        <nav className="rule-filter" aria-label="Filter by rule">
          <button aria-pressed={rule === 'all'} onClick={() => setRule('all')}>
            All findings <span className="c">{all.length}</span>
          </button>
          {(Object.keys(RULE_INFO) as RuleId[])
            .filter((r) => counts.has(r))
            .map((r) => (
              <button key={r} aria-pressed={rule === r} onClick={() => setRule(r)}>
                {RULE_INFO[r].name} <span className="c">{counts.get(r)}</span>
              </button>
            ))}
        </nav>
        <div>
          {all.length === 0 && (
            <div className="panel">
              <div className="empty">
                <Icon name="shield" size={22} style={{ color: 'var(--ok)' }} />
                <div style={{ marginTop: 8 }}>No findings. Every rule below ran and came back clean.</div>
              </div>
            </div>
          )}
          {(['high', 'medium', 'low', 'info'] as Severity[]).map((sev) => {
            const group = list.filter((f) => f.severity === sev);
            if (!group.length) return null;
            return (
              <section key={sev} className="sev-group">
                <h2>
                  <span className={`sev-dot ${sev}`} /> {SEV_LABEL[sev]} · {group.length}
                </h2>
                {group.map((f) => (
                  <article key={f.id} className="finding">
                    <span className={`sev-dot ${f.severity}`} />
                    <h3>
                      <Rich text={f.title} />
                    </h3>
                    <p className="d">
                      <Rich text={f.detail} />
                    </p>
                    <div className="refs">
                      <span className="rule-name" title={RULE_INFO[f.rule].why}>
                        {RULE_INFO[f.rule].name}
                      </span>
                      {f.steps.slice(0, 12).map((s) => (
                        <button key={s} className="step-chip" onClick={() => nav.go(s)}>
                          #{s + 1}
                        </button>
                      ))}
                      {f.steps.length > 12 && <span className="chip">+{f.steps.length - 12}</span>}
                      {f.files.slice(0, 4).map((p) =>
                        run.fileByPath.has(p) ? (
                          <button key={p} className="chip" onClick={() => nav.openFile(p)}>
                            <Icon name="file" size={11} /> {p}
                          </button>
                        ) : null,
                      )}
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
          <section className="panel" style={{ marginTop: 26 }}>
            <div className="panel-head">
              <h2>
                <Icon name="shield" /> What Intent Replay checks
              </h2>
              <span className="hint">Deterministic rules · no AI · nothing leaves your machine</span>
            </div>
            <div className="rules-explainer" style={{ padding: 16, marginTop: 0 }}>
              {(Object.keys(RULE_INFO) as RuleId[]).map((r) => (
                <div key={r}>
                  <b>{RULE_INFO[r].name}.</b> {RULE_INFO[r].why} {counts.has(r) ? '' : <span style={{ color: 'var(--ok)' }}>✓ clean</span>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
