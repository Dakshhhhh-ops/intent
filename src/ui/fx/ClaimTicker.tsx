// Two tilted strips of things agents say at the end of a run, sliding past in opposite
// directions, each stamped with how the claim held up. Decorative: the real check is in the Brief.

type Verdict = 'supported' | 'contradicted' | 'stale' | 'unverified';

// Every line here is a sentence the claim checker recognizes (src/core/analyze/claims.ts),
// so anyone who types one into a run summary sees it checked for real.
const ROW_A: [string, Verdict][] = [
  ['All tests pass.', 'contradicted'],
  ['Only changed `cart.js`.', 'supported'],
  ['The build succeeds.', 'unverified'],
  ["Didn't change any tests.", 'contradicted'],
  ['I fixed the rounding bug.', 'supported'],
  ['Tests are green.', 'stale'],
];

const ROW_B: [string, Verdict][] = [
  ['Type check passes.', 'supported'],
  ['Lint is clean.', 'unverified'],
  ['All 6 tests pass.', 'contradicted'],
  ['Only changed `src/cart.js`.', 'supported'],
  ['All 12 tests pass.', 'stale'],
  ["Didn't touch the tests.", 'contradicted'],
];

const LABEL: Record<Verdict, string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  stale: 'Stale',
  unverified: 'Unverified',
};

function Row({ items, reverse }: { items: [string, Verdict][]; reverse?: boolean }) {
  // Content is doubled so the loop can slide exactly half its width and wrap seamlessly.
  const all = [...items, ...items];
  return (
    <div className={`fx-ticker-row ${reverse ? 'rev' : ''}`}>
      <div className="fx-ticker-track">
        {all.map(([text, v], i) => (
          <span className="fx-ticker-item" key={i}>
            <q>
              {text.split('`').map((part, j) => (j % 2 ? <code key={j}>{part}</code> : part))}
            </q>
            <span className={`fx-tstamp ${v}`}>{LABEL[v]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ClaimTicker() {
  return (
    <div className="fx-ticker" aria-hidden="true">
      <div className="fx-ticker-tilt">
        <Row items={ROW_A} />
        <Row items={ROW_B} reverse />
      </div>
    </div>
  );
}
