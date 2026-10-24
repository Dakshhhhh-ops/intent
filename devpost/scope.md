---
doc: scope
status: approved
---

# Intent Replay

Debug what an AI coding agent actually did: turn one agent run into a replayable, fact-checked decision trace.

## The Unique Kernel

**Every line in the agent's diff is linked back to the moment it was written, the reason the agent gave, and the evidence it had at that time — and the agent's closing summary is fact-checked against what actually ran.**

A diff tells you *what* changed. Intent Replay tells you *why*, *on what evidence*, and *whether the agent's "all tests pass" was true*. If you deleted this, you would be left with a log viewer, and log viewers already exist.

## Who It's For

A developer who lets Claude Code or Codex work on their repo and then has to decide whether to merge the result. Today they read the final diff plus a cheerful summary ("Fixed the bug, all tests pass"), and either trust it or scroll through hundreds of lines of raw transcript. The secondary user is the teammate reviewing that PR, who never saw the run at all.

## The Core Loop

1. An agent finishes a task.
2. The developer opens the run in Intent Replay (pick it from the list of local sessions, drop the log file in the browser, or `npx intent-replay`).
3. They read the **Brief**: the run as a short story in chapters, a verdict on every claim the agent made, and the handful of things worth reviewing first.
4. They click a suspicious change and land on the exact step that produced it: what the agent said it was doing, which files it had read, what had just failed.
5. They scrub the replay to watch the run unfold, then merge, push back, or attach the report to the PR.

They come back after every agent run they don't fully trust — which is most of them.

## Inspiration & Identity

- A flight recorder / black box for agents: calm, precise, forensic. Something you trust in an incident review.
- Video-editor style timeline ("the tape") with lanes for reads, edits, commands and messages, and a playhead you can scrub.
- `git blame`, but for intent.
- Dark instrument-panel look by default, with a clean light theme. Monospace where it is code, a sharp sans for everything else.

## Why This Matters to the Learner

The learner builds with agents every day across several projects and has seen the diff hide the real story. They want a product other developers would actually adopt, and they want to win.

## What "Working" Looks Like

Open a real Claude Code (or Codex) session log. Within seconds the Brief shows: *"Agent claimed: all tests pass — Contradicted: the last test run (step 41) exited 1."* Click the finding, land on step 41, scrub back and watch the agent loosen a test assertion two steps earlier. Click a changed line in the diff and see the reason the agent gave and the three files it had read before writing it.

**The "oh, that's cool" beat:** the agent's confident summary gets a red "Contradicted" stamp, with a link to the exact command that proves it.

## The POC Boundary

- Import a single run from Claude Code JSONL and Codex rollout JSONL (plus our own small open "Intent Trace" JSON format).
- Normalize it into one timeline of steps: prompts, agent messages, reads, searches, edits, commands (with exit codes), plans.
- Reconstruct file changes and attribute every added line to the step that wrote it.
- Deterministic analysis, no AI and no API keys: phases, findings (blind edits, failure loops, weakened tests, silenced errors, risky commands, leaked secrets, churn, new dependencies) and claim checking.
- A browser viewer: Brief, Replay (tape + step inspector), Changes (blame), Findings.
- A CLI that finds local sessions and opens them, prints a Markdown report for a PR, and fails CI on high-severity findings.
- Everything runs locally; nothing is uploaded.

## Later

- ~~Live mode: watch a run as it happens.~~ Built after the core (`intent-replay watch`).
- ~~Comparing two runs of the same task.~~ Built after the core (Compare view).
- A GitHub Action that posts the report on every agent-authored PR.
- More agents (Gemini CLI, Cursor, Aider).
- Optional AI-written narrative on top of the deterministic facts.

## Explicitly Cut

- **Accounts, cloud storage, team dashboards** — logs contain source code and secrets; local-first is the point, and a backend adds nothing to the proof.
- **Recording agents ourselves (a wrapper/proxy)** — agents already write detailed logs; reading them works with zero setup.
- **LLM-powered "explanations" in the core** — auditing an AI with another AI undermines trust; findings must be reproducible facts.
- **Editing or re-running the agent from the viewer** — this is a forensic tool, not an agent IDE.
