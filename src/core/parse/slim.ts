// Agent logs are mostly weight the replay never shows: Claude Code writes full API request dumps
// and file-history snapshots, and screenshots are stored as base64. On a 530 MB session that is
// over 85% of the bytes. Dropping it before JSON.parse makes big logs open several times faster
// and keeps them under the JavaScript string size limit (about 512 MB in V8).

/** Claude Code bookkeeping records the parser skips anyway. They always start with their type. */
const SKIP = /^\{"type":"(api-request|api-request-blob|api-request-shape|file-history-snapshot|file-history-delta|last-prompt|atis-latch|mode)"/;

/** Inline images: `"data":"<base64>"` blocks and `data:image/...;base64,` URLs. */
const BLOB = /("data":")[A-Za-z0-9+/=]{2048,}(")|(data:image\/[\w.+-]+;base64,)[A-Za-z0-9+/=]{2048,}/g;

/** Lines shorter than this cannot hold a blob worth stripping. */
const BLOB_MIN_LINE = 4096;

/** The line with dead weight removed, or null when the whole line can be skipped. */
export function slimLine(line: string): string | null {
  if (line.length > 20 && line.charCodeAt(0) === 123 /* { */ && SKIP.test(line.slice(0, 48))) return null;
  if (line.length < BLOB_MIN_LINE) return line;
  return line.replace(BLOB, (_m, a?: string, b?: string, url?: string) => (url ? url : `${a}${b}`));
}

/**
 * Slims a log as it arrives in pieces. JSONL is slimmed line by line; anything else (an Intent
 * Trace JSON document) is kept as is.
 */
export class Slimmer {
  private decoder = new TextDecoder();
  private kept: string[] = [];
  private raw: string[] = [];
  private rest = '';
  private jsonl: boolean | null = null;
  bytes = 0;

  push(chunk: Uint8Array): void {
    this.bytes += chunk.byteLength;
    this.text(this.decoder.decode(chunk, { stream: true }), false);
  }

  pushText(text: string): void {
    this.text(text, false);
  }

  finish(): string {
    this.text(this.decoder.decode(), true);
    return this.jsonl === false ? this.raw.join('') : this.kept.join('\n');
  }

  private text(chunk: string, done: boolean): void {
    if (this.jsonl === null) {
      const head = (this.rest + chunk).trimStart();
      if (head) {
        // JSONL when the first line closes before the second record starts.
        const nl = head.indexOf('\n');
        if (nl < 0 && !done && head.length < 1_000_000) {
          this.rest += chunk;
          return;
        }
        this.jsonl = head.startsWith('{') && nl >= 0 && /^\s*\{/.test(head.slice(nl + 1, nl + 64) || '{');
        if (!this.jsonl) {
          this.raw.push(this.rest, chunk);
          this.rest = '';
          return;
        }
      }
    }
    if (this.jsonl === false) {
      this.raw.push(chunk);
      return;
    }
    const text = this.rest + chunk;
    const end = done ? text.length : text.lastIndexOf('\n');
    if (end < 0) {
      this.rest = text;
      return;
    }
    let i = 0;
    while (i < end) {
      let j = text.indexOf('\n', i);
      if (j < 0 || j > end) j = end;
      const line = slimLine(text.slice(i, j).trim());
      if (line) this.kept.push(line);
      i = j + 1;
    }
    this.rest = done ? '' : text.slice(end + 1);
  }
}

/** Slims a log that is already a string (a sample, or text fetched from the CLI). */
export function slimLog(text: string): string {
  const s = new Slimmer();
  s.pushText(text);
  return s.finish();
}

/** Slims a log held in memory as bytes, in chunks, so it never needs one giant string. */
export function slimBytes(buf: Uint8Array, chunk = 16 * 1024 * 1024): string {
  const s = new Slimmer();
  for (let i = 0; i < buf.byteLength; i += chunk) s.push(buf.subarray(i, Math.min(buf.byteLength, i + chunk)));
  return s.finish();
}

/** Slims a log from a stream (a dropped File in the browser), reporting bytes read. */
export async function slimStream(stream: ReadableStream<Uint8Array>, onProgress?: (bytes: number) => void): Promise<string> {
  const reader = stream.getReader();
  const s = new Slimmer();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    s.push(value);
    onProgress?.(s.bytes);
  }
  return s.finish();
}
