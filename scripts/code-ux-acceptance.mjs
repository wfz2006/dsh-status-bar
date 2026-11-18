import assert from 'node:assert/strict';
import { _electron as electron, chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { FakeHost, object } from '../tests/helpers/dsh-host.ts';
import { apply as applyPlugin } from '../packages/dsh-status-bar/lib/index.js';

const execFile = promisify(execFileCallback);
const appDir = resolve('apps/desktop');
const executablePath = createRequire(join(appDir, 'package.json'))('electron');
const output = resolve('reports/code-ux-fix-2026-11-18');
const sessions = [
  { sessionId: 'a', running: true, title: '会话甲' },
  { sessionId: 'b', running: true, title: '会话乙' },
];
const defaultPreferences = { desktopOptics: false, animation: 'off', sound: false, edgeDock: false };
const launcherPath = resolve(process.env.DSH_EXE ?? 'D:/DSH/DeepSeek Harness.exe');
const screenResults = [];
const report = { electron: null, scenarios: screenResults, outcome: 'FAIL' };
const scenario = process.argv[2] ?? 'all';
const summary = (items, details) => { screenResults.push({ items, ...details }); console.log(JSON.stringify({ items, ...details })); };

async function profile(settings = {}, includeDefaults = true) {
  const directory = await mkdtemp(join(tmpdir(), 'status-bar-code-ux-'));
  await writeFile(join(directory, 'glass-ui.json'), JSON.stringify({ version: 2, announcements: ['whale-pool-v1'],
    settings: { ...(includeDefaults ? defaultPreferences : {}), ...settings } }));
  return directory;
}
async function launch(directory) {
  const env = { ...process.env, GLASS_SMOKE: '0', GLASS_USER_DATA_DIR: directory, DSH_DESKTOP_EXECUTABLE: launcherPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args: [appDir], env });
  try {
    const page = await app.firstWindow();
    await page.locator('main').waitFor();
    report.electron = await app.evaluate(() => process.versions.electron);
    const menu = id => app.evaluate(({ Menu, BrowserWindow }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item?.enabled) throw new Error('Menu unavailable: ' + id);
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    }, id);
    const menuItem = id => app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      return { label: item?.label, enabled: item?.enabled };
    }, id);
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
    return { app, page, menu, menuItem, bounds, visible };
  } catch (error) { await app.close(); throw error; }
}
const readState = f => f.page.evaluate(() => window.glass.getState());
const readWindow = f => f.page.evaluate(() => window.glass.getWindowState());
const readSource = f => f.page.evaluate(() => window.glass.getSourceState());
const openSettings = async (f, tab) => {
  await f.menu('settings');
  await f.page.getByRole('tab', { name: tab, exact: true }).click();
};
const button = (f, name) => f.page.getByRole('button', { name, exact: true });
const answer = f => f.page.getByRole('textbox', { name: '你的回答' });
const setAddress = async (f, link) => {
  await f.page.getByLabel('官方认证地址').fill(link);
  await button(f, '连接 DSH').click();
};
const connect = async (f, host) => {
  await openSettings(f, '连接');
  await setAddress(f, host.link());
  await expect(f.page.locator('.source-notice')).toContainText('DSH 已连接');
  await button(f, '返回').click();
};
async function select(f, title) {
  await f.menu('view-expanded');
  await expect(f.page.locator('main')).toHaveAttribute('data-mode', 'expanded');
  await f.page.getByRole('button', { name: /^选择会话/ }).click();
  await f.page.getByRole('option', { name: new RegExp(title) }).click();
  await expect(f.page.locator('.task-heading h1, .request-session')).toHaveText(title);
}
const question = (host, session, eventId, callId, text, withOptions = false) => {
  const questions = [{ id: 'text', question: text }];
  if (withOptions) questions.push({ id: 'choice', question: '选择方案', multiSelect: true, options: [{ label: '方案一' }, { label: '方案二' }] });
  assert.equal(host.waterfall({ eventId, agentId: session, event: 'user-questions/request', request: { wait: { callId }, questions } }), true);
};
const settle = (host, sessionId, ...calls) => host.control({ type: 'projection', sessionId, key: 'userQuestions',
  value: { active: [], settled: calls.map(callId => ({ callId })) } });
function approval(host, session, callId, deliver = true) {
  assert.equal(host.audit(session, { type: 'tool/call', data: { callId, name: 'bash', arguments: '{"command":"echo acceptance"}' } }), true);
  if (deliver) assert.equal(host.waterfall({ eventId: callId, agentId: session, event: 'approval/request',
    request: { callId, toolName: 'bash', reason: '核对审批确认结果' } }), true);
}
const submissions = host => host.requests.filter(request => ['$events/result', 'userQuestions/answer'].includes(request.method));
const take = (f, name) => f.page.screenshot({ path: join(output, name + '.png') });

async function requestScenarios() {
  const host = new FakeHost(); host.sessions = sessions;
  await host.start();
  let f;
  try {
    f = await launch(await profile({ autoApproval: true }));
    await connect(f, host);
    await expect.poll(() => host.openStreams.includes('audit:a')).toBe(true);
    // Only intercept the final OS launch so the installed DSH user's profile stays isolated.
    await f.app.evaluate(({ shell }) => { globalThis.openedDSH = []; shell.openPath = async path => { globalThis.openedDSH.push(path); return ''; }; });
    const receipts = f.page.getByLabel('DSH 提交结果', { exact: true });
    async function verifyUnconfirmed(kind) {
      await expect(receipts.getByText('DSH 未确认', { exact: true })).toBeVisible({ timeout: 14000 });
      await expect(receipts.getByText(kind + ' · 会话甲', { exact: true })).toBeVisible();
      await expect(receipts.getByText('DSH 已确认', { exact: true })).toHaveCount(0);
      const opened = await f.app.evaluate(() => globalThis.openedDSH.length);
      await button(f, '打开 DSH 核实').click();
      await expect.poll(() => f.app.evaluate(() => globalThis.openedDSH.length)).toBe(opened + 1);
      assert.equal(await f.app.evaluate(() => globalThis.openedDSH.at(-1)), launcherPath);
    }
    host.rejectResults = true;
    approval(host, 'a', 'approval-rejected');
    await button(f, '拒绝').click();
    await verifyUnconfirmed('审批决定');
    await take(f, '01-approval-unconfirmed');
    await button(f, '关闭此提交结果').click();
    question(host, 'a', 'q-rejected', 'q-rejected', '测试拒收回答');
    await answer(f).fill('测试回答');
    await button(f, '提交回答').click();
    await verifyUnconfirmed('问题回答');
    await take(f, '01-answer-unconfirmed');
    await button(f, '关闭此提交结果').click();
    host.rejectResults = false; host.suppressDecision = true;
    question(host, 'a', 'q-timeout', 'q-timeout', '等待正式回执');
    await answer(f).fill('等待回执的回答');
    await button(f, '提交回答').click();
    await expect(receipts.getByText('正在等待 DSH 确认', { exact: true })).toBeVisible();
    settle(host, 'a', 'unrelated-call');
    await verifyUnconfirmed('问题回答');
    assert.equal(submissions(host).length, 3);
    await button(f, '关闭此提交结果').click();
    host.suppressDecision = false;
    question(host, 'a', 'q-success', 'q-success', '匹配回执');
    await answer(f).fill('确认收到的回答');
    await button(f, '提交回答').click();
    await expect(receipts.getByText('DSH 已确认', { exact: true })).toBeVisible();
    await button(f, '关闭此提交结果').click();
    summary('1', { rejectApproval: true, rejectAnswer: true, timedOutWrongReceipt: true, matchingReceipt: true, submissions: submissions(host).length,
      verificationAction: 'DSH executable reached shell.openPath, intercepted at OS launch' });

    question(host, 'a', 'qa-shared', 'shared', '甲的同 ID 问题', true);
    question(host, 'b', 'qb-shared', 'shared', '乙的同 ID 问题', true);
    await answer(f).fill('甲的未提交草稿');
    await f.page.getByRole('checkbox', { name: '方案二' }).check();
    await button(f, '收起窗口').click();
    await button(f, '展开待处理请求').click();
    await expect(answer(f)).toHaveValue('甲的未提交草稿');
    await expect(f.page.getByRole('checkbox', { name: '方案二' })).toBeChecked();
    await openSettings(f, '窗口');
    await button(f, '返回').click();
    await expect(answer(f)).toHaveValue('甲的未提交草稿');
    await select(f, '会话乙');
    await f.menu('view-approval');
    await expect(answer(f)).toHaveValue('');
    await expect(f.page.getByRole('checkbox', { name: '方案二' })).not.toBeChecked();
    await answer(f).fill('乙的草稿');
    await f.page.getByRole('checkbox', { name: '方案一' }).check();
    await select(f, '会话甲');
    await f.menu('view-approval');
    await expect(answer(f)).toHaveValue('甲的未提交草稿');
    await expect(f.page.getByRole('checkbox', { name: '方案二' })).toBeChecked();
    await take(f, '02-draft-restored');
    assert.equal(submissions(host).length, 4);
    summary('2', { collapsed: true, settingsBack: true, switchedSession: true, duplicateIdsIsolated: true, unsent: true });
    settle(host, 'a', 'shared');
    await expect.poll(async () => (await readState(f)).questions.find(q => q.sessionId === 'a' && q.requestId === 'question:shared')?.status).toBe('answered');

    await select(f, '会话乙');
    const before = await readState(f);
    const auth = host.authAttempts;
    await openSettings(f, '连接');
    await setAddress(f, host.origin + '/');
    await expect(f.page.getByRole('alert')).toContainText('带 token');
    await expect(f.page.locator('.source-notice')).toContainText('DSH 已连接');
    const after = await readState(f);
    assert.equal(after.epoch, before.epoch);
    assert.equal(after.selectedSession, 'b');
    assert.equal(host.authAttempts, auth);
    await f.menu('view-approval');
    await expect(answer(f)).toHaveValue('乙的草稿');
    await expect(f.page.getByRole('checkbox', { name: '方案一' })).toBeChecked();
    summary('5', { authAttempts: auth, retainedSelection: after.selectedSession, originalPendingDraft: true });
    settle(host, 'b', 'shared');
    await expect.poll(async () => (await readState(f)).questions.find(q => q.sessionId === 'b' && q.requestId === 'question:shared')?.status).toBe('answered');
    await f.menu('view-expanded');
    await f.menu('reload');
    await expect(f.page.locator('.task-heading h1')).toHaveText('会话乙');
    question(host, 'b', 'qb-after-reload', 'after-reload', '重载后给乙的问题');
    await expect(f.page.locator('.request-session')).toHaveText('会话乙');
    await expect(f.page.getByText('重载后给乙的问题', { exact: true })).toBeVisible();
    assert.equal((await readState(f)).selectedSession, 'b');
    settle(host, 'b', 'after-reload');
    host.gateway({ type: 'emit', event: 'api-session/removed', args: ['b'] });
    await f.menu('view-expanded');
    await expect(f.page.locator('.task-heading h1')).toHaveText('会话甲');
    assert.equal((await readState(f)).selectedSession, 'a');
    await f.menu('reload');
    await expect(f.page.locator('.task-heading h1')).toHaveText('会话甲');
    summary('6', { retainedAfterReload: '会话乙', requestAfterReload: '重载后给乙的问题', removedFallback: '会话甲' });

    approval(host, 'a', 'audit-only', false);
    host.audit('a', { type: 'approval/asked', data: { id: 'audit-observed', toolName: 'bash', callId: 'audit-only', reason: '仅审计审批' } });
    await expect(f.page.getByText('只读预览', { exact: true })).toBeVisible();
    await expect(button(f, '拒绝')).toBeDisabled();
    const auditCard = await f.page.locator('.approval-footer').getAttribute('data-request-id');
    host.waterfall({ eventId: 'actual-live', agentId: 'a', event: 'approval/request', request: { toolName: 'bash', callId: 'audit-only' } });
    await expect(button(f, '拒绝')).toBeEnabled();
    await expect(f.page.locator('.approval-footer')).toHaveAttribute('data-request-id', auditCard);
    assert.equal((await readState(f)).approvals.filter(a => a.status === 'pending').length, 1);
    summary('7', { auditReadOnly: true, mergedSameCard: true });

    host.gateway({ type: 'emit', event: 'api-session/error', args: ['a'] });
    await f.menu('view-expanded');
    await expect(f.page.locator('.task-meta')).toContainText('任务出错');
    await expect(button(f, '打开 DSH')).toBeVisible();
    await expect(button(f, '重新连接')).toHaveCount(0);
    assert.equal((await readSource(f)).connection, 'connected');
    await button(f, '打开 DSH').click();
    host.end('gateway');
    await expect(button(f, '重新连接')).toBeVisible();
    await button(f, '重新连接').click();
    await expect(f.page.getByRole('tab', { name: '连接', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.getByLabel('官方认证地址')).toBeFocused();
    summary('UX1', { connectedErrorAction: '打开 DSH', disconnectedAction: '连接标签和认证地址焦点' });
  } finally { await f?.app.close(); await host.stop(); }
}

async function inventoryScenarios() {
  const host = new FakeHost();
  const history = Array.from({ length: 100 }, (_, index) => ({ sessionId: 'history-' + index, title: '旧会话 ' + index }));
  host.sessions = history;
  await host.start();
  let f;
  try {
    f = await launch(await profile({ autoApproval: true }));
    await connect(f, host);
    assert.equal(Object.keys((await readState(f)).sessions).length, 100);
    const newest = { sessionId: 'new', running: true, agentAvailable: true, projections: { values: { title: '第 101 个新任务' } }, title: '第 101 个新任务' };
    host.sessions = [newest, ...history];
    host.gateway({ type: 'emit', event: 'api-session/added', args: [newest] });
    question(host, 'new', 'n1', 'n1', '新任务的提问');
    const one = button(f, '其他会话有 1 项待处理');
    await expect(one).toBeVisible();
    assert.equal((await readState(f)).selectedSession, 'history-0');
    await expect.poll(() => host.requests.filter(r => r.method === 'session/list').length, { timeout: 14000 }).toBeGreaterThanOrEqual(2);
    await expect(one).toBeVisible().catch(async error => {
      const state = await readState(f);
      report.inventoryAtFailure = {
        selectedSession: state.selectedSession, connection: state.connection, newSession: state.sessions.new,
        questions: state.questions.map(({ sessionId, status }) => ({ sessionId, status })),
        mode: (await readWindow(f)).viewMode, panel: (await readWindow(f)).panel,
        notices: await f.page.locator('.window-notices button').allTextContents(),
      };
      throw error;
    });
    await take(f, '04-cross-session-notice');
    await f.menu('view-expanded');
    await f.page.getByRole('button', { name: /^选择会话/ }).click();
    await expect(f.page.getByRole('option', { name: /第 101 个新任务/ })).toBeVisible();
    await f.page.keyboard.press('Escape');
    await button(f, '加载较早会话').click();
    await expect(button(f, '返回最近会话')).toBeVisible();
    assert.ok((await readState(f)).sessions['history-99']);
    await button(f, '返回最近会话').click();
    await expect(button(f, '加载较早会话')).toBeVisible();
    await f.menu('view-capsule');
    await one.click();
    await expect(f.page.getByText('新任务的提问', { exact: true })).toBeVisible();
    await expect(f.page.locator('.request-session')).toHaveText(newest.title);
    assert.equal(Object.keys((await readState(f)).sessions).length, 100);
    summary('4', { initialSessions: 100, currentSessions: 100, newSession: newest.title, listRefreshes: host.requests.filter(r => r.method === 'session/list').length, olderHistoryLoaded: true });

    await select(f, '旧会话 0');
    question(host, 'history-1', 'm1', 'm1', '另一个会话的问题');
    question(host, 'history-1', 'm2', 'm2', '同会话的第二个问题');
    await f.menu('view-capsule');
    await button(f, '其他会话有 3 项待处理').click();
    await f.page.getByRole('button', { name: /旧会话 1.*同会话的第二个问题/ }).click();
    await expect(f.page.locator('.request-session')).toHaveText('旧会话 1');
    await expect(f.page.getByText('同会话的第二个问题', { exact: true })).toBeVisible();
    settle(host, 'new', 'n1');
    await button(f, '收起窗口').click();
    await expect(f.page.getByRole('button', { name: /其他会话有/ })).toHaveCount(0);
    await select(f, '旧会话 0');
    await f.menu('view-capsule');
    await expect(button(f, '其他会话有 2 项待处理')).toBeVisible();
    settle(host, 'history-1', 'm1', 'm2');
    await expect(f.page.getByRole('button', { name: /其他会话有/ })).toHaveCount(0);
    summary('UX3', { singleDirect: true, multipleChooseExactRequest: true, counts: [1, 3, 2, 0] });
  } finally { await f?.app.close(); await host.stop(); }
}

async function connectionScenarios() {
  const host = new FakeHost(); await host.start();
  let f;
  let releaseHistory;
  const historyGate = new Promise(resolve => { releaseHistory = resolve; });
  let releaseList;
  const listGate = new Promise(resolve => { releaseList = resolve; });
  let pending = 0, peak = 0, finished = 0;
  const rows = [{ sessionId: 'live', running: true, agentAvailable: true, projections: { values: { title: '实时任务' } } },
    ...Array.from({ length: 6 }, (_, i) => ({ sessionId: 'cold-' + i, projections: { kind: 'cached', asOfSeq: 14, values: { title: '冷历史 ' + i } } }))];
  let blockList = false;
  host.rpc = async (method, args) => {
    if (method === 'session/list') { if (blockList) await listGate; return { items: rows }; }
    if (method === 'session/page') {
      assert.match(String(object(object(args.request).address).sessionId), /^cold-/);
      pending++; peak = Math.max(peak, pending);
      await historyGate; await delay(180);
      pending--; finished++;
      return { records: [{ type: 'event', event: { type: 'turn/end', seq: 14, data: { reason: { kind: 'completed' } } } }] };
    }
    return undefined;
  };
  try {
    f = await launch(await profile());
    await connect(f, host);
    await expect.poll(() => pending).toBe(3);
    await f.menu('view-expanded');
    await f.page.getByRole('tab', { name: /^步骤/ }).click();
    assert.equal(host.audit('live', { type: 'todo/write', seq: 20, data: { todos: [{ content: '历史未结束时出现的实时步骤', status: 'in_progress' }] } }), true);
    await expect(f.page.getByText('历史未结束时出现的实时步骤', { exact: true })).toBeVisible();
    assert.equal(finished, 0);
    releaseHistory();
    await expect.poll(() => finished).toBe(6);
    await expect.poll(async () => (await readState(f)).sessions['cold-5']?.phase).toBe('finished');
    assert.ok(peak > 1 && peak <= 3);
    await openSettings(f, '连接');
    await button(f, '断开连接').click();
    blockList = true;
    await setAddress(f, host.link());
    await expect.poll(() => host.requests.filter(request => request.method === 'session/list').length).toBe(2);
    await button(f, '取消连接').click();
    await expect(f.page.locator('.source-notice')).toContainText('DSH 未连接');
    releaseList();
    await button(f, '切换到 Mock 演示').click();
    await expect(f.page.locator('.source-notice')).toContainText('Mock 演示');
    const state = await readState(f);
    assert.equal(state.source, 'mock');
    assert.equal(state.sessions.live, undefined);
    summary('10', { delayedReads: finished, peakConcurrentReads: peak, realtimeEventBeforeHistory: true, cancelledListThenSwitchedSource: true });
  } finally { releaseList(); releaseHistory(); await f?.app.close(); await host.stop(); }
}

async function shortcut(key) {
  // OS keystrokes are required for WM_HOTKEY. Playwright's page.keyboard
  // delivers only renderer events and would not exercise a global shortcut.
  const code = key === 'G' ? 71 : 123;
  await execFile('powershell.exe', ['-NoProfile', '-Command',
    `Add-Type 'using System.Runtime.InteropServices; public static class GlassHotkey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, System.UIntPtr extra); }'
     foreach ($keyCode in @(17,16,${code})) { [GlassHotkey]::keybd_event($keyCode,0,0,[UIntPtr]::Zero) }
     foreach ($keyCode in @(${code},16,17)) { [GlassHotkey]::keybd_event($keyCode,0,2,[UIntPtr]::Zero) }`], { windowsHide: true });
}
async function workerCount(f) {
  const pid = await f.app.evaluate(() => process.pid);
  assert.ok(Number.isInteger(pid) && pid > 0);
  const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-Command',
    `@(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid} AND Name = 'RegionCapture.exe'").Count`], { windowsHide: true });
  return Number(stdout.trim());
}
async function opticsAndPositionScenarios() {
  // This is a pre-upgrade profile, with no desktopOptics field.
  const directory = await profile({ material: 'frosted', animation: 'off', edgeDock: false }, false);
  let f;
  try {
    f = await launch(directory);
    const optics = () => f.page.evaluate(() => window.glass.getOpticsState());
    const toggle = () => f.page.getByRole('checkbox', { name: '真实折射与色散' });
    await expect.poll(optics, { timeout: 10000 }).toMatchObject({ enabled: true, running: true, error: null });
    await openSettings(f, '外观');
    await expect(toggle()).toBeChecked();
    await expect.poll(async () => (await optics()).running, { timeout: 10000 }).toBe(true);
    await expect.poll(() => workerCount(f)).toBe(1);
    await toggle().uncheck();
    await expect.poll(() => workerCount(f)).toBe(0);
    await f.page.getByRole('tab', { name: '窗口', exact: true }).click();
    const sound = f.page.getByLabel('提示音风格');
    await sound.selectOption({ index: 1 });
    await expect.poll(() => readWindow(f).then(w => w.settings.soundPreset)).toBe(await sound.inputValue());
    assert.equal((await optics()).enabled, false);
    assert.equal(await workerCount(f), 0);
    const hide = await f.menuItem('hide');
    assert.ok(hide.enabled);
    await f.menu('hide');
    await expect.poll(f.visible).toBe(false);
    await shortcut(hide.label.includes('Ctrl+Shift+G') ? 'G' : 'F12');
    await expect.poll(f.visible).toBe(true);
    await f.page.getByRole('tab', { name: '外观', exact: true }).click();
    await expect(toggle()).not.toBeChecked();
    assert.deepEqual(await optics(), { enabled: false, running: false, error: null });
    assert.equal(await workerCount(f), 0);
    await f.app.close(); f = undefined;
    const saved = JSON.parse(await readFile(join(directory, 'glass-ui.json'), 'utf8'));
    assert.equal(saved.settings.desktopOptics, false);
    f = await launch(directory);
    await openSettings(f, '外观');
    await expect(toggle()).not.toBeChecked();
    assert.deepEqual(await optics(), { enabled: false, running: false, error: null });
    assert.equal(await workerCount(f), 0);
    await take(f, '03-optics-after-restart');
    summary('3', { material: 'frosted', legacyWorkerStarted: true, nativeWorkersAfterSoundChange: 0, nativeWorkersAfterOffAndShow: 0, nativeWorkersAfterRestart: 0, persistedOptics: saved.settings.desktopOptics });

    const restored = [];
    for (const [mode, size] of [['capsule', [288, 44]], ['peek', [340, 190]]]) {
      await openSettings(f, '窗口');
      await f.page.getByLabel('默认形态').selectOption(mode);
      await button(f, '返回').click();
      await f.menu('view-' + mode);
      await expect(f.page.locator('main')).toHaveAttribute('data-mode', mode);
      const surface = f.page.locator(mode === 'capsule' ? '.task-capsule' : '.peek-main');
      const box = await surface.boundingBox();
      assert.ok(box);
      const start = await f.bounds();
      const x = box.x + box.width * (start.x > 260 ? 0.55 : 0.3);
      const y = box.y + box.height / 2;
      const offset = start.x > 260 ? -100 : 100;
      await f.page.mouse.move(x, y);
      await f.page.mouse.down();
      for (const progress of [0.16, 0.39, 0.57, 0.81, 1]) {
        const current = await f.bounds();
        await f.page.mouse.move(x + offset * progress - (current.x - start.x), y - (current.y - start.y));
        await expect.poll(() => f.bounds().then(bounds => Math.abs(bounds.x - (start.x + offset * progress)))).toBeLessThanOrEqual(2);
      }
      const atDrop = await f.bounds();
      await f.page.mouse.move(x + offset - (atDrop.x - start.x), y - (atDrop.y - start.y));
      await f.page.mouse.up();
      await expect.poll(() => f.bounds().then(bounds => bounds.x)).not.toBe(start.x);
      const moved = await f.bounds();
      await f.app.close(); f = undefined;
      f = await launch(directory);
      const after = await f.bounds();
      // At 150% the origin and opposite edge each round to native pixels.
      for (const [key, target] of Object.entries({ x: moved.x, y: moved.y, width: size[0], height: size[1] })) {
        const tolerance = key === 'x' || key === 'y' ? 1 : 2;
        assert.ok(Math.abs(after[key] - target) <= tolerance, `${mode} ${key}: ${after[key]} vs ${target}`);
      }
      await expect(f.page.locator('main')).toHaveAttribute('data-mode', mode);
      restored.push({ mode, x: after.x, y: after.y, width: after.width, height: after.height });
    }
    await f.app.close(); f = undefined;
    const preferencePath = join(directory, 'glass-ui.json');
    const offscreen = JSON.parse(await readFile(preferencePath, 'utf8'));
    await writeFile(preferencePath, JSON.stringify({ ...offscreen, bounds: { ...offscreen.bounds, x: 30000, y: -30000 } }));
    f = await launch(directory);
    const withinWorkArea = () => f.app.evaluate(({ BrowserWindow, screen }) => {
      const b = BrowserWindow.getAllWindows()[0].getBounds();
      const area = screen.getDisplayMatching(b).workArea;
      return b.x >= area.x - 1 && b.y >= area.y - 1 && b.x + b.width <= area.x + area.width + 2 && b.y + b.height <= area.y + area.height + 2;
    });
    assert.equal(await withinWorkArea(), true);
    await f.app.evaluate(({ BrowserWindow, screen }) => {
      BrowserWindow.getAllWindows()[0].setPosition(30000, -30000);
      screen.emit('display-removed');
    });
    assert.equal(await withinWorkArea(), true);
    summary('11', { movedAndRestored: restored, offscreenSavedBoundsClamped: true, simulatedDisplayRemovalClamped: true });

    await f.menu('view-whale-pool');
    await f.page.getByRole('button', { name: /点击展开水池/ }).click();
    await f.page.getByRole('button', { name: /^任务详情/ }).click();
    await expect(f.page.locator('main')).toHaveAttribute('data-mode', 'expanded');
    await button(f, '收起窗口').click();
    await expect(f.page.locator('main')).toHaveAttribute('data-appearance', 'whale-pool');
    await f.menu('view-expanded');
    await expect(f.page.locator('main')).toHaveAttribute('data-mode', 'expanded');
    await button(f, '收起窗口').click();
    await expect(f.page.locator('main')).toHaveAttribute('data-appearance', 'whale-pool');
    assert.equal((await readWindow(f)).settings.appearance, 'whale-pool');
    summary('UX2', { poolButtonAndWindowMenu: true, appearanceAfterBoth: 'whale-pool' });
  } finally { await f?.app.close(); }
}

async function pluginCompanion(host, autoLaunch) {
  const directory = await profile();
  const entry = join(directory, 'app', 'out', 'main');
  await mkdir(entry, { recursive: true });
  const pidFile = join(directory, 'primary.pid');
  await writeFile(join(directory, 'app', 'package.json'), JSON.stringify({ type: 'module', main: 'out/main/index.js' }));
  await writeFile(join(entry, 'index.js'),
    `import { app } from 'electron';
     import { writeFileSync } from 'node:fs';
     try { writeFileSync(${JSON.stringify(pidFile)}, String(process.pid), { flag: 'wx' }); } catch {}
     app.commandLine.appendSwitch('remote-debugging-port', '0');
     app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
     await import(${JSON.stringify(pathToFileURL(join(appDir, 'out', 'main', 'index.js')).href)});`);
  const overrides = { GLASS_USER_DATA_DIR: directory, GLASS_SMOKE: '0' };
  const oldEnv = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const cleanup = [];
  let command;
  let browser;
  let ownedPid;
  let current = host;
  const effect = fn => { const dispose = fn(); if (dispose) cleanup.push(dispose); };
  const ctx = { connection: { authenticatedUrl: () => current.issueLink() }, webServer: { getOrigin: () => current.origin }, effect,
    inject: (services, inject) => {
      assert.deepEqual(services, ['commands']);
      inject({ commands: { register: definition => { command = definition; return () => { command = undefined; }; } }, effect });
    } };
  async function end() {
    for (const dispose of cleanup.splice(0).reverse()) dispose();
    if (ownedPid) await expect.poll(() => processExists(ownedPid)).toBe(false);
    await browser?.close();
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  try {
    applyPlugin(ctx, { autoLaunch, autoReload: false, appDir: join(directory, 'app'), electronBinary: executablePath, runtimeDir: join(directory, 'runtime') });
    assert.equal(command?.name, 'status-bar');
    if (!autoLaunch) { await delay(350); assert.equal(host.authAttempts, 0); assert.equal((await command.handler({})).kind, 'success'); }
    let port;
    await expect.poll(async () => {
      port = await readFile(join(directory, 'DevToolsActivePort'), 'utf8').then(text => Number(text.split(/\r?\n/)[0]), () => 0);
      return port;
    }, { timeout: 12000 }).toBeGreaterThan(0);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent('page');
    await page.locator('main').waitFor();
    await expect.poll(async () => (await readSource({ page })).connection).toBe('connected');
    ownedPid = Number(await readFile(pidFile, 'utf8'));
    assert.ok(ownedPid > 0 && processExists(ownedPid));
    return { page, pid: ownedPid, wake: async () => assert.equal((await command.handler({})).kind, 'success'),
      switchHost: host => { current = host; }, dispose: end, commandRegistered: () => Boolean(command) };
  } catch (error) { await end(); throw error; }
}
function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function recoveryAndPluginScenarios() {
  const host = new FakeHost(); host.sessions = sessions; await host.start();
  const switched = new FakeHost(); switched.sessions = [{ sessionId: 'other-host', title: '切换后的宿主' }]; await switched.start();
  let first, fallback, blocked, plugin, automatic;
  try {
    first = await launch(await profile());
    fallback = await launch(await profile());
    const primaryMenu = await first.menuItem('hide');
    const fallbackMenu = await fallback.menuItem('hide');
    assert.match(primaryMenu.label, /Ctrl\+Shift\+G/);
    assert.match(fallbackMenu.label, /Ctrl\+Shift\+F12/);
    await openSettings(fallback, '窗口');
    await expect(fallback.page.locator('.settings-shortcut-note')).toContainText('Ctrl+Shift+F12');
    await fallback.menu('hide');
    await expect.poll(fallback.visible).toBe(false);
    await shortcut('F12');
    await expect.poll(fallback.visible).toBe(true);
    blocked = await launch(await profile());
    assert.equal((await blocked.menuItem('hide')).enabled, false);
    await blocked.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect(blocked.page.getByRole('alert')).toContainText('没有可用的恢复入口');
    assert.equal(await blocked.visible(), true);
    await blocked.app.close(); blocked = undefined;

    plugin = await pluginCompanion(host, false);
    const recovery = (await readWindow(plugin)).recoveryHint;
    assert.match(recovery, /\/status-bar/);
    assert.doesNotMatch(recovery, /Ctrl\+Shift/);
    question(host, 'a', 'held', 'held', '唤回后仍是这条问题');
    await plugin.page.getByRole('button', { name: '展开待处理请求' }).click();
    await answer(plugin).fill('隐藏前的草稿');
    const before = await readState(plugin);
    await plugin.page.evaluate(() => window.glass.windowAction('hide'));
    await expect.poll(async () => (await readWindow(plugin)).visible).toBe(false);
    const authBefore = host.authAttempts;
    await plugin.wake();
    await expect.poll(async () => (await readWindow(plugin)).visible).toBe(true);
    await expect(answer(plugin)).toHaveValue('隐藏前的草稿');
    assert.equal(host.authAttempts, authBefore);
    assert.equal((await readState(plugin)).epoch, before.epoch);
    summary('8', { standaloneFallback: 'Ctrl+Shift+F12', blockedWhenBothUnavailable: true, pluginRecovery: '/status-bar' });

    host.end('gateway');
    await expect.poll(async () => (await readSource(plugin)).connection).toBe('disconnected');
    host.sessions = sessions.map(row => row.sessionId === 'a' ? { ...row, stats: { ...row.stats, userQuestions: {
      active: [{ callId: 'held', questions: [{id:'text', question:'唤回后仍是这条问题'}] }], settled: [] } } } : row);
    await plugin.wake();
    await expect.poll(() => host.authAttempts).toBe(authBefore + 1);
    await expect.poll(async () => (await readSource(plugin)).connection).toBe('connected');
    assert.notEqual((await readState(plugin)).epoch, before.epoch);
    assert.equal((await readState(plugin)).draftScope, before.draftScope);
    await plugin.page.evaluate(() => window.glass.windowAction('approval',true));
    await expect(answer(plugin)).toHaveValue('隐藏前的草稿');
    plugin.switchHost(switched);
    await plugin.wake();
    await expect.poll(async () => (await readState(plugin)).sessions['other-host']?.title).toBe('切换后的宿主');
    assert.equal(switched.authAttempts, 1);
    assert.notEqual((await readState(plugin)).draftScope, before.draftScope);
    summary('9', { sameHostAuthBefore: authBefore, sameHostAuthAfter: authBefore, afterDisconnect: host.authAttempts, afterSwitch: switched.authAttempts, freshOneUseLinks: true, draftRestored: true });
    const manualPid = plugin.pid;
    await plugin.dispose();
    assert.equal(plugin.commandRegistered(), false);
    await expect.poll(() => processExists(manualPid)).toBe(false);
    assert.equal(await first.visible(), true);
    assert.equal(await fallback.visible(), true);

    automatic = await pluginCompanion(switched, true);
    const automaticPid = automatic.pid;
    await automatic.dispose();
    await expect.poll(() => processExists(automaticPid)).toBe(false);
    assert.equal(automatic.commandRegistered(), false);
    summary('12', { manualAndAutomaticProcessesExited: true, commandUnregistered: true, unrelatedWindowsAlive: true, harnessHostStillRunning: true });
  } finally {
    await automatic?.dispose(); await plugin?.dispose();
    await blocked?.app.close(); await fallback?.app.close(); await first?.app.close();
    await switched.stop(); await host.stop();
  }
}

async function main() {
  if (scenario === 'all' || scenario === 'requests') await requestScenarios();
  if (scenario === 'all' || scenario === 'inventory') await inventoryScenarios();
  if (scenario === 'all' || scenario === 'connection') await connectionScenarios();
  if (scenario === 'all' || scenario === 'placement') await opticsAndPositionScenarios();
  if (scenario === 'all' || scenario === 'recovery') await recoveryAndPluginScenarios();
  assert.ok(screenResults.length, 'unknown acceptance scenario');
}

await mkdir(output, { recursive: true });
try { await main(); report.outcome = 'PASS'; }
catch (error) {
  report.error = String(error.stack ?? error).replace(/token=[^\s&]+/g, 'token=<redacted>');
  console.error(report.error); process.exitCode = 1;
} finally {
  await writeFile(join(output, 'electron-' + scenario + '.json'), JSON.stringify(report, null, 2));
}
