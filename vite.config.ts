import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The viewer is built into ONE html file: the same artifact is hosted,
// served by the CLI, and used as the template for exported replays.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 4000 },
});
