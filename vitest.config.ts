import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@panodash/bridge-core': resolve(import.meta.dirname, 'packages/bridge-core/src'),
      '@panodash/core': resolve(import.meta.dirname, 'packages/core/src'),
      '@panodash/widget-sdk': resolve(import.meta.dirname, 'packages/widget-sdk/src'),
      '@panodash/providers': resolve(import.meta.dirname, 'packages/providers/src'),
      '@panodash/ui': resolve(import.meta.dirname, 'packages/ui/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
