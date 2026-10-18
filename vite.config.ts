import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI lives in ui/; Tauri expects a fixed dev port and serves dist/ in production.
export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  worker: { format: 'es' },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: ['es2022', 'safari15', 'chrome100'],
    sourcemap: true,
  },
  test: {
    root: '.',
    include: ['ui/src/**/*.test.ts'],
  },
});
