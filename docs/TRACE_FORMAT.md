# Intent Trace format (v1)

The JSON format Intent Replay uses internally: Claude Code and Codex logs are converted to it, the bundled samples are stored in it, and **Share → Download trace (.json)** writes it, so exported runs can be opened again. It is documented here so another agent, or a converter for one, can produce it and get the same replay and claim checks. No agent writes it natively today.

Only `steps` is required. Unknown fields are ignored.

```json
{
  "format": "intent-trace",
  "version": 1,
  "title": "Fix the cart total rounding bug",
  "cwd": "/home/dev/shop-cart",
  "model": "my-model",
  "agentVersion": "MyAgent 0.4",
  "startedAt": "2026-10-22T14:03:11Z",
  "steps": [
    { "kind": "prompt", "t": "2026-10-22T14:03:11Z", "text": "Customers say the total is off by a cent. Fix it." },
    { "kind": "message", "text": "I'll look at how the total is computed." },
    { "kind": "read", "read": { "path": "src/cart.js", "full": true, "content": "…file content…" } },
    {
      "kind": "edit",
      "intent": "toCents truncates; switch to rounding.",
      "edit": {
        "path": "src/cart.js",
        "op": "update",
        "edits": [{ "oldString": "Math.floor(value * 100)", "newString": "Math.round(value * 100)" }]
      }
    },
    { "kind": "command", "command": { "cmd": "npm test", "exitCode": 1, "output": "ℹ tests 6\nℹ pass 3\nℹ fail 3" } },
    { "kind": "message", "text": "All tests pass." }
  ]
}
```

## Step fields

| Field | Type | Notes |
|---|---|---|
| `kind` | `prompt` · `message` · `thinking` · `plan` · `read` · `search` · `edit` · `create` · `delete` · `command` · `web` · `subagent` · `tool` | Required. |
| `t` | ISO time or epoch ms | Optional; enables durations. |
| `actor` | `user` · `agent` · `subagent` | Defaults from `kind`. |
| `title` | string | Shown in lists; generated when missing. |
| `intent` | string | What the agent said it was doing. Shown as the "why". |
| `text` | string | For prompts, messages and thinking. |
| `files` | string[] | Paths the step touched. |
| `read` | `{ path, full, content?, startLine? }` | A full read with `content` lets the viewer rebuild the file. |
| `edit` | `{ path, op, before?, after?, edits?, patch?, added?, removed? }` | Give any of: `edits` (string replacements), `patch` (unified diff), or `after` (whole new content). `op` is `create`, `update` or `delete`. |
| `command` | `{ cmd, exitCode, output, durationMs?, categories? }` | `categories` (test, build, typecheck, lint, install, git, run, read, search) are inferred from `cmd` when missing. |
| `search` | `{ pattern, path?, output? }` | |
| `plan` | `{ items: [{ text, status }] }` | `status`: `pending`, `in_progress`, `completed`. |
| `usage` | `{ input, output, cached }` | Token counts, optional. |

Paths should be relative to `cwd`. Mask secrets before writing a trace; Intent Replay masks common credential formats again when it reads one.
