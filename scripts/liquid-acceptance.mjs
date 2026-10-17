import { runAcceptance } from './desktop-smoke.mjs';
await runAcceptance({ native: process.argv.includes('--native') });
