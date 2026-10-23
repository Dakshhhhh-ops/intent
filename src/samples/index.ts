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
];

export const SAMPLES: Sample[] = MANIFEST.filter((m) => files[`../../examples/${m.file}`]).map((m) => ({ ...m, text: files[`../../examples/${m.file}`] }));
