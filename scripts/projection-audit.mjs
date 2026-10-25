// Local synthetic Main/preload benchmark; no DSH data, credentials or UI FPS claims.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serialize } from 'node:v8';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';

const output = resolve('reports/optimization');
const beforePath = process.argv[2] ?? resolve(output, 'projection-channel-before.ts');
async function load(path) {
  const source = await readFile(path, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}
function fixture() {
  const session = { runtimeId: 'runtime', sessionId: 's0', title: 'synthetic session', workspaceLabel: 'fixture', agentStatus: 'running', phase: 'working', lastSourceSeq: 100, stats: undefined,
    todos: Array.from({ length: 1000 }, (_, i) => ({ content: 'todo ' + i, status: 'pending' })),
    activities: Array.from({ length: 100 }, (_, i) => ({ callId: 'call' + i, toolName: 'read', summary: 'summary '.repeat(20), sourceSeq: i, status: 'success' })),
    notes: Array.from({ length: 60 }, (_, i) => ({ id: 'note' + i, kind: 'message', text: 'history '.repeat(225), sourceSeq: i })) };
  return { connection: 'connected', stale: false, source: 'dsh', runtimeId: 'runtime', epoch: 'epoch', capabilities: { observeSessions: true, observeTodos: true, observeTools: true, respondApproval: false, respondQuestion: false }, approvals: [], questions: [], seen: [], removedSessions: {},
    sessions: Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['s' + i, { ...structuredClone(session), sessionId: 's' + i }])) };
}
function sample(api, fullEvery) {
  const publisher = new api.ProjectionPublisher(fullEvery), receiver = new api.ProjectionReceiver();
  let state = fixture();
  receiver.accept(structuredClone(publisher.snapshot(state)));
  let wireBytes = 0, snapshots = 0;
  const started = performance.now();
  for (let i = 0; i < 360; i++) {
    const session = structuredClone(state.sessions.s0);
    session.lastSourceSeq++; session.notes[0] = { ...session.notes[0], text: 'token '.repeat(1 + i % 100), streaming: true };
    state = { ...state, seen: [...state.seen, 'frame' + i].slice(-512), sessions: { ...state.sessions, s0: session } };
    const message = publisher.next(state);
    wireBytes += serialize(message).byteLength;
    if (message.kind === 'snapshot') snapshots++;
    assert.equal(receiver.accept(structuredClone(message)).needsSync, false);
  }
  const elapsedMs = performance.now() - started;
  assert.ok(isDeepStrictEqual(receiver.current, state), 'reconstructed projection must match the complete fixture');
  return { updates: 360, wireBytes, snapshots, elapsedMs };
}
const before = await load(beforePath), after = await load(resolve('apps/desktop/src/shared/projection-channel.ts'));
const report = { scope: 'Synthetic 100 sessions, selected session with 1000 todos / 100 activities / 60 notes; 360 streaming updates. V8 serialized bytes and Node structured-clone round trips through the actual publisher/receiver. Excludes contextBridge-to-page cloning, rendering and DSH Host.', scenarios: [] };
// Warm up both implementations; alternate order to reduce first-run bias.
sample(before, 300); sample(after, 300);
for (const fullEvery of [Number.MAX_SAFE_INTEGER, 300]) {
  const rounds = { before: [], after: [] };
  for (let i = 0; i < 3; i++) for (const key of i % 2 ? ['after', 'before'] : ['before', 'after']) rounds[key].push(sample(key === 'before' ? before : after, fullEvery));
  const summarize = values => ({ ...values[0], elapsedMs: values.map(v => v.elapsedMs).sort((a, b) => a - b)[1] });
  const a = summarize(rounds.before), b = summarize(rounds.after);
  assert.ok(b.wireBytes < a.wireBytes);
  report.scenarios.push({ fullEvery, before: a, after: b, savedBytesPercent: (1 - b.wireBytes / a.wireBytes) * 100, reducedRoundTripTimePercent: (1 - b.elapsedMs / a.elapsedMs) * 100 });
}
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'projection-comparison.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
