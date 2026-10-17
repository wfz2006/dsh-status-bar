import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
export async function runAcceptance({ native = false } = {}) {
  const executablePath = createRequire(resolve('apps/desktop/package.json'))('electron');
  const profile = await mkdtemp(join(tmpdir(), 'dsh-glass-redesign-'));
  const env = { ...process.env, GLASS_SMOKE: '1', GLASS_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args: [resolve('apps/desktop')], env });
  const output = resolve('docs/evidence/redesign'); await mkdir(output, { recursive: true });
  const report = { results: [], motion: [], nativeCaptures: [], errors: [] };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => report.errors.push(error.message));
    const ui = () => page.evaluate(() => window.glass.getWindowState());
    async function menu(id) {
      await app.evaluate(({ Menu, BrowserWindow }, id) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(id);
        if (!item || !item.enabled) throw new Error('Menu unavailable: ' + id);
        item.click(item, BrowserWindow.getAllWindows()[0], {});
      }, id);
      await expect.poll(async () => (await ui()).morphing).toBe(null);
    }
    async function screenshot(name) { await page.screenshot({ path: output + '/' + name + '.png' }); }
    async function assertNoOverflow() {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('.glass').evaluate(e => e.scrollWidth > e.clientWidth), false);
    }
    await page.getByRole('button', { name: '展开速览', exact: true }).waitFor();
    await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).connection).toBe('connected');
    assert.equal((await ui()).viewMode, 'capsule');
    assert.equal(await page.locator('.brand,.titlebar,footer,.mock-tag,.tiny-mock').count(), 0);
    assert.equal(await page.getByText('Mock 已连接', { exact: true }).count(), 0);
    await screenshot('phase1-capsule');
    // Real pointer drag must not trigger capsule expansion.
    const capsule = await page.locator('.task-capsule').boundingBox();
    const beforeDrag = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    await page.mouse.move(capsule.x + 70, capsule.y + 25); await page.mouse.down();
    await page.mouse.move(capsule.x + 25, capsule.y + 40); await page.mouse.up();
    await expect.poll(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).x).toBeLessThan(beforeDrag.x - 20);
    assert.equal((await ui()).viewMode, 'capsule');
    report.results.push('Phase 1: task-only capsule, no permanent branding/source/footer, drag does not click: PASS');
    const samplePromise = app.evaluate(({ BrowserWindow }) => new Promise(resolveSamples => {
      const win = BrowserWindow.getAllWindows()[0]; const samples = [];
      const listener = () => samples.push({ time: performance.now(), ...win.getBounds() }); win.on('resize', listener);
      setTimeout(() => { win.off('resize', listener); resolveSamples(samples); }, 650);
    }));
    await page.getByRole('button', { name: '展开速览', exact: true }).click();
    await page.locator('[data-mode=peek][data-morph=idle]').waitFor();
    report.motion = await samplePromise;
    assert.ok(report.motion.length >= 4);
    await screenshot('phase2-peek');
    await page.getByRole('button', { name: '展开任务详情', exact: true }).click();
    await page.locator('[data-mode=expanded][data-morph=idle]').waitFor();
    await expect.poll(async () => page.locator('.todo').count()).toBe(2);
    await screenshot('phase2-expanded');
    // Wait for the initial read-only Mock request, then verify explicit attention view.
    await page.getByRole('button', { name: /项操作需要确认/ }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /项操作需要确认/ }).click();
    await page.locator('[data-mode=approval][data-morph=idle]').waitFor();
    await expect(page.getByRole('button', { name: '允许一次', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '拒绝', exact: true })).toBeDisabled();
    await screenshot('phase2-approval');
    const invalidCopy = await page.evaluate(async () => { try { await window.glass.copyApproval({ sessionId: 'wrong', requestId: 'mock-approval-1' }); return false; } catch { return true; } });
    assert.equal(invalidCopy, true);
    report.results.push('Phase 2: capsule → peek → expanded → approval, Todo replacement, request identity and fail-closed controls: PASS');
    const menuItems = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(i => ({ id: i.id, label: i.label })));
    report.menuItems = menuItems;
    for (const id of ['view-capsule','view-peek','view-expanded','view-approval','pin','settings','open-dsh','reconnect','hide','show','quit','debug']) assert.ok(menuItems.some(i => i.id === id));
    await menu('settings');
    await expect(page.getByText('Mock 演示', { exact: true })).toBeVisible();
    await page.getByLabel('显示主题').selectOption('light');
    await page.getByLabel('玻璃强度').selectOption('readable');
    await page.getByLabel('默认形态').selectOption('peek');
    await page.getByLabel('动画', { exact: true }).selectOption('off');
    await page.getByLabel('置顶行为').selectOption('always');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true);
    assert.equal((await ui()).settings.defaultView, 'peek');
    await screenshot('settings');
    await page.getByLabel('默认形态').selectOption('capsule');
    await page.getByLabel('置顶行为').selectOption('normal');
    await page.getByLabel('玻璃强度').selectOption('balanced');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect.poll(async () => (await ui()).panel).toBe(null);
    await menu('view-expanded');
    await page.getByLabel('选择会话').selectOption('demo-other');
    assert.equal(await page.locator('.todo').count(), 1);
    await page.getByLabel('选择会话').selectOption('demo-main');
    await menu('mock-disconnect');
    await expect(page.getByRole('button', { name: '检查连接并重试', exact: true })).toBeVisible();
    await page.evaluate(() => window.glass.setSettings({ pin: 'on-notification' }));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false, 'Stale pending requests must not trigger notification pin');
    await page.evaluate(() => window.glass.setSettings({ pin: 'normal' }));
    await screenshot('disconnected');
    await menu('reconnect');
    await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).connection).toBe('connected');
    assert.equal(await page.locator('.todo').count(), 2);
    report.results.push('Menu migration/settings/pin/session switch/disconnect/reconnect preserve original behavior: PASS');
    // Auto expansion is opt-in. Verify manual size suppresses subsequent attention.
    await menu('settings');
    await page.getByLabel('审批时自动展开').check();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await menu('view-capsule');
    await menu('mock-approval-queue');
    await page.locator('[data-mode=approval][data-morph=idle]').waitFor({ timeout: 15000 });
    await expect(page.locator('.approval-card')).toHaveCount(2, { timeout: 12000 });
    await screenshot('approval-queue');
    await menu('mock-disconnect'); await menu('reconnect');
    await expect(page.locator('.approval-card')).toHaveCount(2);
    for (const b of await page.getByRole('button', { name: '允许一次', exact: true }).all()) await expect(b).toBeDisabled();
    await menu('view-expanded');
    await page.evaluate(() => window.glass.resizeWindow({ x: 200, y: 120, width: 380, height: 300 }));
    assert.equal((await ui()).manualSize, true);
    await menu('mock-restart');
    await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).approvals.length, { timeout: 15000 }).toBe(1);
    assert.equal((await ui()).viewMode, 'expanded');
    report.results.push('Two-request queue and reconnect retain both identities; auto expansion respects manual size: PASS');
    await page.evaluate(() => window.glass.setSettings({ autoCollapse: true }));
    await menu('view-expanded'); await menu('mock-completed');
    await expect.poll(async () => (await ui()).completionFeedback, { timeout: 12000, intervals: [100] }).toBe(true);
    await expect.poll(async () => (await ui()).viewMode, { timeout: 4000 }).toBe('capsule');
    await menu('view-expanded'); await menu('mock-completed');
    await expect.poll(async () => (await ui()).completionFeedback, { timeout: 12000, intervals: [100] }).toBe(true);
    await menu('mock-disconnect'); await page.waitForTimeout(1700);
    assert.equal((await ui()).viewMode, 'expanded', 'Disconnected completion must not hide recovery details');
    assert.equal((await ui()).completionFeedback, false);
    await page.evaluate(() => window.glass.setSettings({ autoCollapse: false }));
    report.results.push('Explicit finished phase triggers opt-in collapse; disconnect cancels pending completion collapse: PASS');
    await menu('settings');
    await page.getByLabel('审批时自动展开').uncheck();
    await page.getByLabel('动画', { exact: true }).selectOption('full');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.glass.windowAction('collapse', matchMedia('(prefers-reduced-motion: reduce)').matches));
    assert.equal((await ui()).morphing, null);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await menu('mock-edge-cases'); await menu('view-expanded');
    await expect.poll(async () => page.getByRole('progressbar').count()).toBe(0);
    await expect(page.getByText('此会话尚无 Todo，不显示百分比。')).toBeVisible();
    await assertNoOverflow(); await screenshot('long-title-empty-todo');
    await menu('view-capsule'); await assertNoOverflow();
    assert.ok((await page.locator('.task-capsule').getAttribute('title')).length > 150, 'Truncated title remains available in tooltip');
    report.results.push('Reduced motion, long Chinese title and empty Todo layout: PASS');
    await menu('view-expanded');
    const resize = await page.locator('.resize-se').boundingBox();
    const prior = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    await page.mouse.move(resize.x + 7, resize.y + 7); await page.mouse.down(); await page.mouse.move(resize.x + 30, resize.y + 35, { steps: 1 }); await page.mouse.up();
    await expect.poll(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).width).toBeGreaterThan(prior.width + 10);
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    });
    assert.deepEqual(prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    await menu('hide');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    await menu('show');
    report.results.push('Actual pointer resize, hide/restore and Electron sandbox: PASS');
    if (native && process.platform === 'win32') {
      await menu('mock-restart'); await menu('view-expanded');
      await page.evaluate(() => window.glass.resizeWindow({ x: 200, y: 150, width: 400, height: 280 }));
      const backdropId = await app.evaluate(async ({ BrowserWindow }) => {
        const b = new BrowserWindow({ x: 160, y: 110, width: 500, height: 460, frame: false, show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
        await b.loadURL('data:text/html,<style>body{margin:0;height:100vh;background:white}</style>'); b.setAlwaysOnTop(true); b.show();
        const glass = BrowserWindow.getAllWindows().find(w => w !== b); glass.setAlwaysOnTop(true, 'screen-saver'); glass.show(); glass.focus(); return b.id;
      });
      for (const [name, background, material] of [
        ['light-acrylic','#f8fbff','system'], ['dark-acrylic','#111e2e','system'],
        ['pattern-acrylic','repeating-linear-gradient(35deg,transparent 0 36px,%23ffffff25 36px 38px),conic-gradient(%23a2c9ef,%23e7e8d2,%2387aab5,%23a2c9ef)','system'],
        ['pattern-transparent','conic-gradient(%23a2c9ef,%23e7e8d2,%2387aab5,%23a2c9ef)','transparent'],
        ['pattern-solid','conic-gradient(%23a2c9ef,%23e7e8d2,%2387aab5,%23a2c9ef)','solid'],
      ]) {
        await page.evaluate(material => window.glass.setSettings({ theme: 'light', material, pin: 'always' }), material);
        await app.evaluate(async ({ BrowserWindow }, { id, background }) => {
          const b = BrowserWindow.fromId(id);
          const color = decodeURIComponent(background);
          await b.loadURL('data:text/html,' + encodeURIComponent('<style>body{margin:0;height:100vh;background:' + color + '}</style>'));
          const glass = BrowserWindow.getAllWindows().find(w => w.id !== id); glass.setAlwaysOnTop(true, 'screen-saver'); glass.focus(); glass.moveTop();
        }, { id: backdropId, background });
        await page.waitForTimeout(1000);
        const rect = await app.evaluate(({ BrowserWindow, screen }, id) => { const w = BrowserWindow.getAllWindows().find(w => w.id !== id); return screen.dipToScreenRect(w, w.getBounds()); }, backdropId);
        const file = join(tmpdir(), 'dsh-redesign-' + name + '.png');
        const helper = process.env.GLASS_SCREENSHOT_HELPER ?? join(process.env.USERPROFILE, '.codex','skills','screenshot','scripts','take_screenshot.ps1');
        execFileSync('powershell', ['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',file,'-Region',rect.x+','+rect.y+','+rect.width+','+rect.height], { windowsHide: true, stdio:'pipe' });
        await copyFile(file, output + '/native-' + name + '.png'); report.nativeCaptures.push(name);
      }
      await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), backdropId);
    }
    // CPU samples are measured process metrics, not presented-frame/FPS claims.
    await app.evaluate(({ app }) => app.getAppMetrics());
    await page.waitForTimeout(1600);
    report.processMetrics = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ type:p.type, cpu:p.cpu.percentCPUUsage, workingSetKB:p.memory.workingSetSize })));
    assert.deepEqual(report.errors, []);
    await writeFile(output + '/acceptance.json', JSON.stringify(report,null,2));
    if (native) await writeFile(output + '/native-acceptance.json', JSON.stringify(report,null,2));
    console.log(report.results.join('\n'));
    console.log('Native morph samples: ' + report.motion.length + '; renderer errors: ' + report.errors.length);
  } catch (error) {
    const page = app.windows()[0];
    if (page && !page.isClosed()) {
      await page.screenshot({ path: output + '/failure.png' });
      await writeFile(output + '/failure.json', JSON.stringify(await page.evaluate(async () => ({ window: await window.glass.getWindowState(), source: await window.glass.getState(), mode: document.querySelector('main')?.getAttribute('data-mode'), panel: document.querySelector('main')?.getAttribute('data-panel'), text: document.body.innerText })), null, 2));
    }
    throw error;
  } finally { await app.close(); }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await runAcceptance({ native: process.argv.includes('--native') });
