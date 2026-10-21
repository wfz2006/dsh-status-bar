// Adapted workload from the supplied performance lab; this version uses the
// real Windows Electron main/preload/renderer and a synthetic HTTP/WS Host.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';
import { FakeHost } from '../tests/helpers/dsh-host.ts';

const args = Object.fromEntries(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
const label = args.label ?? 'candidate'; if (!/^[\w-]+$/.test(label)) throw new Error('Invalid label');
const appDirectory = resolve(args.app ?? 'apps/desktop'); const reps = Number(args.reps ?? 2); const duration = Number(args.duration ?? 4000); const throttle = Number(args.throttle ?? 1);
const output = resolve('reports/report-remediation'); await mkdir(output, { recursive: true });
const cases = [
  { name: 'expanded-160', count: 3, notes: 60, activities: 100, todos: 24, mode: 'expanded' },
  { name: 'steps-1000', count: 1, notes: 60, activities: 100, todos: 1000, mode: 'expanded', steps: true },
  { name: 'sessions-100', count: 100, notes: 10, activities: 10, todos: 10, mode: 'expanded' },
  { name: 'capsule-long', count: 1, notes: 60, activities: 100, todos: 24, mode: 'capsule', long: true },
].filter(value => !args.scenarios || args.scenarios.split(',').includes(value.name));
const results = [];
for (const scenario of cases) for (let rep = 0; rep < reps; rep++) {
  const host = new FakeHost(); let f; let timer;
  const todos = Array.from({ length: scenario.todos }, (_, i) => ({ content: '任务 ' + i + '：检查会话状态并保持全部功能。', status: i === 0 ? 'in_progress' : i % 3 ? 'pending' : 'completed' }));
  host.sessions = Array.from({ length: scenario.count }, (_, i) => ({ sessionId: 's' + i, title: (scenario.long ? '用于核验完整长标题与所有状态的鲸鱼工作台🧪'.repeat(5) : '性能会话 ') + i,
    running: true, todos, stats: { sessionStats: { turns: 40, steps: 120 }, tokenUsage: { uncachedInputTokens: 120000, cacheReadTokens: 80000, outputTokens: 9000 } } }));
  for (const seed of host.sessions) {
    const records = [];
    for (let n = 0; n < scenario.notes; n++) records.push({ type: 'assistant/message', seq: n + 1, data: { message: { content: [{ type: n % 2 ? 'text' : 'reasoning', text: '过程 ' + n + '：检查工作区，保留审批身份、结构化提问和实时状态。' }] } } });
    for (let n = 0; n < scenario.activities; n++) records.push({ type: 'tool/call', seq: n + 100, data: { callId: 'c' + n, name: 'read_file', arguments: JSON.stringify({ path: 'apps/desktop/src/renderer/task-views.tsx', description: '检查模块 ' + n }) } });
    host.auditEvents.set(seed.sessionId, records);
  }
  await host.start();
  try {
    f = await fixture({}, [], appDirectory); const { app, page, mainId } = f;
    await page.evaluate(() => window.glass.setSettings({ animation: 'full', sound: false, material: 'solid', theme: 'dark', pin: 'always', autoApproval: false }));
    await page.evaluate(link => window.glass.connectDSH(link), host.link());
    await expect.poll(() => host.followRequests.size).toBe(scenario.count);
    await f.menu('view-' + scenario.mode); if (scenario.steps) await page.getByRole('tab', { name: /步骤/ }).click();
    const cdp = await app.context().newCDPSession(page); await cdp.send('Performance.enable');
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await app.evaluate(({ BrowserWindow }, id) => {
      const webContents = BrowserWindow.fromId(id).webContents; const send = webContents.send.bind(webContents);
      globalThis.__ipcSample = { count: 0, snapshots: 0, deltas: 0, sendMs: 0, maxMs: 0, last: null, lastDelta: null };
      webContents.send = (channel, ...values) => {
        const isProjection = channel === 'glass:update'; const start = isProjection ? performance.now() : 0;
        const result = send(channel, ...values);
        if (isProjection) {
          const sample = globalThis.__ipcSample; const elapsed = performance.now() - start; const value = values[0];
          sample.count++; sample.sendMs += elapsed; sample.maxMs = Math.max(sample.maxMs, elapsed); sample.last = value;
          if (value.kind === 'delta') { sample.deltas++; sample.lastDelta = value; } else sample.snapshots++;
        }
        return result;
      };
    }, mainId);
    let tick = 0; let streamRevision = 1;
    host.assistant('s0', { type: 'start', attemptId: 'bench', revision: streamRevision, turn: 40, step: 120, startedAfterSeq: 2000 });
    const startUpdates = () => { timer = setInterval(() => {
      tick++; host.assistant('s0', { type: 'chunk', attemptId: 'bench', revision: ++streamRevision, index: tick - 1, chunk: { type: 'text-delta', index: 0, text: '流' } });
      host.control({ type: 'projection', sessionId: 's0', key: 'sessionStats', seq: 10000 + tick, value: { turns: 40, steps: 120 + tick } });
      if (tick % 8 === 0) host.audit('s0', { type: 'tool/call', seq: 3000 + tick, data: { callId: 'live' + tick, name: 'read_file', arguments: JSON.stringify({ path: 'src/update-' + tick + '.ts' }) } });
      if (tick % 40 === 0) host.audit('s0', { type: 'todo/write', seq: 20000 + tick, data: { todos: todos.map((todo, i) => i === 0 ? { ...todo, content: '实时任务 ' + tick } : todo) } });
    }, 16); };
    startUpdates(); await page.waitForTimeout(1400); clearInterval(timer); await page.waitForTimeout(100);
    await cdp.send('HeapProfiler.collectGarbage'); const heapBefore = await cdp.send('Runtime.getHeapUsage');
    await app.evaluate(() => { const sample = globalThis.__ipcSample; sample.count = sample.snapshots = sample.deltas = sample.sendMs = sample.maxMs = 0; });
    await page.evaluate(() => {
      window.__reviewFrames = []; let previous = performance.now(); window.__reviewRunning = true;
      const frame = time => { if (!window.__reviewRunning) return; window.__reviewFrames.push(time - previous); previous = time; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    });
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(value => [value.name, value.value]));
    const before = await metrics(); const started = performance.now(); const tickBefore = tick;
    startUpdates(); await page.waitForTimeout(duration); clearInterval(timer); await page.waitForTimeout(60);
    const elapsedMs = performance.now() - started; const after = await metrics(); const dirtyHeap = await cdp.send('Runtime.getHeapUsage');
    const renderer = await page.evaluate(() => {
      window.__reviewRunning = false; const frames = window.__reviewFrames.slice(2).sort((a, b) => a - b);
      return { nodes: document.querySelectorAll('*').length, rows: document.querySelectorAll('.process-entry').length, todos: document.querySelectorAll('.todo').length,
        hiddenOptions: document.querySelectorAll('[role=option]').length, waveChars: document.querySelectorAll('.wave-char').length,
        frameIntervals: { count: frames.length, p95: frames[Math.ceil(frames.length * .95) - 1], over25: frames.filter(value => value > 25).length } };
    });
    const ipc = await app.evaluate(() => { const sample = globalThis.__ipcSample; return { count: sample.count, snapshots: sample.snapshots, deltas: sample.deltas,
      sendMs: sample.sendMs, maxSendMs: sample.maxMs, lastBytes: Buffer.byteLength(JSON.stringify(sample.last)), lastDeltaBytes: sample.lastDelta ? Buffer.byteLength(JSON.stringify(sample.lastDelta)) : null }; });
    await cdp.send('HeapProfiler.collectGarbage'); const retainedHeap = await cdp.send('Runtime.getHeapUsage');
    const projection = await page.evaluate(() => window.glass.getState());
    assert.equal(Object.keys(projection.sessions).length, scenario.count); assert.equal(projection.sessions.s0.stats.steps, 120 + tick);
    assert.equal(projection.sessions.s0.todos.length, scenario.todos);
    if (scenario.steps) assert.equal(renderer.todos, 1000);
    const result = { label, scenario: scenario.name, rep, throttle, elapsedMs, inputTicks: tick - tickBefore, ...renderer, ipc,
      mainThreadPercent: (after.TaskDuration - before.TaskDuration) / (elapsedMs / 1000) * 100,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      heap: { before: heapBefore, dirty: dirtyHeap, retained: retainedHeap } };
    results.push(result); console.log(JSON.stringify({ scenario: result.scenario, rep, mainThreadPercent: result.mainThreadPercent, scriptMs: result.scriptMs, ipc, nodes: renderer.nodes }));
  } finally { clearInterval(timer); if (f) await f.app.close(); await host.stop(); }
}
await writeFile(resolve(output, `benchmark-${label}.json`), JSON.stringify({ baseline: '12c97e3 renderer + verified defect fixes; before renderer/IPC optimization',
  scope: 'Windows Electron production build, actual HTTP/WS + main/preload/React. CDP main-thread timing and rAF intervals are not GPU presented FPS. GC is test-only, outside measured intervals.',
  appDirectory, reps, duration, throttle, results }, null, 2));
