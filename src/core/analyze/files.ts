import { diffArrays } from 'diff';
import type { BlameLine, DiffLine, FileChange, Step, StringEdit } from '../types';
import { isTestFile, splitLines } from '../util';

// Rebuilds every file the agent touched, step by step, and remembers which step
// wrote each line. Full reads and `originalFile` snapshots seed the content;
// edits are replayed on top. When the log doesn't have enough to place an edit,
// the file falls back to hunk-level attribution and is marked partial.

export const EXTERNAL = -1;

interface Tracked {
  path: string;
  reads: number[];
  edits: number[];
  created: boolean;
  deleted: boolean;
  original: string | null;
  lines: BlameLine[] | null;
  partial: boolean;
  churned: number;
  churnSteps: Set<number>;
  hunks: DiffLine[];
  removedOriginal: Map<string, number[]>;
  added: number;
  removed: number;
}

export interface FileTracking {
  changed: FileChange[];
  /** Every path the agent read or changed, with step ids. */
  touched: { path: string; reads: number[]; edits: number[] }[];
  /** For each step id, which paths had been read (fully or partly) before it. */
  readBefore: (stepId: number) => Set<string>;
}

export function trackFiles(steps: Step[]): FileTracking {
  const files = new Map<string, Tracked>();
  const readLog: { step: number; path: string }[] = [];

  const get = (path: string): Tracked => {
    let f = files.get(path);
    if (!f) {
      f = {
        path, reads: [], edits: [], created: false, deleted: false, original: null, lines: null,
        partial: false, churned: 0, churnSteps: new Set(), hunks: [], removedOriginal: new Map(), added: 0, removed: 0,
      };
      files.set(path, f);
    }
    return f;
  };

  const seed = (f: Tracked, content: string) => {
    f.lines = splitLines(content).map((text) => ({ text, step: null }));
    if (f.original === null && f.edits.length === 0) f.original = content;
  };

  const propagate = (f: Tracked, newText: string, step: number) => {
    const old = f.lines ?? [];
    const next = splitLines(newText);
    const changes = diffArrays(old.map((l) => l.text), next);
    const out: BlameLine[] = [];
    let oi = 0;
    for (const ch of changes) {
      if (ch.added) {
        for (const v of ch.value) out.push({ text: v, step });
      } else if (ch.removed) {
        for (let k = 0; k < ch.value.length; k++) {
          const gone = old[oi++];
          if (!gone) continue;
          if (gone.step !== null && gone.step >= 0 && step >= 0) {
            f.churned++;
            f.churnSteps.add(gone.step);
          } else if (gone.step === null) {
            const q = f.removedOriginal.get(gone.text) ?? [];
            q.push(step);
            f.removedOriginal.set(gone.text, q);
          }
        }
      } else {
        for (let k = 0; k < ch.value.length; k++) out.push(old[oi++]);
      }
    }
    f.lines = out;
  };

  const fallbackHunks = (f: Tracked, s: Step) => {
    const e = s.edit!;
    f.hunks.push({ type: 'hunk', text: `${s.title}`, step: s.id });
    if (e.patch) {
      for (const l of e.patch.split('\n')) {
        if (l.startsWith('@@')) continue;
        if (l.startsWith('+')) f.hunks.push({ type: 'add', text: l.slice(1), step: s.id });
        else if (l.startsWith('-')) f.hunks.push({ type: 'del', text: l.slice(1), step: s.id });
        else f.hunks.push({ type: 'ctx', text: l.startsWith(' ') ? l.slice(1) : l, step: null });
      }
    } else if (e.edits) {
      for (const ed of e.edits) {
        for (const l of splitLines(ed.oldString)) f.hunks.push({ type: 'del', text: l, step: s.id });
        for (const l of splitLines(ed.newString)) f.hunks.push({ type: 'add', text: l, step: s.id });
      }
    } else if (e.after !== undefined) {
      for (const l of splitLines(e.after)) f.hunks.push({ type: 'add', text: l, step: s.id });
    }
  };

  for (const s of steps) {
    // Shell commands like `sed -n 1,40p a.ts && cat b.ts` read every file they name.
    if (s.command && !s.command.failed && !s.edit) {
      for (const p of s.files) {
        if (p === s.read?.path) continue;
        const f = get(p);
        f.reads.push(s.id);
        readLog.push({ step: s.id, path: p });
      }
    }
    // Files written through the shell: the agent produced them, but their content is unknown to us.
    if (s.command?.writes?.length && !s.command.failed) {
      for (const p of s.command.writes) {
        const f = get(p);
        readLog.push({ step: s.id, path: p });
        if (f.lines !== null) {
          f.lines = null;
          f.partial = f.edits.length > 0 || f.partial;
        }
      }
    }
    if (s.read?.path) {
      const f = get(s.read.path);
      f.reads.push(s.id);
      readLog.push({ step: s.id, path: s.read.path });
      if (s.read.content !== undefined && s.read.full) {
        if (f.lines === null) seed(f, s.read.content);
        else if (joined(f.lines) !== normalize(s.read.content) && !f.deleted) propagate(f, s.read.content, EXTERNAL);
      }
    }
    const e = s.edit;
    if (!e || !e.path) continue;
    const f = get(e.path);
    f.edits.push(s.id);
    f.added += e.added;
    f.removed += e.removed;

    if (e.opaque) {
      f.partial = true;
      fallbackHunks(f, s);
      continue;
    }

    if (e.op === 'delete') {
      f.deleted = true;
      if (f.lines !== null) propagate(f, '', s.id);
      else fallbackHunks(f, s);
      continue;
    }

    if (e.op === 'create' && e.after !== undefined) {
      if (f.lines === null) {
        if (f.edits.length === 1 && f.reads.length === 0) {
          f.created = true;
          f.original = '';
        }
        f.lines = [];
      }
      propagate(f, e.after, s.id);
      continue;
    }

    // update
    if (e.before !== undefined) {
      if (f.lines === null) {
        f.lines = splitLines(e.before).map((text) => ({ text, step: null }));
        if (f.original === null && f.edits.length === 1) f.original = e.before;
      } else if (joined(f.lines) !== normalize(e.before)) {
        propagate(f, e.before, EXTERNAL);
      }
    }

    if (e.after !== undefined) {
      // Full overwrite (Write on an existing file).
      if (f.lines === null) {
        f.partial = f.original === null;
        f.lines = [];
      }
      propagate(f, e.after, s.id);
      continue;
    }

    if (f.lines === null) {
      f.partial = true;
      fallbackHunks(f, s);
      continue;
    }

    const cur = joined(f.lines);
    let next: string | null = null;
    if (e.edits?.length) next = applyStringEdits(cur, e.edits);
    else if (e.patch) next = applyPatch(cur, e.patch);
    if (next === null) {
      f.partial = true;
      fallbackHunks(f, s);
      continue;
    }
    propagate(f, next, s.id);
  }

  const changed: FileChange[] = [];
  for (const f of files.values()) {
    if (!f.edits.length) continue;
    changed.push(finish(f));
  }
  changed.sort((a, b) => a.edits[0] - b.edits[0]);

  const touched = [...files.values()].map((f) => ({ path: f.path, reads: f.reads, edits: f.edits }));
  const readBefore = (stepId: number) => {
    const set = new Set<string>();
    for (const r of readLog) {
      if (r.step >= stepId) break;
      set.add(r.path);
    }
    return set;
  };
  return { changed, touched, readBefore };
}

function finish(f: Tracked): FileChange {
  const reconstructed = f.original !== null && f.lines !== null && !f.partial;
  let diff: DiffLine[];
  let added = f.added;
  let removed = f.removed;
  if (reconstructed) {
    const final = f.lines!;
    const orig = splitLines(f.original!);
    const changes = diffArrays(orig, final.map((l) => l.text));
    const full: DiffLine[] = [];
    let oi = 0;
    let ni = 0;
    added = 0;
    removed = 0;
    for (const ch of changes) {
      for (const v of ch.value) {
        if (ch.added) {
          full.push({ type: 'add', text: v, step: final[ni]?.step ?? null, newNo: ni + 1 });
          ni++;
          added++;
        } else if (ch.removed) {
          const q = f.removedOriginal.get(v);
          full.push({ type: 'del', text: v, step: q?.length ? q.shift()! : null, oldNo: oi + 1 });
          oi++;
          removed++;
        } else {
          full.push({ type: 'ctx', text: v, step: final[ni]?.step ?? null, oldNo: oi + 1, newNo: ni + 1 });
          oi++;
          ni++;
        }
      }
    }
    diff = withContext(full, 3);
  } else {
    diff = f.hunks.length ? f.hunks : [];
    if (!diff.length && f.lines) diff = f.lines.map((l, i) => ({ type: l.step !== null ? 'add' : 'ctx', text: l.text, step: l.step, newNo: i + 1 }));
  }
  return {
    path: f.path,
    reads: f.reads,
    edits: f.edits,
    created: f.created,
    deleted: f.deleted,
    reconstructed,
    partial: f.partial,
    added,
    removed,
    original: f.original,
    final: f.lines,
    diff,
    isTest: isTestFile(f.path),
    flags: [],
    churned: f.churned,
  };
}

/** Keep `n` lines of context around changes and insert hunk separators. */
export function withContext(lines: DiffLine[], n: number): DiffLine[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.type === 'add' || l.type === 'del') {
      for (let k = Math.max(0, i - n); k <= Math.min(lines.length - 1, i + n); k++) keep[k] = true;
    }
  });
  const out: DiffLine[] = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap || (out.length === 0 && i > 0)) {
        out.push({ type: 'hunk', text: `@@ line ${l.newNo ?? l.oldNo ?? i + 1} @@`, step: null });
      }
      out.push(l);
      gap = false;
    } else gap = true;
  });
  return out;
}

function normalize(s: string): string {
  return splitLines(s).join('\n');
}

function joined(lines: BlameLine[]): string {
  return lines.map((l) => l.text).join('\n');
}

export function applyStringEdits(content: string, edits: StringEdit[]): string | null {
  let cur = content;
  for (const e of edits) {
    const oldS = normalize(e.oldString);
    const newS = normalize(e.newString);
    if (oldS === '') {
      cur = cur ? `${cur}\n${newS}` : newS;
      continue;
    }
    if (e.replaceAll) {
      if (!cur.includes(oldS)) return null;
      cur = cur.split(oldS).join(newS);
      continue;
    }
    const idx = cur.indexOf(oldS);
    if (idx < 0) return null;
    cur = cur.slice(0, idx) + newS + cur.slice(idx + oldS.length);
  }
  return cur;
}

interface Hunk {
  oldStart: number | null;
  oldSeq: string[];
  newSeq: string[];
}

function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const raw of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
      cur = { oldStart: m ? Number(m[1]) : null, oldSeq: [], newSeq: [] };
      hunks.push(cur);
      continue;
    }
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('\\ No newline')) continue;
    if (!cur) {
      cur = { oldStart: null, oldSeq: [], newSeq: [] };
      hunks.push(cur);
    }
    if (raw.startsWith('+')) cur.newSeq.push(raw.slice(1));
    else if (raw.startsWith('-')) cur.oldSeq.push(raw.slice(1));
    else {
      const t = raw.startsWith(' ') ? raw.slice(1) : raw;
      cur.oldSeq.push(t);
      cur.newSeq.push(t);
    }
  }
  // Trailing empty context produced by a final newline is noise.
  for (const h of hunks) {
    while (h.oldSeq.length && h.newSeq.length && h.oldSeq[h.oldSeq.length - 1] === '' && h.newSeq[h.newSeq.length - 1] === '') {
      h.oldSeq.pop();
      h.newSeq.pop();
    }
  }
  return hunks;
}

/** Applies a unified diff or apply_patch body. Returns null when a hunk can't be placed. */
export function applyPatch(content: string, patch: string): string | null {
  const lines = splitLines(content);
  let cursor = 0;
  let offset = 0;
  for (const h of parseHunks(patch)) {
    if (!h.oldSeq.length) {
      const at = h.oldStart !== null ? Math.min(lines.length, h.oldStart + offset) : lines.length;
      lines.splice(at, 0, ...h.newSeq);
      offset += h.newSeq.length;
      cursor = at + h.newSeq.length;
      continue;
    }
    let pos = -1;
    if (h.oldStart !== null) {
      const guess = h.oldStart - 1 + offset;
      if (matchAt(lines, h.oldSeq, guess)) pos = guess;
    }
    if (pos < 0) pos = find(lines, h.oldSeq, cursor);
    if (pos < 0) pos = find(lines, h.oldSeq, 0);
    if (pos < 0) return null;
    lines.splice(pos, h.oldSeq.length, ...h.newSeq);
    offset += h.newSeq.length - h.oldSeq.length;
    cursor = pos + h.newSeq.length;
  }
  return lines.join('\n');
}

function matchAt(lines: string[], seq: string[], at: number, loose = false): boolean {
  if (at < 0 || at + seq.length > lines.length) return false;
  for (let i = 0; i < seq.length; i++) {
    const a = lines[at + i];
    const b = seq[i];
    if (loose ? a.trimEnd() !== b.trimEnd() : a !== b) return false;
  }
  return true;
}

function find(lines: string[], seq: string[], from: number): number {
  for (const loose of [false, true]) {
    for (let i = from; i + seq.length <= lines.length; i++) if (matchAt(lines, seq, i, loose)) return i;
  }
  return -1;
}
