# Intent Replay

**Your coding agent says "all tests pass." Intent Replay checks that against what actually ran.**

When Claude Code or Codex finishes a task, you get a diff and a confident summary: *"Fixed the bug, all tests pass."* Intent Replay reads the agent's own session log and fact-checks every claim in that summary against the commands that really ran: the last test run failed, the exit code was hidden by `| tail`, only one filtered test was re-run, or a test file was edited to match. Each verdict links to the step that proves it. Around that check sits the rest of the story: every read, edit and command as a replayable timeline, and blame that tells you why each changed line was written.

**Try it in the browser:** https://dakshhhhh-ops.github.io/intent/ (three sample runs included; your own logs never leave your machine)

![The Brief: the agent's claims stamped against the log](docs/screenshots/brief.png)

## Measured on real sessions

In October 2026, Intent Replay was run over every Claude Code and Codex session on the author's machine: 87 sessions (78 Claude Code, 9 Codex), from small fixes to multi-day builds.

- **41** sessions ended with checkable claims (*tests pass*, *build passes*, *fixed*, *CI is green*, *only changed X*, *didn't touch the tests*): 519 claims in all.
- In **6 of those 41 sessions (15%)**, the agent's own log contradicts at least one claim it made: **12 claims** in all. Typical cases: "123 tests pass" after the last full run had 2 failures and only one test file was re-run; "Tests: 133 pass" when the output, cut short by `| grep`, shows a failing assertion; "all 6 tests pass" next to `1 failed`. All 12 were reviewed by hand: 10 are clear contradictions and 2 are borderline (one command ran unit and browser tests together and the failure was in a unit test; one claim was hedged by the agent itself).
- **324** claims are Supported, **168** Unverified and **15** Stale. Unverified is not a failure: it means the log holds no proof either way, for example a check that only ran in a scratch copy, a piped test run whose summary was cut off, or "CI is green" with no look at CI.
- **33** sessions have at least one high-severity finding: failing checks hidden by a pipe, credentials that ended up in the agent's context, silenced errors, weakened tests and risky commands. Only 6 of them are flagged for a credential alone. Placeholder values (`your-key-here`, `xxxx`, AWS's example key, local dev database passwords) and fake keys in test or fixture files are still masked but never flagged, so a "consider rotating it" finding means the value looked like a real key.
- The biggest session, 530 MB, opens in the browser. Parsing it takes about 2 seconds (down from 7.7) because API request dumps and base64 screenshots are dropped before decoding.

A green stamp has to be earned, so the Supported verdicts were reviewed too: three random samples of 30, each followed by fixes for whatever did not hold up. A passing check in a scratch copy no longer proves anything about the project; a claim about CI needs a CI run, read strictly and for the commit it names, and goes stale if new commits were pushed after the last look; a claim listing several fixes needs the full suite, not one narrow test; a test run counts only if its exit code is its own or its pass summary is still in the output; and "146 of 146 tests pass" backed by a run that printed `8 passed` is not proof. In the last sample, 27 of 30 Supported verdicts hold up; the other 3 rest on evidence that is related but weaker than the claim (for example a different workflow's CI run).

An outside review then ran the tool on a long chat-style session and found it reading headings, review tables and quoted UI text as claims, and counting a crashing `node -e` script as a test run. Headings, blockquotes, bold labels, long table rows and quoted text are no longer read as claims; "fixed" needs the agent to have edited something; inline scripts (`node -e`, `python -c`) are not checks; and phrasings it used to miss ("No tests fail", "0 failing", "Tests: ✅", "Nothing is broken") are now caught. All of these cases live in a regression set ([`tests/claims-regression.test.ts`](tests/claims-regression.test.ts)) that runs in CI and reports precision and recall, so accuracy can't quietly slip back. The set was written from hand-reviewed cases after the fixes, so it guards against regressions; it is not an independent benchmark.

Contradictions got the same treatment earlier: ESLint's `✖ 198 problems (0 errors, 198 warnings)` had been read as a failure, wrongly turning 28 true "all checks pass" claims into contradictions, and a failing test in a command that also ran `mypy` no longer counts against "mypy is clean". Noise came down too: findings went from 3,161 to 669 in the first round, and a check piped through `| tail` with nothing wrong in its output is now one note per run instead of one alarm per command.

Run the same audit on your own machine. It prints counts and stable session keys (no titles or prompts, so the output is safe to share), caches results, and nothing leaves your computer:

```bash
npx -y github:Dakshhhhh-ops/intent audit
```

## What it does

- **Fact-checks the agent's claims.** "All tests pass", "build succeeds", "only changed `cart.js`", "didn't touch the tests". Each claim in the agent's closing message is stamped **Supported**, **Contradicted**, **Stale** or **Unverified**, with a link to the step that proves it. It sees through `npm test | tail` (exit code hidden), re-running only one filtered test, and tests that passed before the code changed again.
- **Blame, but for intent.** Click any changed line to see the step that wrote it, the reason the agent gave just before, whether it had even read that file, and what had just failed.
- **Replays the run.** A timeline ("the tape") of every read, edit and command, with chapters (Explore, Change, Verify, Repair, Report). Scrub it, step through it with the keyboard, or press play and watch files light up in the file map.
- **Flags what a reviewer should look at.** Deterministic rules, no AI: weakened tests, blind edits, failure loops, silenced errors, risky commands, leaked secrets, new dependencies, churn, sensitive files, unverified finishes, masked exit codes.
- **Follows a run live.** `intent-replay watch` opens the session an agent is writing right now; the tape grows as it works and claims are checked the moment they're made.
- **Compares agents.** Put two runs of the same task side by side: how much each explored before editing, what it changed, whether it verified the final change, and whether its claims held up.
- **Fits your workflow.** A CLI that finds your local sessions, prints a PR-ready Markdown report, fails CI on high-severity findings, and exports a single offline HTML replay you can send to a reviewer.

| Replay | Blame with "why" |
|---|---|
| ![Replay](docs/screenshots/replay.png) | ![Changes](docs/screenshots/changes.png) |
| **Findings** | **Compare two agents** |
| ![Findings](docs/screenshots/findings.png) | ![Compare](docs/screenshots/compare.png) |

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
intent-replay watch               # follow the newest session live while the agent works
intent-replay report latest       # PR-ready Markdown (--out report.md, --json)
intent-replay check latest        # exit 1 on high findings (--fail-on medium|low)
intent-replay export latest -o replay.html   # one offline file, secrets masked
intent-replay audit               # fact-check every local session at once (counts and keys only, --json)
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
npm test             # unit tests: parsers, blame, claims, rules, large-log handling
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

Secrets are masked as soon as a log is read, in the UI, in every export and before the local server sends a log to the browser: provider keys (OpenAI, Anthropic, AWS, GitHub, GitLab, npm, Hugging Face, Slack, Stripe, SendGrid, Google), JWTs, private keys, `Bearer` tokens, passwords in URLs (`postgres://user:pass@…`), Azure connection strings, `NAME_KEY=` / `_TOKEN=` / `_SECRET=` assignments, and `password` / `token` / `api_key` values in JSON, YAML and config files. Masking is pattern-based, so review an export before sharing it outside your team.

The local viewer (`intent-replay`) listens on 127.0.0.1 only, answers only requests addressed to `127.0.0.1` or `localhost` (which blocks DNS-rebinding attacks from other websites), and requires a random per-run token that is part of the link it opens.

## Formats

- Claude Code session JSONL
- Codex CLI rollout JSONL (older `response_item` and newer `item_completed` formats)
- **Intent Trace JSON**, a small open format any agent can emit: [docs/TRACE_FORMAT.md](docs/TRACE_FORMAT.md)

## Sample runs

| Sample | What it shows |
|---|---|
| [`examples/cart-rounding.claude.jsonl`](examples/cart-rounding.claude.jsonl) | **Scripted scenario.** Fixing an off-by-a-cent cart total, the agent breaks discounts with a blind edit, rewrites a test to match, runs only that one test, and reports "All tests pass." The agent's decisions are scripted; every file and every test result in the log is real (generated by [`scripts/make-scripted-sample.mjs`](scripts/make-scripted-sample.mjs)). |
| [`examples/taskforge-handrail.intent.json`](examples/taskforge-handrail.intent.json) | **Real session.** An unscripted Claude Code session from building Handrail, an accessible project board. The agent reports "all 6 tests pass" after testing in a separate copy; its last browser test run printed `1 failed`, and a `| grep` at the end of the command hid that from the exit code. Trimmed with `--steps` to the part of the session where it happens. Machine paths are rewritten, and lines about a separate hackathon submission draft are removed with `--drop-files` and `--redact-lines`, each marked `[line removed]`; nothing else is changed. |
| [`examples/csv-quotes-claude.intent.json`](examples/csv-quotes-claude.intent.json) | **Recorded run.** A real headless Claude Code session fixing quoted CSV fields. Clean. |
| [`examples/csv-quotes-codex.intent.json`](examples/csv-quotes-codex.intent.json) | **Recorded run.** The same task given to Codex CLI. Clean. |

The two CSV runs are clean, so they show what a passing check looks like. The Handrail session is one of the 12 real contradictions from [Measured on real sessions](#measured-on-real-sessions); run `intent-replay audit` to find them in your own logs.

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

This project was planned and built with the Devpost Learn skill pack during the hackathon. The planning documents are in [`devpost/`](devpost): [scope](devpost/scope.md), [PRD](devpost/prd.md), [spec](devpost/spec.md) and the [build checklist](devpost/checklist.md). The [app map](devpost/app-map.html) is a one-page guide to the finished code: one action traced through three code stops, where to make common changes, and how to run it (download it and open it in a browser, or read it on [htmlpreview](https://htmlpreview.github.io/?https://github.com/Dakshhhhh-ops/intent/blob/main/devpost/app-map.html)).

## License

[MIT](LICENSE)
