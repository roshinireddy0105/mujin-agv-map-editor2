import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * `@agv/shared` is aliased straight at its TypeScript source rather than a
 * build artefact, so the domain layer needs no separate compile step and edits
 * to a validation rule hot-reload in the editor.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@agv/shared': path.resolve(__dirname, '../shared/src/index.ts') },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
