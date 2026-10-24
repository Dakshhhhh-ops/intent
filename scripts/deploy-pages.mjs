// Publishes dist/index.html to the gh-pages branch (GitHub Pages). Run `npm run build:web` first.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// In GitHub Actions the push URL (with the workflow token) comes from PAGES_REMOTE; locally, origin.
const remote = process.env.PAGES_REMOTE || execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
const dir = mkdtempSync(join(tmpdir(), 'intent-pages-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });
copyFileSync('dist/index.html', join(dir, 'index.html'));
writeFileSync(join(dir, '.nojekyll'), '');
git('init', '-q', '-b', 'gh-pages');
git('add', '-A');
git('commit', '-q', '-m', 'Deploy Intent Replay viewer');
git('push', '-q', '-f', remote, 'gh-pages');
rmSync(dir, { recursive: true, force: true });
console.log('deployed to gh-pages');
