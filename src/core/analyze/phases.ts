import type { Phase, PhaseKind, Step } from '../types';
import { isVerify, masksExitCode, outputLooksFailed } from './commands';

// Splits a run into chapters: Ask → Explore → Change → Verify → Repair → Report.
// Messages take the phase of the action they introduce (they are its intent),
// except the closing messages after the last action, which are the Report.

const ACTION = new Set(['read', 'search', 'edit', 'create', 'delete', 'command', 'web', 'subagent', 'tool', 'plan']);

export function labelSteps(steps: Step[]): PhaseKind[] {
  const labels: PhaseKind[] = new Array(steps.length).fill('explore');
  let changed = false;
  let lastVerifyFailed = false;
  const lastAction = findLastIndex(steps, (s) => ACTION.has(s.kind));

  steps.forEach((s, i) => {
    if (s.kind === 'prompt') {
      labels[i] = 'ask';
      return;
    }
    if (s.edit) {
      changed = true;
      labels[i] = lastVerifyFailed ? 'repair' : 'change';
      return;
    }
    if (s.command && isVerify(s.command.categories)) {
      labels[i] = 'verify';
      lastVerifyFailed = s.command.failed || outputLooksFailed(s.command.output);
      return;
    }
    if (s.kind === 'message' || s.kind === 'thinking') {
      labels[i] = i > lastAction ? 'report' : 'explore'; // fixed up below
      return;
    }
    labels[i] = changed ? (lastVerifyFailed ? 'repair' : 'change') : 'explore';
  });

  // Messages inherit the label of the next action (they announce it).
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if ((s.kind === 'message' || s.kind === 'thinking') && i < lastAction) {
      let j = i + 1;
      while (j < steps.length && (steps[j].kind === 'message' || steps[j].kind === 'thinking')) j++;
      if (j < steps.length && steps[j].kind !== 'prompt') labels[i] = labels[j];
      else labels[i] = 'report';
    }
  }
  // Reads/searches between verification and repair edits belong to the repair.
  return labels;
}

export function buildPhases(steps: Step[], labels: PhaseKind[]): Phase[] {
  const phases: Phase[] = [];
  let start = 0;
  for (let i = 1; i <= steps.length; i++) {
    if (i === steps.length || labels[i] !== labels[start]) {
      if (steps.length) phases.push({ kind: labels[start], from: start, to: i - 1, summary: '' });
      start = i;
    }
  }
  // Merge tiny chapters (one non-action step) into the previous one to keep the story readable.
  const merged: Phase[] = [];
  for (const p of phases) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === p.kind) {
      prev.to = p.to;
      continue;
    }
    merged.push({ ...p });
  }
  for (const p of merged) p.summary = summarize(steps.slice(p.from, p.to + 1), p.kind);
  return merged;
}

function summarize(steps: Step[], kind: PhaseKind): string {
  const reads = new Set(steps.filter((s) => s.read).map((s) => s.read!.path));
  const searches = steps.filter((s) => s.kind === 'search').length;
  const edited = new Set(steps.filter((s) => s.edit).map((s) => s.edit!.path));
  const added = steps.reduce((n, s) => n + (s.edit?.added ?? 0), 0);
  const removed = steps.reduce((n, s) => n + (s.edit?.removed ?? 0), 0);
  const cmds = steps.filter((s) => s.command && s.kind === 'command');
  const failed = cmds.filter((s) => s.command!.failed || outputLooksFailed(s.command!.output)).length;
  const parts: string[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  switch (kind) {
    case 'ask': {
      const p = steps.find((s) => s.kind === 'prompt');
      if (!p) return 'New instruction';
      return p.title.startsWith('Background task finished') ? p.title : `Asked: “${p.title}”`;
    }
    case 'report': {
      const m = [...steps].reverse().find((s) => s.kind === 'message');
      return m ? `Reported: “${m.title}”` : 'Wrapped up';
    }
    case 'verify': {
      if (!cmds.length) return 'Checked its work';
      // A pass whose exit code a pipe hid is not the same as a pass.
      const hidden = cmds.filter((s) => !s.command!.failed && !outputLooksFailed(s.command!.output) && masksExitCode(s.command!.cmd)).length;
      const passed = cmds.length - failed - hidden;
      const out = [passed ? `${passed} passed` : '', hidden ? `${hidden} passed (exit hidden)` : '', failed ? `${failed} failed` : ''].filter(Boolean);
      return `Ran ${plural(cmds.length, 'check')}: ${out.join(', ')}`;
    }
    default:
      if (reads.size) parts.push(`read ${plural(reads.size, 'file')}`);
      if (searches) parts.push(`ran ${plural(searches, 'search')}`);
      if (edited.size) parts.push(`edited ${plural(edited.size, 'file')} (+${added} −${removed})`);
      if (cmds.length) parts.push(`ran ${plural(cmds.length, 'command')}${failed ? ` (${failed} failed)` : ''}`);
      if (!parts.length) parts.push(plural(steps.length, 'step'));
      return cap(parts.join(', '));
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function findLastIndex<T>(arr: T[], fn: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i;
  return -1;
}
