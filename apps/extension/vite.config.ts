import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Two entries: the new-tab page (index.html) and the background service
// worker. The worker is an ES module ("type": "module" in the manifest),
// so rollup code-splitting between the two entries is fine.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@panodash/core': resolve(import.meta.dirname, '../../packages/core/src'),
      '@panodash/widget-sdk': resolve(import.meta.dirname, '../../packages/widget-sdk/src'),
      '@panodash/providers': resolve(import.meta.dirname, '../../packages/providers/src'),
      '@panodash/ui': resolve(import.meta.dirname, '../../packages/ui/src'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        newtab: resolve(import.meta.dirname, 'index.html'),
        background: resolve(import.meta.dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
