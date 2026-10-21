import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
// Windows forks workers abort (0xC0000409) once the host-contract suite grew;
// the same suite is stable in worker threads, so the whole run uses threads.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 10000, pool: 'threads',
  // Electron belongs to the desktop workspace. Resolve the same module in
  // Node-based controller tests so vi.mock cannot accidentally import its installer.
  alias: { electron: fileURLToPath(new URL('./apps/desktop/node_modules/electron/index.js', import.meta.url)) },
} });
