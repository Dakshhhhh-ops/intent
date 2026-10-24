---
doc: spec
status: approved
---

# Intent Replay — Technical Spec

## How This Works, In Plain Language

Intent Replay has three parts that share one brain.

1. **The core** (`src/core`) is plain TypeScript with no UI. *Parsers* read an agent's log file (Claude Code or Codex) and turn it into one common shape: a list of **steps**. The *analyzer* then walks those steps like a detective: it rebuilds each changed file line by line and remembers which step wrote each line, groups steps into chapters, runs the finding rules, and fact-checks the agent's closing claims against the commands that actually ran.
2. **The viewer** (`src/ui`) is a React web app that shows the analyzed run: Brief, Replay, Changes, Findings. It runs entirely in the browser. It is built into a single HTML file, so the same file can be hosted, opened offline, or exported with a run baked in.
3. **The CLI** (`cli/`) is a small Node program. It knows where Claude Code and Codex keep their logs, lists them, starts a tiny local web server that serves the viewer plus the chosen log, and can print a Markdown report or fail a CI job — using the exact same core.

Why this shape: one analyzer means the web app, the exported HTML and the CI check can never disagree. No server or database, because the input is a single local file and privacy is a feature.

## The Core Journey Through the System

PRD ref: `prd.md > The Core Journey`.

1. `npx intent-replay` → `cli/main.ts` scans `~/.claude/projects/<encoded cwd>/*.jsonl` and `~/.codex/sessions/**/*.jsonl` (filtered by `cwd`) → prints a numbered list → user picks one (or `latest`).
2. CLI starts `http://127.0.0.1:4848`, serves `dist/index.html` with `window.__INTENT_BOOT__ = { api: "/api" }` injected, opens the browser.
3. Viewer boots → `GET /api/sessions/:id/raw` → `core/parse/detect.ts` picks the parser → `parseClaudeCode` / `parseCodex` → `Trace`.
4. `core/analyze/index.ts` → `analyze(trace)` → `Analysis` { files, blame, phases, findings, claims, stats, review }.
5. UI renders Brief from `Analysis`; clicking anything calls `goToStep(id)` → Replay tab, URL `#step=id`.
6. Changes tab reads `analysis.files[path].lines` (each line tagged with a step id) to draw the blame gutter.
7. Export → `core/report/markdown.ts` (Markdown) or `ui/export.ts` (clones the running single-file HTML and inlines the trace JSON).
8. In the web app instead: drop a file → `FileReader` → same steps 3–6.

## Stack

| Piece | Choice | Why |
|---|---|---|
| Language | TypeScript 5 | One language for core, UI and CLI; types keep two log formats honest. |
| UI | React 19 + Vite | Fast to build, familiar; Vite gives a static build. [react.dev](https://react.dev), [vite.dev](https://vite.dev) |
| Single-file build | `vite-plugin-singlefile` | Viewer becomes one HTML file → trivial hosting, offline use, and HTML export. [npm](https://www.npmjs.com/package/vite-plugin-singlefile) |
| Diffing | `diff` (jsdiff) | Line diffs for blame propagation and net diffs. [npm](https://www.npmjs.com/package/diff) |
| CLI bundling | `esbuild` | Bundles `cli/` + `src/core` into one `dist-cli/intent-replay.mjs` with no runtime deps. |
| Tests | Vitest (core), Playwright (one end-to-end run) | Core logic is where bugs hide; one e2e proves the whole journey. |
| Styling | Hand-written CSS with custom properties | Full control of the instrument-panel look; no framework weight. |
| Fonts | Inter + JetBrains Mono via `@fontsource` | Bundled locally, no network needed. |

Unverified: Codex log format changes often (two generations exist on this machine: `function_call`/`exec_command_end` and the newer `event_msg/item_completed` items). Both are handled; checked early in the build against real files.

## Where It Runs and How Someone Tries It

- Node 20+ for the CLI and dev; any modern browser for the viewer.
- Dev: `npm install` → `npm run dev` → open the printed URL → click a sample run.
- CLI from the repo: `npm run build` → `node dist-cli/intent-replay.mjs` (or `npm link` → `intent-replay`).
- Hosted: GitHub Pages serves `dist/index.html` (samples included).
- Demo recording: hosted app (or `npm run preview`), open the "weakened test" sample, Brief → click the contradicted claim → Replay → Changes.
- No API keys, no accounts.

## Look and Feel

Carried from `prd.md > Look and Feel`.
- Tokens on `:root`: `--bg #0d1117`-ish blue-black, raised surfaces one step lighter, hairline borders, text at three levels. Light theme mirrors it on warm off-white.
- Semantic colors: read `#58a6ff`-family blue, edit amber, create green, failure/delete red, agent text neutral; one accent (electric violet) for playhead, focus rings and selection.
- Type: Inter 13–14px UI, JetBrains Mono 12.5px for code; tabular numbers for stats.
- Density: debugger-dense with 8px rhythm; panels separated by 1px lines, not cards with shadows.
- Motion: playhead glides, file map nodes pulse once when touched, 150ms transitions; respects `prefers-reduced-motion`.
- Copy: specific and plain, file names in mono.

## Components

### Parsers (`src/core/parse`)
- `claudeCode.ts` — groups JSONL records by type. `assistant` blocks: `text` → message (also becomes the intent for following tool calls), `thinking` (when non-empty), `tool_use` → pending step keyed by id. `user` records: plain text → prompt; `tool_result` → completes the pending step, using `toolUseResult` (Edit: `oldString/newString/originalFile/structuredPatch`; Write: `content/originalFile`; Read: `file.content/startLine/numLines/totalLines`; Bash: `stdout/stderr`, `is_error`). `TodoWrite` → plan step. `isSidechain` → actor `subagent`. Ignores bookkeeping records (`api-request*`, `file-history-*`, `queue-operation`, …). Usage tokens summed per message id.
- `codex.ts` — `session_meta` → cwd/model; `response_item/message` → prompt or message; `reasoning.summary` → thinking; `function_call` (`shell`, `exec_command`) + `function_call_output`; `custom_tool_call apply_patch`; `event_msg` `exec_command_end` / `patch_apply_end`; newer `event_msg/item_completed` items (`UserMessage`, `AgentMessage`, `CommandExecution` with `exit_code` and `parsed_cmd`, `FileChange` with per-file `unified_diff`). Prefers `item_completed` when present to avoid duplicates. `parsed_cmd` of type `read`/`search`/`list_files` maps to read/search steps.
- `intentTrace.ts` — validates our open JSON format (`docs/TRACE_FORMAT.md`).
- `detect.ts` — sniffs the first lines and dispatches.
PRD ref: `prd.md > Import`.

### Command classifier (`src/core/analyze/commands.ts`)
Labels each command test / build / typecheck / lint / install / git / run / read / search / other by matching common tools (npm/pnpm/yarn/bun scripts, vitest, jest, pytest, go test, cargo, tsc, eslint, ruff, …), and extracts read-like commands (`cat`, `Get-Content`, `sed -n`) as reads.
PRD ref: `prd.md > Claim check (the kernel, part 2)`.

### File tracker and blame (`src/core/analyze/files.ts`)
Per path keeps `{ known: boolean, lines: { text, step|null }[] , original?: string }`. Full reads and `originalFile` seed the content; edits replace text and propagate tags with a line diff (jsdiff `diffArrays`); unified-diff hunks apply by line numbers when content is known, else are kept as hunk-level attribution. Produces net diff (original vs final) with tags, reads/edits counts, first-read/first-edit steps.
PRD ref: `prd.md > Change attribution (the kernel, part 1)`.

### Phases (`src/core/analyze/phases.ts`)
Labels each step, then merges runs into chapters with one-sentence summaries.
PRD ref: `prd.md > Brief and story`.

### Findings (`src/core/analyze/rules/*.ts`)
One small function per rule from the PRD table → `Finding { id, rule, severity, title, detail, steps[], files[] }`.
PRD ref: `prd.md > Findings`.

### Claims (`src/core/analyze/claims.ts`)
Splits the final agent messages into sentences, matches claim patterns, evaluates each against the command timeline and file changes → `Claim { text, kind, verdict, evidenceStep, explanation }`.
PRD ref: `prd.md > Claim check (the kernel, part 2)`.

### Redaction (`src/core/redact.ts`)
Regexes for common credentials (AWS, GitHub, OpenAI/Anthropic-style keys, Slack, private key blocks, `password=`), applied to every string shown or exported.
PRD ref: `prd.md > Import`.

### Report (`src/core/report/markdown.ts`)
Analysis → PR-ready Markdown.
PRD ref: `prd.md > Exports and CLI`.

### Viewer (`src/ui`)
`App` (routing between Home and Run, boot sources), `Home`, `RunHeader`, `Brief`, `Replay` (`Tape`, `StepList`, `Inspector`, `ContextPanel`, `FileMap`), `Changes` (`FileList`, `BlameDiff`, `WhyDrawer`), `Findings`, `ExportMenu`, `KeyboardHelp`. State lives in one `useRun` store (selected step, tab, playback) — no external state library.
PRD ref: `prd.md > Screens and Layout`.

### Compare (`src/ui/Compare.tsx`)
Builds both runs with the same core, derives per-run metrics (reads and searches before the first edit, edits, checks, whether the final change was verified, claim verdicts, findings) and renders them as aligned rows, plus side-by-side diffs for files both runs changed. Route: `?compare=<sampleA>,<sampleB>`.
PRD ref: `prd.md > The Core Journey`.

### Live mode
`intent-replay watch [target]` serves the viewer with `live: true`; the viewer polls `/api/sessions/:key/stat` every 1.5 s and, when the file grows, re-parses and re-analyzes it, keeping the selected tab and following the newest step if the reader was already at the end. Session keys are hashes of the log path, so they stay stable when new sessions appear.
PRD ref: `prd.md > Exports and CLI`.

### CLI (`cli/`)
`sessions.ts` (discovery), `server.ts` (node:http, serves viewer + `/api/sessions`, `/api/sessions/:id/raw`), `main.ts` (argument parsing for list/open/report/check/export).
PRD ref: `prd.md > Exports and CLI`.

## Data Model

```ts
type StepKind = 'prompt'|'message'|'thinking'|'plan'|'read'|'search'|'edit'|'create'|'delete'|'command'|'web'|'subagent'|'tool';
interface Step {
  id: number; t: number | null; kind: StepKind; actor: 'user'|'agent'|'subagent';
  title: string; intent?: string; text?: string; tool?: string;
  files: string[];
  read?: { path: string; full: boolean; content?: string; startLine?: number };
  edit?: { path: string; op: 'create'|'update'|'delete'; before?: string; after?: string;
           oldString?: string; newString?: string; replaceAll?: boolean; patch?: string; added: number; removed: number };
  command?: { cmd: string; exitCode: number | null; failed: boolean; output: string; category: CommandCategory; durationMs?: number };
  search?: { pattern: string; path?: string };
  plan?: { items: { text: string; status: 'pending'|'in_progress'|'completed' }[] };
  error?: boolean; usage?: { input: number; output: number; cached: number };
}
interface Trace { id: string; source: 'claude-code'|'codex'|'intent-trace'; title: string; task?: string;
  cwd?: string; model?: string; startedAt?: number; endedAt?: number; steps: Step[]; warnings: string[] }
```

Everything is in memory for the life of the tab. UI preferences (theme, last tab) in `localStorage`, wrapped in try/catch. Leaving and coming back: CLI-served runs reload from disk; dropped files must be dropped again.

## File Structure

```
intent/
├── src/
│   ├── core/                 # no DOM, no Node APIs — shared by UI and CLI
│   │   ├── types.ts
│   │   ├── parse/            # claudeCode.ts, codex.ts, intentTrace.ts, detect.ts
│   │   ├── analyze/          # index.ts, files.ts, commands.ts, phases.ts, claims.ts, rules/
│   │   ├── report/           # markdown.ts
│   │   └── redact.ts
│   ├── ui/                   # React viewer (components, styles, hooks)
│   ├── samples/              # sample runs bundled into the viewer
│   └── main.tsx
├── cli/                      # Node CLI: main.ts, sessions.ts, server.ts
├── tests/                    # vitest unit tests + fixtures, playwright e2e
├── scripts/                  # sample recording / generation scripts
├── docs/                     # TRACE_FORMAT.md, screenshots
├── devpost/                  # Devpost Learn planning docs
├── index.html
├── vite.config.ts
└── package.json
```

## External Services and Dependencies

None at runtime. No APIs, keys or network calls. GitHub Pages for hosting the static viewer (free). Recording the real sample runs uses the learner's own Claude Code / Codex CLI once, offline from the product.

## Important Failure Modes

- **Agent log format changes** (new record types) → unknown records are skipped and counted; the header shows "N records not understood" instead of failing.
- **Edit can't be placed** (old string not found because the file changed outside the log, e.g. by a shell command) → file marked "partially reconstructed"; blame falls back to hunk level for that file.
- **Huge logs** (50MB+) → parsing streams line by line; step list renders in windows.

## What Was Simplified and Why

- **Claims are matched with patterns** instead of an LLM — reproducible and explainable; the fuller version would add an optional model pass for paraphrased claims.
- **Shell-made edits (sed, redirects) are detected but not reconstructed** — the log doesn't contain file content for them; the fuller version would snapshot git state.
- **Local sessions only** — the fuller version would offer an opt-in team server.

## Decisions and Open Issues

- Single-file viewer build (agent recommendation) — makes hosting, offline use and HTML export the same artifact; tradeoff: larger first load (~1MB), acceptable for a dev tool.
- Core shared verbatim between browser and CLI (agent recommendation) — no drift between report and UI.
- Real vs scripted samples: at least one sample is recorded from a real agent run; any scripted scenario is labelled as such in the UI.
- Learner uncertainty recorded: none raised yet.
- Open: hosting target confirmation (GitHub Pages assumed).
