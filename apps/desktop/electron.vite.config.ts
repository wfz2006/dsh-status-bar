import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
const buildStamp = new Date().toISOString();
export default defineConfig({
  main: { build: { externalizeDeps: false, rollupOptions: { input: resolve('src/main/index.ts'), external: ['electron', 'bufferutil', 'utf-8-validate'] } } },
  preload: { build: { externalizeDeps: false, rollupOptions: { input: resolve('src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: { root: 'src/renderer', plugins: [react()], define: { __GLASS_BUILD__: JSON.stringify(buildStamp) }, server: { host: '127.0.0.1' } },
});
