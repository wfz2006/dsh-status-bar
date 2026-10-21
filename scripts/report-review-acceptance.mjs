import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';
import { FakeHost } from '../tests/helpers/dsh-host.ts';

const output = resolve('reports/report-remediation'); await mkdir(output, { recursive: true });
const report = { result: 'FAIL', checks: [], scope: 'isolated Windows Electron + real IPC + FakeHost; no user Profile or real DSH decisions' };
const host = new FakeHost(); host.sessions = [{ sessionId: 's1', title: '并发请求回归', running: true }, { sessionId: 's2', title: '第二会话', running: true }];
await host.start(); let f;
try {
  f = await fixture(); const { app, page, mainId, menu } = f; const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => window.glass.setSettings({ autoApproval: false, animation: 'off', sound: false, material: 'solid', pin: 'on-notification' }));
  await page.evaluate(link => window.glass.connectDSH(link), host.link()); await menu('view-capsule');
  host.audit('s1', { type: 'tool/call', seq: 1, data: { callId: 'c1', name: 'bash', arguments: '{"command":"echo fixture-one"}' } });
  host.waterfall({ eventId: 'a1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
  await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).approvals.length).toBe(1);
  assert.equal((await page.evaluate(() => window.glass.getWindowState())).viewMode, 'capsule');
  assert.equal((await page.evaluate(() => window.glass.getWindowState())).pinned, true);
  report.checks.push('autoApproval=false preserves capsule; notification pin applies');
  await page.evaluate(() => window.glass.setSettings({ autoApproval: true }));
  const custom = { x: 200, y: 150, width: 425, height: 385 };
  await page.evaluate(bounds => window.glass.resizeWindow(bounds), custom);
  // Windows rounds odd DIP sizes at fractional display scale. Compare the
  // accepted native bounds before/after the request, not the unrounded input.
  const acceptedBounds = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), mainId);
  host.waterfall({ eventId: 'q1', agentId: 's1', event: 'user-questions/request', request: { wait: { callId: 'question-call' }, questions: [{ id: 'choice', question: '选择一个方案', options: [{ label: 'A' }, { label: 'B' }] }] } });
  await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).questions.length).toBe(1);
  assert.equal((await page.evaluate(() => window.glass.getWindowState())).manualSize, true);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), mainId), acceptedBounds);
  report.checks.push('new question preserves manual window geometry');
  await menu('view-approval');
  await expect(page.getByRole('button', { name: '确认 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回答 1', exact: true }).click();
  await expect(page.getByText('选择一个方案', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认 1', exact: true }).click();
  await expect(page.getByRole('button', { name: '允许一次', exact: true })).toBeEnabled();
  host.audit('s1', { type: 'tool/call', seq: 2, data: { callId: 'c2', name: 'bash', arguments: '{"command":"echo fixture-two"}' } });
  host.waterfall({ eventId: 'a2', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c2' } });
  await expect(page.getByRole('button', { name: '确认 2', exact: true })).toBeVisible();
  await expect(page.locator('.approval-header .step-count')).toHaveText('2 项');
  report.checks.push('1 approval + 1 question and 2 approvals + 1 question keep both queues reachable with exact counts');
  host.audit('s1', { type: 'turn/end', seq: 3, data: { reason: { kind: 'completed' } } });
  await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).approvals.every(a => a.status === 'unavailable')).toBe(true);
  host.audit('s1', { type: 'turn/start', seq: 4, data: {} });
  await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).sessions.s1.phase).toBe('working');
  assert.equal(host.requests.filter(request => request.method === '$events/result').length, 0);
  report.checks.push('turn boundary retires all pending requests without making any Host decision');

  await menu('view-expanded');
  await expect(page.locator('[role=option]')).toHaveCount(0);
  const picker = page.getByRole('button', { name: /选择会话/ });
  await picker.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('[role=option]')).toHaveCount(2);
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '第二会话', exact: true })).toBeVisible();
  await expect(page.locator('[role=option]')).toHaveCount(0);
  await picker.click(); await page.getByRole('option', { name: /并发请求回归/ }).click();
  await expect(page.getByRole('heading', { name: '并发请求回归', exact: true })).toBeVisible();
  report.checks.push('lazy picker retains keyboard End/Enter and pointer selection, then releases hidden options');

  await app.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.fromId(id); const original = win.webContents.send.bind(win.webContents);
    globalThis.__reviewIPC = { updates: 0, dropNext: false, dropped: 0 };
    win.webContents.send = (channel, ...args) => {
      if (channel === 'glass:update') {
        const message = args[0];
        if (globalThis.__reviewIPC.dropNext && message.kind === 'delta') { globalThis.__reviewIPC.dropNext = false; globalThis.__reviewIPC.dropped++; return; }
        globalThis.__reviewIPC.updates++;
      }
      return original(channel, ...args);
    };
  }, mainId);
  await page.evaluate(() => window.glass.windowAction('hide'));
  const beforeHidden = await app.evaluate(() => globalThis.__reviewIPC.updates);
  host.audit('s1', { type: 'todo/write', seq: 5, data: { todos: [{ content: 'hidden latest', status: 'in_progress' }] } });
  await page.waitForTimeout(100);
  assert.equal(await app.evaluate(() => globalThis.__reviewIPC.updates), beforeHidden);
  await menu('show'); await page.getByRole('tab', { name: /步骤/ }).click();
  await expect(page.locator('.todo-text')).toHaveText('hidden latest');
  report.checks.push('hidden window sends zero unsolicited projection IPC; showing restores the newest complete state');

  await app.evaluate(() => { globalThis.__reviewIPC.dropNext = true; });
  host.audit('s1', { type: 'todo/write', seq: 6, data: { todos: [{ content: 'intentionally dropped', status: 'pending' }] } });
  await expect.poll(() => app.evaluate(() => globalThis.__reviewIPC.dropped)).toBe(1);
  host.audit('s1', { type: 'todo/write', seq: 7, data: { todos: [{ content: 'recovered after gap', status: 'completed' }] } });
  await expect(page.locator('.todo-text')).toHaveText('recovered after gap');
  report.checks.push('an intentionally dropped real delta triggers a full resync and recovers without reauthentication');
  const auth = host.authAttempts; const loaded = page.waitForEvent('load');
  await app.evaluate(({ Menu, BrowserWindow }, id) => { const item = Menu.getApplicationMenu().getMenuItemById('reload'); item.click(item, BrowserWindow.fromId(id), {}); }, mainId);
  await loaded; await expect(page.locator('main')).toBeVisible();
  assert.equal((await page.evaluate(() => window.glass.getState())).sessions.s1.todos[0].content, 'recovered after gap');
  assert.equal((await page.evaluate(() => window.glass.getSourceState())).connection, 'connected');
  assert.equal(host.authAttempts, auth);
  report.checks.push('renderer reload retains the authenticated source and latest state; launch token is not replayed');
  assert.deepEqual(errors, []); report.result = 'PASS';
} catch (error) { report.error = String(error); throw error; }
finally { if (f) await f.app.close(); await host.stop(); await writeFile(resolve(output, 'electron-acceptance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
