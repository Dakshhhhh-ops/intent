// Stand-in for the home page in exported replays (see vite.config.ts): an export always opens
// straight into its embedded run, so this only shows if the file was opened without one.

export function Home(_props: Record<string, unknown>) {
  return (
    <div className="page" style={{ padding: '80px 20px', textAlign: 'center' }}>
      <h1 style={{ margin: 0 }}>Intent Replay</h1>
      <p style={{ color: 'var(--text-2)' }}>This exported replay has no run embedded in it.</p>
      <p>
        <a href="https://dakshhhhh-ops.github.io/intent/">Open the full viewer</a>
      </p>
    </div>
  );
}
