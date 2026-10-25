import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
const buildStamp = new Date().toISOString();
export default defineConfig({
  main: { build: { minify: true, externalizeDeps: false, rollupOptions: { input: resolve('src/main/index.ts'), external: ['electron', 'bufferutil', 'utf-8-validate'] } } },
  preload: { build: { minify: true, externalizeDeps: false, rollupOptions: { input: resolve('src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  // Independent scale/translate/rotate have separate overrides and transitions.
  // CSS minification folds scale into transform and breaks that cascade.
  renderer: { root: 'src/renderer', plugins: [react()], build: { minify: true, cssMinify: false }, define: { __GLASS_BUILD__: JSON.stringify(buildStamp) }, server: { host: '127.0.0.1' } },
});
