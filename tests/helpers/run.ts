// Builds normalized Step timelines directly, for analyzer tests that don't need a parser.
import type { CommandInfo, EditInfo, Finding, RuleId, Step, Trace } from '../../src/core/types';
import { classifyCommand, shellReadTargets, shellWriteTargets } from '../../src/core/analyze/commands';
import { analyze } from '../../src/core/analyze';
import { countLines, countPatch } from '../../src/core/util';

type StepInit = Omit<Step, 'id' | 'turn' | 't' | 'actor' | 'title' | 'files'> & Partial<Step>;

export interface CmdOpts {
  exit?: number | null;
  output?: string;
  failed?: boolean;
  files?: string[];
  writes?: string[];
}

export class Run {
  steps: Step[] = [];
  private turn = 0;

  private add(s: StepInit): number {
    const step: Step = { t: null, actor: 'agent', title: s.kind, files: [], ...s, id: this.steps.length, turn: this.turn };
    this.steps.push(step);
    return step.id;
  }

  prompt(text: string): number {
    this.turn++;
    return this.add({ kind: 'prompt', actor: 'user', text, title: text });
  }

  say(text: string, actor: 'agent' | 'subagent' = 'agent'): number {
    return this.add({ kind: 'message', actor, text, title: text });
  }

  think(text: string): number {
    return this.add({ kind: 'thinking', text, title: text });
  }

  read(path: string, content?: string, full = true): number {
    return this.add({ kind: 'read', title: `Read ${path}`, files: [path], read: { path, full, content } });
  }

  /** Claude Code style Edit / MultiEdit: string replacements, no full content. */
  edit(path: string, oldString: string, newString: string, opts: { replaceAll?: boolean; before?: string; patch?: string } = {}): number {
    return this.editMany(path, [[oldString, newString]], opts);
  }

  editMany(path: string, pairs: [string, string][], opts: { replaceAll?: boolean; before?: string; patch?: string } = {}): number {
    const edits = pairs.map(([oldString, newString]) => ({ oldString, newString, replaceAll: opts.replaceAll }));
    const edit: EditInfo = {
      path,
      op: 'update',
      edits,
      before: opts.before,
      patch: opts.patch,
      added: edits.reduce((n, e) => n + countLines(e.newString), 0),
      removed: edits.reduce((n, e) => n + countLines(e.oldString), 0),
    };
    return this.add({ kind: 'edit', title: `Edit ${path}`, files: [path], edit });
  }

  /** Codex style unified diff / apply_patch body. */
  patch(path: string, patch: string): number {
    const c = countPatch(patch);
    return this.add({ kind: 'edit', title: `Edit ${path}`, files: [path], edit: { path, op: 'update', patch, ...c } });
  }

  write(path: string, content: string, op: 'create' | 'update' = 'create', before?: string): number {
    return this.add({
      kind: op === 'create' ? 'create' : 'edit',
      title: `Write ${path}`,
      files: [path],
      edit: { path, op, after: content, before, added: countLines(content), removed: before ? countLines(before) : 0 },
    });
  }

  del(path: string): number {
    return this.add({ kind: 'delete', title: `Delete ${path}`, files: [path], edit: { path, op: 'delete', added: 0, removed: 0 } });
  }

  opaque(path: string): number {
    return this.add({ kind: 'edit', title: `Edit ${path}`, files: [path], edit: { path, op: 'update', opaque: true, added: 1, removed: 0 } });
  }

  cmd(cmd: string, opts: CmdOpts = {}): number {
    const exitCode = opts.exit === undefined ? 0 : opts.exit;
    const failed = opts.failed ?? (exitCode !== null && exitCode !== 0);
    const command: CommandInfo = {
      cmd,
      exitCode,
      failed,
      output: opts.output ?? '',
      categories: classifyCommand(cmd),
      writes: opts.writes ?? shellWriteTargets(cmd),
    };
    return this.add({ kind: 'command', title: cmd, files: opts.files ?? shellReadTargets(cmd), command, error: failed });
  }

  trace(): Trace {
    return { id: 'test', source: 'intent-trace', title: 'test run', steps: this.steps, warnings: [], skippedRecords: 0 };
  }

  analyze() {
    return analyze(this.trace());
  }
}

export function findingsOf(run: Run, rule?: RuleId): Finding[] {
  const all = run.analyze().findings;
  return rule ? all.filter((f) => f.rule === rule) : all;
}

/** Multi-line text from lines (no trailing newline). */
export const L = (...lines: string[]) => lines.join('\n');
