---
doc: prd
status: approved
---

# Intent Replay — Product Requirements

A local-first replay and audit tool for developers who need to decide whether to trust what an AI coding agent did to their repo.
Source: `scope.md > The Unique Kernel`, `scope.md > Who It's For`.

## The Core Journey

1. **Arrive.** The developer runs `npx intent-replay` in their project (or opens the web app). The CLI lists recent Claude Code and Codex sessions for this folder, newest first, and opens the chosen one in the browser. In the web app they drop a `.jsonl` file or pick a sample run.
2. **Read the Brief (10 seconds).** A header shows the task the agent was given, which agent/model, duration, steps, files changed, commands run and failed. Below it:
   - **Verdict**: one line, e.g. "Needs review — 2 high, 3 medium findings".
   - **Claim check**: each claim from the agent's final summary ("all tests pass", "only changed `cart.js`") stamped *Supported*, *Contradicted*, *Unverified* or *Stale*, with the evidence step.
   - **Review first**: the few changes and findings worth a human's attention, ranked.
   - **The story**: the run split into chapters (Explore → Change → Verify → Repair → Report), each a sentence with counts.
3. **Drill into a finding.** Clicking any finding, claim or review item jumps to the Replay at the step that proves it.
4. **Replay.** The tape (a timeline with lanes for messages, reads, edits and commands) has a playhead. The developer scrubs, steps with the keyboard, or presses play. The inspector shows the current step in full: the agent's stated intent, the diff or command output, and **context at this moment** — what had been read, what had last failed, which instruction was in force. A file map lights up files as they're read and edited.
5. **Inspect a change.** In Changes, each edited file shows its net diff with a blame gutter. Clicking an added line shows the step that wrote it, the reason given, and the evidence the agent had (did it read this file first? what failed just before?).
6. **Act.** Export a Markdown report for the PR, a self-contained HTML replay to share, or run `intent-replay check` in CI to fail on high-severity findings.

Success: the developer can answer "why did it change this, and was its summary true?" without reading the raw transcript.

## Screens and Layout

- **Home** — drop zone, "open file" button, the three sample runs as cards (each with its verdict), and how to use the CLI. When launched from the CLI: the list of local sessions for the folder.
- **Run view** — persistent header (task, agent, stats, verdict, export menu) and four tabs:
  - **Brief** — verdict, claim check, review-first list, story chapters.
  - **Replay** — tape across the top, step list on the left, inspector in the middle, context + file map on the right.
  - **Changes** — file list with +/− counts and flags on the left, blame diff on the right, "why" drawer for a selected line.
  - **Findings** — all findings grouped by severity, filterable by rule, each linking to steps and files.
- **Keyboard help** overlay (`?`).
- On narrow screens the panes stack; the tape stays usable.

## Look and Feel

Flight-recorder / instrument-panel. Dark by default (near-black blue-grey, not pure black), light theme available and following system preference. One accent for the playhead and focus; semantic colors only where they mean something: reads blue, edits amber, creates green, deletes/failures red, agent messages neutral. Sans (Inter-like) for UI, monospace for paths, commands and code. Dense but calm: like a good debugger, not a marketing site. Small motion that explains (playhead moving, files lighting up), nothing decorative. Copy is plain and specific: "Edited `src/cart.js` without reading it first", never "Potential issue detected".

## Features and Behavior

### Import

- Accepts Claude Code session logs (`~/.claude/projects/<project>/<session>.jsonl`), Codex rollout logs (`~/.codex/sessions/**/rollout-*.jsonl`) and Intent Trace JSON. Format is auto-detected.
- Sub-agent (side-chain) activity is kept but marked.
- Paths are shown relative to the run's working directory.
- Secrets that appear in commands or output (API keys, tokens, private keys) are masked in the UI and in every export.
- As a developer, I want to drop any agent log and see it, so that I don't have to learn a format.
  - [ ] A Claude Code JSONL and a Codex JSONL both load and show a timeline.
  - [ ] An unrecognized file shows a clear message saying which formats are supported.

### The timeline model

Every run becomes an ordered list of steps. Kinds: prompt (user), message (agent text), thinking (when readable), plan (todo lists), read, search, edit, create, delete, command, web, subagent, other tool. Each step carries timestamp, the agent's **intent** (the agent's most recent words before acting), files touched and raw details.

### Change attribution (the kernel, part 1)

- For every file the agent changed, reconstruct its content step by step where the log allows and tag each line with the step that last wrote it. Where only patch hunks are known (e.g. Codex), attribute at hunk level.
- Show net diff per file (original vs final) with the blame gutter.
- Per file: times read, times edited, first read vs first edit, net +/−, flags.
- As a reviewer, I want to click a changed line and see why it was written, so that I can judge it without the transcript.
  - [ ] Clicking an added line opens the step that wrote it, its intent text, and the files read before it.

### Claim check (the kernel, part 2)

- Extract claims from the agent's messages after its last edit (its summary): tests pass, build/typecheck passes, lint clean, bug fixed/verified, "only changed X", "didn't touch tests", "ran X".
- Verdicts:
  - **Supported** — a matching command ran after the last relevant edit and succeeded.
  - **Contradicted** — the evidence says otherwise (last matching run failed; it did change tests; it changed other files).
  - **Stale** — it passed, but the code changed afterwards.
  - **Unverified** — nothing in the run supports or refutes it.
- Each verdict links to its evidence step.

### Findings

Deterministic rules, each with severity, plain explanation and linked steps:

| Rule | Severity | Fires when |
|---|---|---|
| Weakened tests | high | a test file edit removes assertions, adds skip/only, or loosens an expected value — especially right after a failing test run |
| Contradicted claim | high | any claim verdict is Contradicted |
| Blind edit | medium | a file was modified without being read earlier in the run |
| Failure loop | medium | the same command failed 3+ times |
| Silenced errors | medium | added `@ts-ignore`, `eslint-disable`, `# type: ignore`, `except: pass`, empty catch, `as any` |
| Risky command | high/medium | `rm -rf`, `git push --force`, `git reset --hard`, `--no-verify`, `curl … \| sh`, `chmod 777`, `DROP TABLE` |
| Secret exposure | high | a credential pattern appears in a command or output |
| New dependency | low | a package manifest gains a dependency, or an install command ran |
| Churn | low | the same lines were written and later removed again, or a file was edited 5+ times |
| Unverified finish | medium | files changed but no test/build command ran after the last edit |
| Sensitive files | medium | CI config, lockfiles, env files, migrations or auth code changed |

### Brief and story

- Phases are derived from step kinds: **Explore** (reads/searches before the first edit), **Change** (edits), **Verify** (test/build/lint commands), **Repair** (edits after a failed verification), **Report** (final messages).
- "Review first" ranks: high findings → files with flags → largest changes.

### Replay

- Tape with four lanes and failure markers; click/drag to scrub; play/pause with speed (1×/4×/16×).
- Keyboard: `j`/`k` or arrows step, `space` play, `[`/`]` jump between edits, `f` next finding, `/` filter steps, `?` help.
- Inspector shows step detail; context panel shows files read so far (with "read before this edit?" highlighted), last failed command, active user instruction, current plan items.
- URL keeps the selected step (`#step=41`) so links can be shared.

### Exports and CLI

- **Markdown report** (PR-ready): verdict, claims, findings, files changed with per-file reason, story.
- **HTML replay**: one self-contained file, works offline, secrets masked.
- **Normalized JSON** (Intent Trace).
- CLI commands: `intent-replay` (list + open), `open <file|latest>`, `report <file>`, `check <file> --fail-on high`, `export <file> -o replay.html`.

## States and Boundaries

- **First use (web)** — Home with samples; nothing is uploaded, said plainly.
- **First use (CLI) with no sessions** — explains where it looked and how to point it at a file.
- **Unknown or corrupt file** — names the supported formats; skips bad lines and reports how many.
- **Huge runs** (thousands of steps) — stay responsive; list virtualized or windowed.
- **Run with no edits** — Changes says so; Brief still checks claims.
- **Persistence** — none beyond the current tab and remembered UI preferences (theme, last tab). Reloading a dropped file requires dropping it again; CLI-served runs reload.
- **Privacy** — logs never leave the machine; exports mask secrets.

## Product Decisions

- Local-first, no backend — logs contain proprietary code and secrets. *(Assumption made by the agent for the learner, consistent with "make it a product": developers will not upload transcripts.)*
- Deterministic analysis, no LLM in the core — findings must be reproducible and cheap. *(Agent recommendation; learner to confirm.)*
- Read existing agent logs rather than wrapping the agent — zero setup. *(Agent recommendation; learner to confirm.)*
- Claude Code and Codex first — the two agents the learner uses daily.

## What We're Building

Import (Claude Code, Codex, Intent Trace) → normalized timeline → change attribution, phases, findings, claim check → web viewer (Home, Brief, Replay, Changes, Findings) → exports (Markdown, HTML, JSON) → CLI (list/open/report/check/export) → three sample runs (at least one recorded from a real agent) → hosted web app.

## Deferred From the POC

- ~~Live mode (tailing a running session)~~ — built after the core: `intent-replay watch` polls the session file and the viewer follows the newest step.
- ~~Run comparison~~ — built after the core: the Compare view puts two runs of the same task side by side.
- GitHub App / Action that comments automatically — the CLI `report` + `check` cover the same need manually.
- Team sharing with links — requires hosting user data, which conflicts with local-first.

## Possible Later Enhancements

- More agents (Gemini CLI, Cursor, Aider, OpenHands).
- Optional AI narrative layered on top of the deterministic facts, clearly labelled.
- VS Code extension that opens the replay beside the diff.
- Policy files (`.intentrc`) so teams choose which findings block merges.

## Non-Goals

- Not an agent, not an IDE — it never changes code.
- Not an observability backend for LLM apps (LangSmith-style tracing); it's about coding agents changing a repo.
- Not a judge of code quality in general — only of what the run itself shows.

## Open Questions

- Which sample runs best tell the story in a 3-minute video? (Can wait until build.)
- Hosting target for the web app (GitHub Pages expected). (Can wait.)
