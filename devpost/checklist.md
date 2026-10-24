---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast

## Slices

- [x] **1. Drop a Claude Code log and see the run as a timeline**
  Becomes usable: A running viewer where dropping a Claude Code `.jsonl` shows the task, stats and an ordered step list (reads, edits, commands, messages) with the agent's intent per step.
  Why now: Proves the riskiest assumption (the log contains enough to reconstruct a run) end to end, with scaffold included.
  PRD ref: `prd.md > The Core Journey` (steps 1, 4), `prd.md > Import`, `prd.md > The timeline model`
  Spec ref: `spec.md > Parsers (src/core/parse)`, `spec.md > Data Model`, `spec.md > File Structure`
  Build: Scaffold Vite + React + TS + Vitest; write `types.ts`, `parse/claudeCode.ts`, `parse/detect.ts`; a minimal Home drop zone and step list.
  Verify (mechanical): Unit tests parse a Claude Code fixture into the expected steps; `npm run build` passes; dropping a real local session renders steps.
  Learner check: Drop one of your own Claude Code sessions and see whether the steps match what you remember the agent doing.
  Commit: `Parse Claude Code sessions into a step timeline`

- [x] **2. Every changed line knows which step wrote it, and claims get checked**
  Becomes usable: For a loaded run, the analyzer produces per-file blame, phases, findings and claim verdicts (visible as raw lists in the UI).
  Why now: This is the kernel. Everything visual afterwards is presentation of this.
  PRD ref: `prd.md > Change attribution (the kernel, part 1)`, `prd.md > Claim check (the kernel, part 2)`, `prd.md > Findings`
  Spec ref: `spec.md > File tracker and blame (src/core/analyze/files.ts)`, `spec.md > Claims (src/core/analyze/claims.ts)`, `spec.md > Findings (src/core/analyze/rules/*.ts)`, `spec.md > Command classifier (src/core/analyze/commands.ts)`
  Build: files.ts, commands.ts, phases.ts, claims.ts, rules, redact.ts, analyze/index.ts.
  Verify (mechanical): Unit tests for blame propagation, each rule firing and not firing, and each claim verdict.
  Learner check: On the sample run, read the claim verdicts and say whether they're right.
  Commit: `Attribute changes, detect findings and fact-check claims`

- [x] **3. The Brief, Replay, Changes and Findings screens**
  Becomes usable: The full run view with the instrument-panel design: Brief with verdict/claims/review-first/story, Replay with tape and inspector and context, Changes with blame and why drawer, Findings list; deep links and keyboard shortcuts.
  Why now: Turns the kernel into the product experience judges and users see.
  PRD ref: `prd.md > Screens and Layout`, `prd.md > Replay`, `prd.md > Brief and story`, `prd.md > Look and Feel`
  Spec ref: `spec.md > Viewer (src/ui)`, `spec.md > Look and Feel`
  Build: UI components, CSS tokens, themes, keyboard map.
  Verify (mechanical): Build passes; Playwright opens a sample, clicks the contradicted claim, lands on the evidence step.
  Learner check: Open the sample, follow the red claim to its evidence, and click a changed line in Changes.
  Commit: `Build the run view: brief, replay, changes, findings`

- [x] **4. Codex runs and the open trace format**
  Becomes usable: Codex rollout logs (old and new formats) and Intent Trace JSON load into the same views.
  Why now: Second agent proves the model is agent-neutral.
  PRD ref: `prd.md > Import`
  Spec ref: `spec.md > Parsers (src/core/parse)`
  Build: `parse/codex.ts`, `parse/intentTrace.ts`, `docs/TRACE_FORMAT.md`.
  Verify (mechanical): Unit tests on Codex fixtures for both generations; real local Codex session loads.
  Learner check: Drop one of your Codex sessions.
  Commit: `Support Codex sessions and the Intent Trace format`

- [x] **5. CLI: find, open, report, check, export**
  Becomes usable: `intent-replay` lists local sessions and opens one; `report`, `check`, `export` work.
  Why now: Makes it a tool developers would adopt in their real workflow and CI.
  PRD ref: `prd.md > Exports and CLI`
  Spec ref: `spec.md > CLI (cli/)`, `spec.md > Report (src/core/report/markdown.ts)`
  Build: esbuild bundle, session discovery, local server, Markdown report, HTML export.
  Verify (mechanical): Run each command against fixtures; `check` exits 1 on the high-severity sample.
  Learner check: Run `intent-replay` in a project you used an agent in.
  Commit: `Add the intent-replay CLI`

- [x] **6. Sample runs, home page, hosting and docs**
  Becomes usable: Home with three sample runs (at least one recorded from a real agent), README, LICENSE, GitHub Pages deploy.
  Why now: Reviewers won't run code; the hosted samples and video carry the presentation.
  PRD ref: `prd.md > Screens and Layout` (Home), `prd.md > What We're Building`
  Spec ref: `spec.md > Where It Runs and How Someone Tries It`
  Build: record/generate samples, Home polish, README with screenshots, Pages workflow.
  Verify (mechanical): Hosted URL loads and every sample opens; e2e passes.
  Learner check: Open the hosted link on your phone and laptop.
  Commit: `Add sample runs, home page and deployment`

- [x] **7. Live mode: follow a run while the agent works**
  Becomes usable: `intent-replay watch` opens the newest session and the replay grows as the agent writes to its log; the playhead follows the newest step and claims are checked the moment they are made.
  Why now: Moved up from Later because reviewing *during* a run is where the flight-recorder idea is most useful, and the CLI server made it cheap.
  PRD ref: `prd.md > Exports and CLI`
  Spec ref: `spec.md > CLI (cli/)`
  Build: `/api/sessions/:key/stat` endpoint, stable session keys, polling + refresh that keeps the reader's place, Live badge.
  Verify (mechanical): Start `watch` on a half-written log, append the rest, confirm the step count and verdict update in the browser.
  Learner check: Run `intent-replay watch` in a project, start an agent in another terminal, and watch the tape grow.
  Commit: `Live mode: intent-replay watch follows a session as the agent works`

- [x] **8. Compare two runs of the same task**
  Becomes usable: A side-by-side view of two runs: chapters, exploration before the first edit, edits, checks, whether the final change was verified, claims, findings, final message, and both diffs of each shared file.
  Why now: Moved up from Later once real Claude Code and Codex runs of the identical task existed; it makes the kernel's value visible at a glance.
  PRD ref: `prd.md > The Core Journey`
  Spec ref: `spec.md > Viewer (src/ui)`
  Build: `Compare.tsx`, `?compare=a,b` route, entry card on Home.
  Verify (mechanical): e2e test opens the comparison and drills into one run.
  Learner check: Open “Compare two agents on the same bug” and say which agent you'd trust more, and why.
  Commit: `Compare two runs side by side`

## Hands-on Checkpoints

- [x] Early usable behavior explored — after slice 3 (full run view on a sample)
  The learner opened the run views on localhost and reacted with screenshots: the session list took too much space, the Findings and Brief screens looked too basic, and the home sections and hero needed a different direction. Each point led to a rebuild (session picker with search and filters, Findings with evidence cards, the Brief as a verdict page, a new hero and samples section).
- [x] Final kick-the-tires exploration and feedback completed
  The learner went through the deployed build several more times, bringing written reviews of it, and raised what still looked wrong: the hero covering its own headline, a slow loader, confusing "exit 0" badges, "Supported" stamps on weak evidence, scratch files in the totals, the report and the Brief disagreeing, and the replay opening on the wrong step. All were fixed and redeployed; see Revisions.

## Final Review

- [x] Final review complete — feedback resolved and learner confirms ready to ship
  Every point from the final round was resolved, with unit tests, browser tests and the build passing. The learner confirmed with "holds good". The demo video is still to be recorded in `6-ship`.

## Code Tour and App Map

- [x] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [x] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [x] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: A brief recap connected to practice that already happened during the build, not an interactive tour. The learner's own reviews of the deployed app drove a "measure on real data, then hand-check the answers" loop: the claim checker was run over 86 local sessions (`intent-replay audit`), every Contradicted verdict and three random samples of 30 Supported verdicts were checked by hand, and each mistake became a named test in `tests/claims.test.ts`. The app map's "A practice to reuse" section records this.
Route and stops: Reference route in the app map, not toured interactively: `parseTrace` in `src/core/parse/detect.ts` → `checkClaims` / `weakProof` in `src/core/analyze/claims.ts` → `Brief` in `src/ui/Brief.tsx`.
Edit outcome: Offered (change the Brief's replay button label and see it on refresh); not taken.
Reflection: Offered ("What would you do differently next time you start with an agent?"); not answered.
Activity mode: Brief recap plus app map (fast mode).

## Revisions

- Codex parsing works per turn instead of per file — real sessions span two CLI versions, so a file can mix the older `response_item` records and the newer `item_completed` events.
- Files Claude Code attaches to the context (after compaction, or @-mentions) count as reads — without this, real sessions showed false “blind edit” findings.
- Shell reads are detected inside compound commands (`cd x && sed -n 1,40p a.py; cat b.py c.py`) and shell writes (`>`, `tee`, `sed -i`) are tracked — the same false positives came from these.
- Claims checking understands filtered test runs (`--test-name-pattern`, `-k`, a single test file) and output that reports failures behind a masked exit code — the scripted sample showed agents claiming “all tests pass” after running one test.
- HTML injection (CLI server, CLI export, in-app download) inserts before the last `</head>` with runtime-built tags — the viewer's own inlined JavaScript contains `</head>`, which broke the CLI-served page.
- The keyboard shortcut listener is attached once and reads state from refs — re-attaching it on every step change dropped fast keypresses.
- Live mode and Compare were built (they were listed under Later / Deferred) after the core was done, because the learner asked for as much depth as possible.
- The claim check was measured on 86 real local sessions and reviewed by hand in both directions; this led to stricter proof for Supported (no scratch-copy evidence, CI claims need a CI run, test counts must match, piped results need a visible summary) and to `intent-replay audit`.
- A real session (Handrail) was added as a public sample, trimmed and redacted with new `import-run` options (`--steps`, `--drop-files`, `--redact-lines`), because the learner's reviews pointed out that no clickable sample showed a real contradiction.
- Home page sections were cut (CRT screen, gauges, marquee) and the loader shortened after review feedback that the page was overdone and slow to show its main button.
