import { useEffect, useRef } from 'react';
import { RULE_INFO } from '../../core/analyze/rules';
import type { Analysis, RuleId } from '../../core/types';
import { Icon } from '../Icon';
import { gsap } from './useHomeMotion';

// A cinematic "product shot": real fragments of the viewer laid on a tilted 3D plane, with the
// far panels out of focus. Scrolling straightens the plane and pulls everything into focus.

export function ProductShowcase({ analysis, bars }: { analysis: Analysis; bars: { c: string; h: number }[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    const pl = plane.current;
    if (!el || !pl || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        pl,
        { rotateX: 46, rotateZ: -12, scale: 0.84, yPercent: 6 },
        { rotateX: 0, rotateZ: 0, scale: 1, yPercent: 0, ease: 'none', scrollTrigger: { trigger: el, start: 'top 85%', end: 'center 45%', scrub: 0.6 } },
      );
      pl.querySelectorAll<HTMLElement>('[data-depth]').forEach((p) => {
        const d = Number(p.dataset.depth);
        gsap.fromTo(
          p,
          { z: d * 60, filter: `blur(${Math.abs(d) * 2.2}px)` },
          { z: 0, filter: 'blur(0px)', ease: 'none', scrollTrigger: { trigger: el, start: 'top 85%', end: 'center 45%', scrub: 0.6 } },
        );
      });
    }, el);
    return () => ctx.revert();
  }, []);

  const sev = (s: string) => analysis.findings.filter((f) => f.severity === s).length;
  const claim = analysis.claims.find((c) => c.kind === 'tests-pass' && c.verdict === 'contradicted') ?? analysis.claims[0];

  return (
    <div className="pv-stage" ref={stage}>
      <div className="pv-plane" ref={plane}>
        <div className="pv-panel pv-replay" data-depth="-2">
          <div className="pv-bar">
            <span className="mono-label">Replay</span>
            <span className="pv-pos">STEP 12 / 17</span>
          </div>
          <div className="pv-tape">
            {['Talk', 'Read', 'Change', 'Run'].map((l, li) => (
              <div key={l} className="pv-lane">
                <span>{l}</span>
                <div>
                  {bars.map((b, i) => (
                    <i key={i} style={{ background: (i + li) % 4 === 0 ? b.c : 'transparent' }} />
                  ))}
                </div>
              </div>
            ))}
            <span className="pv-playhead" />
          </div>
          <div className="pv-why">
            <span className="mono-label">Why — what the agent said</span>
            <q>Same failures. The discount tests expect exact cent values… I’ll update the test to match.</q>
          </div>
        </div>

        <div className="pv-panel pv-claim" data-depth="1">
          <span className="stamp contradicted">Contradicted</span>
          <q>{claim ? claim.text.replace(/`/g, '') : 'All tests pass.'}</q>
          <p>{claim ? claim.explanation : 'The last full test run failed.'}</p>
        </div>

        <div className="pv-panel pv-blame" data-depth="0">
          <span className="mono-label">Blame · test/cart.test.js</span>
          <div className="pv-diff">
            <div className="del">
              <b>#14</b>− assert.equal(total, 53.97);
            </div>
            <div className="add">
              <b>#14</b>+ assert.equal(total, 54);
            </div>
          </div>
          <div className="pv-bubble">
            <Icon name="alert" size={13} /> Written right after a failing run · file was read first
          </div>
        </div>

        <div className="pv-panel pv-meters" data-depth="2">
          <span className="mono-label">Findings</span>
          <div>
            <span className="h">
              {sev('high')}
              <small>high</small>
            </span>
            <span className="m">
              {sev('medium')}
              <small>medium</small>
            </span>
            <span className="l">
              {sev('low')}
              <small>low</small>
            </span>
          </div>
        </div>

        <div className="pv-panel pv-compare" data-depth="-1">
          <span className="mono-label">Compare</span>
          <div className="pv-cmp">
            <span />
            <b>Claude Code</b>
            <b>Codex CLI</b>
            <span>Read first</span>
            <i className="ok">3 files</i>
            <i className="ok">3 files</i>
            <span>Verified</span>
            <i className="ok">yes</i>
            <i className="ok">yes</i>
            <span>Claims</span>
            <i className="ok">1 supported</i>
            <i className="ok">1 supported</i>
          </div>
        </div>

        <div className="pv-panel pv-live" data-depth="1">
          <span className="live-pill">
            <span className="dot" /> Live
          </span>
          <p>
            <code>intent-replay watch</code>
            <br />
            follows the session while the agent writes it.
          </p>
        </div>

        <div className="pv-panel pv-rules" data-depth="-2">
          <span className="mono-label">12 checks on every run</span>
          <div>
            {(Object.keys(RULE_INFO) as RuleId[]).map((r) => (
              <span key={r}>{RULE_INFO[r].name}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
