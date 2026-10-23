---
doc: checklist
status: draft
---

# Build Checklist

Build mode: fast

## Slices

- [ ] **1. Drop a Claude Code log and see the run as a timeline**
  Becomes usable: A running viewer where dropping a Claude Code `.jsonl` shows the task, stats and an ordered step list (reads, edits, commands, messages) with the agent's intent per step.
  Why now: Proves the riskiest assumption (the log contains enough to reconstruct a run) end to end, with scaffold included.
  PRD ref: `prd.md > The Core Journey` (steps 1, 4), `prd.md > Import`, `prd.md > The timeline model`
  Spec ref: `spec.md > Parsers (src/core/parse)`, `spec.md > Data Model`, `spec.md > File Structure`
  Build: Scaffold Vite + React + TS + Vitest; write `types.ts`, `parse/claudeCode.ts`, `parse/detect.ts`; a minimal Home drop zone and step list.
  Verify (mechanical): Unit tests parse a Claude Code fixture into the expected steps; `npm run build` passes; dropping a real local session renders steps.
  Learner check: Drop one of your own Claude Code sessions and see whether the steps match what you remember the agent doing.
  Commit: `Parse Claude Code sessions into a step timeline`

- [ ] **2. Every changed line knows which step wrote it, and claims get checked**
  Becomes usable: For a loaded run, the analyzer produces per-file blame, phases, findings and claim verdicts (visible as raw lists in the UI).
  Why now: This is the kernel. Everything visual afterwards is presentation of this.
  PRD ref: `prd.md > Change attribution (the kernel, part 1)`, `prd.md > Claim check (the kernel, part 2)`, `prd.md > Findings`
  Spec ref: `spec.md > File tracker and blame (src/core/analyze/files.ts)`, `spec.md > Claims (src/core/analyze/claims.ts)`, `spec.md > Findings (src/core/analyze/rules/*.ts)`, `spec.md > Command classifier (src/core/analyze/commands.ts)`
  Build: files.ts, commands.ts, phases.ts, claims.ts, rules, redact.ts, analyze/index.ts.
  Verify (mechanical): Unit tests for blame propagation, each rule firing and not firing, and each claim verdict.
  Learner check: On the sample run, read the claim verdicts and say whether they're right.
  Commit: `Attribute changes, detect findings and fact-check claims`

- [ ] **3. The Brief, Replay, Changes and Findings screens**
  Becomes usable: The full run view with the instrument-panel design: Brief with verdict/claims/review-first/story, Replay with tape and inspector and context, Changes with blame and why drawer, Findings list; deep links and keyboard shortcuts.
  Why now: Turns the kernel into the product experience judges and users see.
  PRD ref: `prd.md > Screens and Layout`, `prd.md > Replay`, `prd.md > Brief and story`, `prd.md > Look and Feel`
  Spec ref: `spec.md > Viewer (src/ui)`, `spec.md > Look and Feel`
  Build: UI components, CSS tokens, themes, keyboard map.
  Verify (mechanical): Build passes; Playwright opens a sample, clicks the contradicted claim, lands on the evidence step.
  Learner check: Open the sample, follow the red claim to its evidence, and click a changed line in Changes.
  Commit: `Build the run view: brief, replay, changes, findings`

- [ ] **4. Codex runs and the open trace format**
  Becomes usable: Codex rollout logs (old and new formats) and Intent Trace JSON load into the same views.
  Why now: Second agent proves the model is agent-neutral.
  PRD ref: `prd.md > Import`
  Spec ref: `spec.md > Parsers (src/core/parse)`
  Build: `parse/codex.ts`, `parse/intentTrace.ts`, `docs/TRACE_FORMAT.md`.
  Verify (mechanical): Unit tests on Codex fixtures for both generations; real local Codex session loads.
  Learner check: Drop one of your Codex sessions.
  Commit: `Support Codex sessions and the Intent Trace format`

- [ ] **5. CLI: find, open, report, check, export**
  Becomes usable: `intent-replay` lists local sessions and opens one; `report`, `check`, `export` work.
  Why now: Makes it a tool developers would adopt in their real workflow and CI.
  PRD ref: `prd.md > Exports and CLI`
  Spec ref: `spec.md > CLI (cli/)`, `spec.md > Report (src/core/report/markdown.ts)`
  Build: esbuild bundle, session discovery, local server, Markdown report, HTML export.
  Verify (mechanical): Run each command against fixtures; `check` exits 1 on the high-severity sample.
  Learner check: Run `intent-replay` in a project you used an agent in.
  Commit: `Add the intent-replay CLI`

- [ ] **6. Sample runs, home page, hosting and docs**
  Becomes usable: Home with three sample runs (at least one recorded from a real agent), README, LICENSE, GitHub Pages deploy.
  Why now: Reviewers won't run code; the hosted samples and video carry the presentation.
  PRD ref: `prd.md > Screens and Layout` (Home), `prd.md > What We're Building`
  Spec ref: `spec.md > Where It Runs and How Someone Tries It`
  Build: record/generate samples, Home polish, README with screenshots, Pages workflow.
  Verify (mechanical): Hosted URL loads and every sample opens; e2e passes.
  Learner check: Open the hosted link on your phone and laptop.
  Commit: `Add sample runs, home page and deployment`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — after slice 3 (full run view on a sample)
- [ ] Final kick-the-tires exploration and feedback completed

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence:
Route and stops:
Edit outcome:
Reflection:
Activity mode:

## Revisions
