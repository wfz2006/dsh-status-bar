import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const requireDesktop = createRequire(resolve('apps/desktop/package.json'));
const executablePath = requireDesktop('electron');
const output = resolve('docs/evidence');
await mkdir(output, { recursive: true });
const env = { ...process.env, GLASS_SMOKE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [resolve('apps/desktop')], env });
const results = [];
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.getByRole('button', { name: '展开工作台', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/capsule.png` });
  await page.getByRole('button', { name: '展开工作台', exact: true }).click();
  await page.locator('[data-density=workspace]').waitFor();
  await page.getByText('Mock 已连接', { exact: true }).waitFor();
  await page.getByRole('region', { name: '模拟审批' }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator('.todo').count(), 2);
  await page.getByRole('button', { name: '允许一次', exact: true }).isDisabled().then(v => assert.ok(v));
  await page.screenshot({ path: `${output}/workspace.png` });
  results.push('Actual Electron startup, 3→2 Todo replacement, read-only approval: PASS');
  const security = await page.evaluate(() => ({ node: typeof window.require, token: Object.keys(window.glass) }));
  assert.equal(security.node, 'undefined');
  assert.deepEqual(security.token.sort(), ['getState', 'mockAction', 'subscribe', 'windowAction', 'getWindowState', 'subscribeWindow'].sort());
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation };
  });
  assert.deepEqual(preferences, { sandbox: true, nodeIntegration: false, contextIsolation: true });
  results.push('Sandbox/context isolation/no renderer Node or token: PASS');
  await page.getByLabel('选择会话').selectOption('demo-other');
  assert.equal(await page.locator('.todo').count(), 1);
  assert.equal(await page.locator('.approval').count(), 0);
  await page.getByLabel('选择会话').selectOption('demo-main');
  await page.locator('summary').click();
  await page.getByRole('button', { name: '模拟断线', exact: true }).click();
  await page.getByText('Mock 连接已断开', { exact: true }).first().waitFor();
  assert.ok(await page.getByRole('button', { name: '允许一次', exact: true }).isDisabled());
  await page.screenshot({ path: `${output}/disconnected.png` });
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await page.getByText('Mock 已连接', { exact: true }).waitFor();
  assert.equal(await page.locator('.todo').count(), 2);
  results.push('Session switching, disconnect fail-closed, reconnect latest snapshot: PASS');
  await page.getByLabel('外观主题').selectOption('light');
  await page.screenshot({ path: `${output}/light.png` });
  await page.getByLabel('外观主题').selectOption('dark');
  await page.getByRole('button', { name: '置顶开关', exact: true }).click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true);
  await page.getByRole('button', { name: '置顶开关', exact: true }).click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false);
  // The tray changes the native window outside renderer local state.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setAlwaysOnTop(true));
  await page.getByRole('button', { name: '置顶开关', exact: true, pressed: true }).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: '置顶开关', exact: true }).click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false);
  results.push('Always-on-top user toggle: PASS');
  for (const [width, height, expected] of [[280, 140, 'compact'], [340, 280, 'workspace'], [520, 90, 'compact'], [180, 54, 'capsule'], [520, 620, 'workspace']]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height]);
    await page.locator(`[data-density=${expected}]`).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `horizontal overflow at ${width}×${height}`);
    await page.screenshot({ path: `${output}/size-${width}x${height}.png` });
  }
  results.push('180×54, 280×140, 340×280, 520×90, 520×620 density/overflow: PASS');
  assert.deepEqual(errors, []);
  results.push('Renderer runtime errors: none');
  await writeFile(`${output}/desktop-smoke.json`, JSON.stringify({ date: '2026-10-17', results, errors, preferences, security }, null, 2));
  console.log(results.join('\n'));
} finally { await app.close(); }
