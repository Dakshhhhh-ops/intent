# Intent Replay

**Debug what an AI coding agent actually did.**

When Claude Code or Codex finishes a task, you get a diff and a cheerful summary: *"Fixed the bug, all tests pass."* The diff hides the story: which files the agent read, what it assumed, which commands it ran, what failed, and why it made each change. Intent Replay turns one agent run into a replayable, fact-checked decision trace.

**Try it in the browser:** https://dakshhhhh-ops.github.io/intent/ (three sample runs included; your own logs never leave your machine)

![The Brief: the agent's claims stamped against the log](docs/screenshots/brief.png)

## What it does

- **Fact-checks the agent's claims.** "All tests pass", "build succeeds", "only changed `cart.js`", "didn't touch the tests". Each claim in the agent's closing message is stamped **Supported**, **Contradicted**, **Stale** or **Unverified**, with a link to the step that proves it. It sees through `npm test | tail` (exit code hidden), re-running only one filtered test, and tests that passed before the code changed again.
- **Blame, but for intent.** Click any changed line to see the step that wrote it, the reason the agent gave just before, whether it had even read that file, and what had just failed.
- **Replays the run.** A timeline ("the tape") of every read, edit and command, with chapters (Explore, Change, Verify, Repair, Report). Scrub it, step through it with the keyboard, or press play and watch files light up in the file map.
- **Flags what a reviewer should look at.** Deterministic rules, no AI: weakened tests, blind edits, failure loops, silenced errors, risky commands, leaked secrets, new dependencies, churn, sensitive files, unverified finishes, masked exit codes.
- **Fits your workflow.** A CLI that finds your local sessions, prints a PR-ready Markdown report, fails CI on high-severity findings, and exports a single offline HTML replay you can send to a reviewer.

| Replay | Blame with "why" |
|---|---|
| ![Replay](docs/screenshots/replay.png) | ![Changes](docs/screenshots/changes.png) |

## Who it's for

Developers who let an agent work on their repo and then have to decide whether to merge, and the teammates who review those PRs without ever seeing the run.

## Use it

### In the browser

Open the [hosted app](https://dakshhhhh-ops.github.io/intent/) and drop a session log on it. Everything runs locally in the page.

| Agent | Where the logs are |
|---|---|
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl` |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |

On Windows, `~` is `C:\Users\<you>`.

### From the command line

```bash
npm i -g github:Dakshhhhh-ops/intent    # builds on install, needs Node 20+

intent-replay                     # list sessions for this folder and open the picker
intent-replay open latest         # replay the newest session
intent-replay report latest       # PR-ready Markdown (--out report.md, --json)
intent-replay check latest        # exit 1 on high findings (--fail-on medium|low)
intent-replay export latest -o replay.html   # one offline file, secrets masked
```

A target is a number from `intent-replay list`, `latest`, or a path to a `.jsonl` / `.json` file.

### In CI

```yaml
- run: npx -y github:Dakshhhhh-ops/intent report $AGENT_LOG --out intent-report.md
- run: npx -y github:Dakshhhhh-ops/intent check $AGENT_LOG --fail-on high
```

### From source

```bash
git clone https://github.com/Dakshhhhh-ops/intent && cd intent
npm install          # also builds dist/ and dist-cli/
npm run dev          # viewer with hot reload
npm test             # 257 unit tests (parsers, blame, claims, rules)
npm run e2e          # browser test of the core journey
```

## How it works

```
session log ──► parser ──► one timeline of steps ──► analyzer ──► Brief · Replay · Changes · Findings
 (Claude Code,    (src/core/parse)                    (src/core/analyze)        (browser, CLI, CI, HTML export)
  Codex, Intent
  Trace JSON)
```

1. **Parse.** Each agent's log becomes the same list of steps: prompts, agent messages, reads, searches, edits, commands with exit codes and output, plans. Claude Code records full old/new strings and file snapshots; Codex records commands and unified diffs; both are handled, including Codex sessions that span two CLI versions.
2. **Rebuild files.** Every changed file is replayed edit by edit, and each line remembers the step that wrote it. When the log lacks enough to place an edit exactly, the file falls back to per-edit attribution and says so.
3. **Analyze.** Steps are grouped into chapters, every rule runs, and claims from each turn's closing message are checked against the commands that ran before them.
4. **Show.** The same core runs in the browser and in the CLI, so the web view, the Markdown report and the CI check always agree.

Secrets (API keys, tokens, private keys, passwords) are masked as soon as a log is read, in the UI and in every export.

## Formats

- Claude Code session JSONL
- Codex CLI rollout JSONL (older `response_item` and newer `item_completed` formats)
- **Intent Trace JSON**, a small open format any agent can emit: [docs/TRACE_FORMAT.md](docs/TRACE_FORMAT.md)

## Sample runs

| Sample | What it shows |
|---|---|
| [`examples/cart-rounding.claude.jsonl`](examples/cart-rounding.claude.jsonl) | **Scripted scenario.** Fixing an off-by-a-cent cart total, the agent breaks discounts with a blind edit, rewrites a test to match, runs only that one test, and reports "All tests pass." The agent's decisions are scripted; every file and every test result in the log is real (generated by [`scripts/make-scripted-sample.mjs`](scripts/make-scripted-sample.mjs)). |
| [`examples/csv-quotes-claude.intent.json`](examples/csv-quotes-claude.intent.json) | **Recorded run.** A real headless Claude Code session fixing quoted CSV fields. Clean. |
| [`examples/csv-quotes-codex.intent.json`](examples/csv-quotes-codex.intent.json) | **Recorded run.** The same task given to Codex CLI. Clean. |

Recorded runs were imported with [`scripts/import-run.ts`](scripts/import-run.ts), which rewrites machine paths and refuses to write a file that still contains personal data.

## Project layout

```
src/core/      parsers, analyzer, rules, claims, redaction, Markdown report (no DOM, no Node APIs)
src/ui/        React viewer
cli/           intent-replay command (session discovery, local server, report/check/export)
examples/      sample runs (also bundled into the viewer)
tests/         unit tests and the end-to-end browser test
devpost/       planning documents: scope, PRD, spec, build checklist
```

## Built for Build With AI: Basics

This project was planned and built with the Devpost Learn skill pack during the hackathon. The planning documents are in [`devpost/`](devpost): [scope](devpost/scope.md), [PRD](devpost/prd.md), [spec](devpost/spec.md) and the [build checklist](devpost/checklist.md).

## License

[MIT](LICENSE)
