import { defineConfig } from 'vitest/config';
// Windows forks workers abort (0xC0000409) once the host-contract suite grew;
// the same suite is stable in worker threads, so the whole run uses threads.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 10000, pool: 'threads' } });
