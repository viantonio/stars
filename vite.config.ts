import { defineConfig } from 'vitest/config';

// `base` is relative so the build works from any sub-path (e.g. GitHub Pages
// serving https://<user>.github.io/stars/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  // satellite.js ships an optional WASM/pthreads build (unused here) whose
  // worker uses top-level await, which needs ES-module workers.
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
