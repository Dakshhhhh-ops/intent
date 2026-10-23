// Sample runs bundled into the viewer, read straight from /examples (the same files you can
// drag into the app). `label` says honestly where each run came from.

const files = import.meta.glob('../../examples/*.{jsonl,json}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Sample {
  id: string;
  file: string;
  title: string;
  blurb: string;
  label: string;
  agent: string;
  text: string;
}

const MANIFEST: Omit<Sample, 'text'>[] = [
  {
    id: 'cart-rounding',
    file: 'cart-rounding.claude.jsonl',
    title: '“All tests pass.” They didn’t.',
    blurb: 'Asked to fix an off-by-a-cent cart total, the agent breaks discounts with a blind edit, rewrites a test to match, runs only that one test, and reports success.',
    label: 'Scripted scenario',
    agent: 'Claude Code format',
  },
  {
    id: 'csv-quotes-claude',
    file: 'csv-quotes-claude.intent.json',
    title: 'Quoted CSV fields, fixed cleanly',
    blurb: 'A real headless Claude Code run: it reads the parser and its tests, rewrites one function and runs the whole suite. Every claim checks out.',
    label: 'Recorded run',
    agent: 'Claude Code',
  },
  {
    id: 'csv-quotes-codex',
    file: 'csv-quotes-codex.intent.json',
    title: 'Same bug, handed to Codex',
    blurb: 'The identical task given to Codex CLI. Compare how it explored the repo, what it changed and how it proved the fix.',
    label: 'Recorded run',
    agent: 'Codex CLI',
  },
];

export const SAMPLES: Sample[] = MANIFEST.filter((m) => files[`../../examples/${m.file}`]).map((m) => ({ ...m, text: files[`../../examples/${m.file}`] }));
