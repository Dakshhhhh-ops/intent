import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The viewer is built into ONE html file, hosted and served by the CLI.
// `vite build --mode export` builds a second, lighter page used for exported replays: the same run
// views, without the home page (Three.js, GSAP, the 3D hero) or the bundled sample runs.

/** In the export build, the home page and the sample runs are swapped for small stubs. */
function exportStubs(): Plugin {
  return {
    name: 'intent-replay-export-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !/[\\/]src[\\/]ui[\\/]/.test(importer)) return null;
      if (source === './Home') return resolve('src/ui/HomeStub.tsx');
      if (source === '../samples' || source === '../samples/index') return resolve('src/samples/none.ts');
      return null;
    },
  };
}

export default defineConfig(({ mode }) =>
  mode === 'export'
    ? {
        base: './',
        plugins: [exportStubs(), react(), viteSingleFile()],
        build: { outDir: 'dist-export', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 4000, rollupOptions: { input: resolve('export.html') } },
      }
    : {
        base: './',
        plugins: [react(), viteSingleFile()],
        build: { outDir: 'dist', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 4000 },
      },
);
