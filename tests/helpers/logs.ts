// Emit synthetic Claude Code and Codex JSONL in the real on-disk shapes.

type Json = Record<string, unknown>;

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

export class ClaudeLog {
  lines: Json[] = [];
  private n = 0;
  private toolN = 0;
  constructor(
    public opts: { cwd?: string; sessionId?: string; model?: string; version?: string; gitBranch?: string } = {},
  ) {
    this.opts = { cwd: '/home/dev/proj', sessionId: 'sess-123', model: 'claude-test-1', version: '2.0.1', gitBranch: 'main', ...opts };
  }

  private base(type: string, extra: Json = {}): Json {
    this.n++;
    return {
      type,
      uuid: `uuid-${this.n}`,
      sessionId: this.opts.sessionId,
      cwd: this.opts.cwd,
      version: this.opts.version,
      gitBranch: this.opts.gitBranch,
      timestamp: new Date(T0 + this.n * 1000).toISOString(),
      ...extra,
    };
  }

  raw(o: Json): this {
    this.lines.push(o);
    return this;
  }

  prompt(text: string): this {
    this.lines.push(this.base('user', { message: { role: 'user', content: text } }));
    return this;
  }

  private assistant(block: Json, msgId = `msg-${this.n + 1}`, usage = true): void {
    this.lines.push(
      this.base('assistant', {
        message: {
          id: msgId,
          model: this.opts.model,
          role: 'assistant',
          content: [block],
          usage: usage
            ? { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 2 }
            : undefined,
        },
      }),
    );
  }

  text(text: string, msgId?: string): this {
    this.assistant({ type: 'text', text }, msgId);
    return this;
  }

  thinking(thinking: string, msgId?: string): this {
    this.assistant({ type: 'thinking', thinking }, msgId);
    return this;
  }

  toolUse(name: string, input: Json, msgId?: string): string {
    const id = `toolu_${++this.toolN}`;
    this.assistant({ type: 'tool_use', id, name, input }, msgId);
    return id;
  }

  toolResult(id: string, content: string, toolUseResult?: unknown, isError = false): this {
    const block: Json = { type: 'tool_result', tool_use_id: id, content };
    if (isError) block.is_error = true;
    this.lines.push(this.base('user', { message: { role: 'user', content: [block] }, toolUseResult }));
    return this;
  }

  // ---- convenience wrappers matching real tool result shapes

  read(filePath: string, content: string, opts: { offset?: number; limit?: number; startLine?: number; totalLines?: number } = {}): this {
    const input: Json = { file_path: filePath };
    if (opts.offset) input.offset = opts.offset;
    if (opts.limit) input.limit = opts.limit;
    const id = this.toolUse('Read', input);
    const numLines = content.split('\n').length;
    return this.toolResult(id, content, {
      type: 'text',
      file: { filePath, content, numLines, startLine: opts.startLine ?? 1, totalLines: opts.totalLines ?? numLines },
    });
  }

  edit(filePath: string, oldString: string, newString: string, patch?: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[]): this {
    const id = this.toolUse('Edit', { file_path: filePath, old_string: oldString, new_string: newString });
    return this.toolResult(id, `The file ${filePath} has been updated.`, {
      filePath,
      oldString,
      newString,
      originalFile: null,
      structuredPatch: patch ?? [],
      replaceAll: false,
    });
  }

  write(filePath: string, content: string, type: 'create' | 'update' = 'create', originalFile: string | null = null): this {
    const id = this.toolUse('Write', { file_path: filePath, content });
    return this.toolResult(id, `File created successfully at: ${filePath}`, {
      type,
      filePath,
      content,
      structuredPatch: [],
      originalFile,
    });
  }

  bash(command: string, result: { stdout?: string; stderr?: string; exit?: number; interrupted?: boolean } = {}, description?: string): this {
    const input: Json = { command };
    if (description) input.description = description;
    const id = this.toolUse('Bash', input);
    const exit = result.exit ?? 0;
    if (exit !== 0) {
      const body = [result.stdout, result.stderr].filter(Boolean).join('\n');
      return this.toolResult(id, `Exit code ${exit}\n${body}`, `Error: Exit code ${exit}\n${body}`, true);
    }
    return this.toolResult(id, result.stdout ?? '', { stdout: result.stdout ?? '', stderr: result.stderr ?? '', interrupted: !!result.interrupted });
  }

  toString(): string {
    return this.lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  }
}

export class CodexLog {
  lines: Json[] = [];
  private n = 0;
  constructor(public turnId = 'turn-1') {}

  private rec(type: string, payload: Json): this {
    this.n++;
    this.lines.push({ timestamp: new Date(T0 + this.n * 1000).toISOString(), type, payload });
    return this;
  }

  meta(cwd = '/work/app', id = 'codex-sess-1', cli_version = '0.50.0'): this {
    return this.rec('session_meta', { id, cwd, cli_version });
  }

  context(model = 'gpt-test', cwd = '/work/app'): this {
    return this.rec('turn_context', { model, cwd });
  }

  item(item: Json, turnId = this.turnId): this {
    return this.rec('event_msg', { type: 'item_completed', turn_id: turnId, item });
  }

  user(text: string): this {
    return this.item({ type: 'UserMessage', content: [{ type: 'text', text }] });
  }

  agent(text: string): this {
    return this.item({ type: 'AgentMessage', content: [{ type: 'Text', text }] });
  }

  exec(command: string, opts: { parsed?: Json[]; exit?: number; output?: string; secs?: number } = {}): this {
    return this.item({
      type: 'CommandExecution',
      command: ['bash', '-lc', command],
      parsed_cmd: opts.parsed ?? [{ type: 'unknown', cmd: command }],
      exit_code: opts.exit ?? 0,
      aggregated_output: opts.output ?? '',
      status: (opts.exit ?? 0) === 0 ? 'completed' : 'failed',
      duration: { secs: opts.secs ?? 1, nanos: 500_000_000 },
    });
  }

  fileChange(changes: Record<string, Json>): this {
    return this.item({ type: 'FileChange', changes });
  }

  responseItem(payload: Json): this {
    return this.rec('response_item', payload);
  }

  /**
   * Codex 0.162+ "exec" cell: a JS snippet calling tools.exec_command, logged as a custom tool call
   * (no CommandExecution item). `json` prints the whole result object, as some cells do.
   */
  execCell(cmd: string, opts: { output?: string; exit?: number; json?: boolean; failed?: string } = {}, turnId = this.turnId): this {
    const callId = `call_${this.n + 1}`;
    const meta = { internal_chat_message_metadata_passthrough: { turn_id: turnId } };
    const input = opts.json
      ? `const r = await tools.exec_command({cmd:${JSON.stringify(cmd)},"max_output_tokens":2000}); text(JSON.stringify(r))\n`
      : `const r = await tools.exec_command({cmd:${JSON.stringify(cmd)},"workdir":"/work/app","max_output_tokens":2000}); text(r.output)\n`;
    this.responseItem({ type: 'custom_tool_call', status: 'completed', call_id: callId, name: 'exec', input, ...meta });
    const body = opts.failed
      ? [{ type: 'input_text', text: 'Script failed\nWall time 0.4 seconds\nOutput:\n' }, { type: 'input_text', text: `Script error:\n${opts.failed}` }]
      : [
          { type: 'input_text', text: 'Script completed\nWall time 1.2 seconds\nOutput:\n' },
          { type: 'input_text', text: opts.json ? JSON.stringify({ chunk_id: 'a1', wall_time_seconds: 1.2, exit_code: opts.exit ?? 0, original_token_count: 10, output: opts.output ?? '' }) : opts.output ?? '' },
        ];
    return this.responseItem({ type: 'custom_tool_call_output', call_id: callId, output: body, ...meta });
  }

  /** A file edit inside an exec cell (tools.apply_patch). */
  patchCell(patch: string, turnId = this.turnId): this {
    const callId = `call_${this.n + 1}`;
    const meta = { internal_chat_message_metadata_passthrough: { turn_id: turnId } };
    this.responseItem({ type: 'custom_tool_call', status: 'completed', call_id: callId, name: 'exec', input: `const patch = ${JSON.stringify(patch)}; text(await tools.apply_patch(patch));\n`, ...meta });
    return this.responseItem({ type: 'custom_tool_call_output', call_id: callId, output: [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text: 'Success.' }], ...meta });
  }

  event(payload: Json): this {
    return this.rec('event_msg', payload);
  }

  toString(): string {
    return this.lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  }
}
