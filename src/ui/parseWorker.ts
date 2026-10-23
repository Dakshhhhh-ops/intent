/// <reference lib="webworker" />
import { parseTrace, UnsupportedFormatError } from '../core/parse/detect';
import { slimStream } from '../core/parse/slim';

// Reads and parses a dropped log off the main thread, so a large session never freezes the page.
// The analysis runs back on the main thread: it holds functions that cannot cross threads.

export type WorkerReply =
  | { type: 'progress'; bytes: number; parsing?: boolean }
  | { type: 'done'; trace: import('../core/types').Trace }
  | { type: 'error'; unsupported: boolean; message: string };

const post = (m: WorkerReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  const { file } = e.data;
  try {
    let last = 0;
    const text = await slimStream(file.stream(), (bytes) => {
      const now = performance.now();
      if (now - last > 60) {
        last = now;
        post({ type: 'progress', bytes });
      }
    });
    post({ type: 'progress', bytes: file.size, parsing: true });
    post({ type: 'done', trace: parseTrace(text, file.name) });
  } catch (err) {
    post({ type: 'error', unsupported: err instanceof UnsupportedFormatError, message: (err as Error).message });
  }
};
