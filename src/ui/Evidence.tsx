import type { Step } from '../core/types';
import { masksExitCode, outputLooksFailed, shellCode } from '../core/analyze/commands';
import { stepDiff } from './DiffView';
import { Icon, KIND_ICON } from './Icon';
import { kindColor } from './RunStrip';

// A compact, read-only preview of one step, used as evidence under findings and claims.

const FAIL_LINE = /\b(fail(ed|ing|ure)?|error|not ok|assert(ion)?error|expected|traceback|exception)\b|[✖✗×]|!==/i;

const TELLING = /\b(fail(ed|ing|ure)?|error|ERR_\w+|actual|expected|not ok|assert\w*|traceback|exception|tests?\s+\d+|pass\s+\d+|fail\s+\d+)\b|[✖✗×]|!==/i;

/** The lines that tell the story: failures and counts first, then the tail of the output. */
function pickLines(output: string, max: number): string[] {
  const lines = output.split(/\r?\n/).filter((l) => l.trim() && !/^\s*at\s/.test(l));
  const telling = lines.filter((l) => TELLING.test(l) && !/\b0 (fail|error)/i.test(l));
  const out = telling.slice(0, max);
  for (const l of lines.slice(-max)) {
    if (out.length >= max) break;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

/** The pipe that swallowed a command's exit code (`| tail`, `|| true`), if any. */
function maskingPipe(cmd: string): string | null {
  if (!masksExitCode(cmd)) return null;
  const code = shellCode(cmd);
  const m = code.match(/\|\|\s*(true|exit 0|:)|\|\s*(head|tail|grep|tee|Select-Object|select|more|less|sort|wc)\b/i);
  return m ? (m[1] ? `|| ${m[1]}` : `| ${m[2]}`) : 'a pipe';
}

export function Evidence({ step, onOpen }: { step: Step; onOpen: (id: number) => void }) {
  const head = (
    <button className="ev-head" onClick={() => onOpen(step.id)} title="Open this step in the replay">
      <span className="ev-kind" style={{ color: kindColor(step) }}>
        <Icon name={KIND_ICON[step.kind]} size={13} />
      </span>
      <span className="ev-step">#{step.id + 1}</span>
      <span className="ev-title">{step.title}</span>
      <span className="ev-go">
        Replay <Icon name="next" size={12} />
      </span>
    </button>
  );

  if (step.command) {
    const c = step.command;
    const lines = pickLines(c.output, 5);
    const hiddenBy = !c.failed && outputLooksFailed(c.output) ? maskingPipe(c.cmd) : null;
    return (
      <div className="ev">
        {head}
        <div className="ev-term">
          <div className="ev-cmd">
            <span>$</span> {c.cmd}
            {hiddenBy ? (
              <span className="ev-exit masked" title="The command exited 0 only because the pipe hid the real exit code; the output shows failures.">
                <s>exit {c.exitCode ?? 0}</s> · hidden by {hiddenBy}
              </span>
            ) : (
              <span className={`ev-exit ${c.failed ? 'bad' : 'ok'}`}>exit {c.exitCode ?? '?'}</span>
            )}
          </div>
          {lines.map((l, i) => (
            <div key={i} className={FAIL_LINE.test(l) ? 'ev-fail' : undefined}>
              {l.length > 160 ? l.slice(0, 158) + '…' : l}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (step.edit) {
    const lines = stepDiff(step.edit, step.id)
      .filter((l) => l.type !== 'hunk')
      .slice(0, 8);
    return (
      <div className="ev">
        {head}
        <div className="ev-diff">
          {lines.map((l, i) => (
            <div key={i} className={l.type}>
              <span>{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
              {l.text || ' '}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (step.text && (step.kind === 'message' || step.kind === 'prompt')) {
    return (
      <div className="ev">
        {head}
        <blockquote className="ev-quote">{step.text.length > 320 ? step.text.slice(0, 318) + '…' : step.text}</blockquote>
      </div>
    );
  }
  return <div className="ev">{head}</div>;
}
