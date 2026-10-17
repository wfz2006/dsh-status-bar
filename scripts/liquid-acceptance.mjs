import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const executablePath = createRequire(resolve('apps/desktop/package.json'))('electron');
const env = { ...process.env, GLASS_SMOKE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [resolve('apps/desktop')], env });
const output = resolve('docs/evidence/liquid'); await mkdir(output, { recursive: true });
const report = { results: [], nativeCaptures: [], motionSamples: [] };
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '展开工作台', exact: true }).waitFor();
  const sampling = app.evaluate(({ BrowserWindow }) => new Promise(resolveSamples => {
    const win = BrowserWindow.getAllWindows()[0]; const samples = [];
    const listener = () => samples.push(win.getBounds()); win.on('resize', listener);
    setTimeout(() => { win.off('resize', listener); resolveSamples(samples); }, 800);
  }));
  await page.getByRole('button', { name: '展开工作台', exact: true }).click();
  report.motionSamples = await sampling;
  assert.ok(report.motionSamples.length >= 4, 'Expansion must change native bounds through multiple frames');
  assert.ok(report.motionSamples.some(b => b.width > 180 && b.width < 340));
  await page.locator('[data-morph=idle]').waitFor();
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(Math.abs(bounds.width - 340) <= 1); assert.ok(Math.abs(bounds.height - 300) <= 1);
  report.defaultNativeBounds = bounds;
  await page.getByRole('region', { name: '模拟审批' }).waitFor();
  assert.equal(await page.locator('.approval-details').getAttribute('open'), null);
  assert.ok(await page.locator('.preview-controls').getAttribute('open') === null);
  await page.screenshot({ path: `${output}/compact-default.png` });
  const geometry = await page.locator('.content').evaluate(e => ({ scroll: e.scrollHeight, height: e.clientHeight, children: [...e.children].map(c => ({ class: c.className, height: c.getBoundingClientRect().height })) }));
  console.log(JSON.stringify(geometry));
  assert.equal(geometry.scroll > geometry.height, false, 'Default compact layout should fit without scroll');
  assert.equal(await page.locator('.glass').evaluate(e => getComputedStyle(e).borderTopWidth), '0px');
  await page.screenshot({ path: `${output}/compact-default.png` });
  report.results.push('420ms native morph with intermediate frames, 340x300 default, collapsed details, no default scrollbar: PASS');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '折叠为胶囊', exact: true }).click();
  assert.equal((await page.evaluate(() => window.glass.getWindowState())).morphing, null);
  const small = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(Math.abs(small.width - 180) <= 1); assert.ok(Math.abs(small.height - 54) <= 1);
  await page.getByRole('button', { name: '展开工作台', exact: true }).click();
  await page.locator('[data-density=workspace]').waitFor();
  assert.equal((await page.evaluate(() => window.glass.getWindowState())).morphing, null);
  report.results.push('Reduced-motion skips native morph immediately: PASS');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.glass.windowAction('collapse'));
  await page.waitForTimeout(180);
  await page.evaluate(() => window.glass.windowAction('expand'));
  await page.waitForTimeout(280);
  await page.evaluate(() => window.glass.windowAction('collapse'));
  await page.evaluate(() => window.glass.windowAction('expand'));
  await page.locator('[data-morph=idle]').waitFor();
  const interrupted = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(Math.abs(interrupted.height - 300) <= 1, 'Interrupted morph must not save an intermediate size');
  report.results.push('Rapid direction changes preserve the last expanded target: PASS');
  // Native WS_THICKFRAME is disabled; verify custom corner dragging retains resize.
  const handle = page.locator('.resize-se'); const box = await handle.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 40, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).width).toBeGreaterThan(350);
  report.results.push('Custom native-frame-free pointer resizing: PASS');
  await page.evaluate(() => window.glass.resizeWindow({ x: 200, y: 150, width: 340, height: 300 }));
  if (process.argv.includes('--native') && process.platform === 'win32') {
    const backdropId = await app.evaluate(async ({ BrowserWindow }) => {
      const backdrop = new BrowserWindow({ x: 160, y: 110, width: 420, height: 380, frame: false, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await backdrop.loadURL('data:text/html,' + encodeURIComponent('<style>body{margin:0;height:100vh;background:conic-gradient(from 40deg at 25% 30%,#236653,#ce9e65,#405e9b,#236653)}</style>'));
      backdrop.show(); const glass = BrowserWindow.getAllWindows().find(w => w !== backdrop); glass.setAlwaysOnTop(true); glass.show(); glass.focus();
      return backdrop.id;
    });
    for (const material of ['acrylic', 'clear', 'solid']) {
      for (let count = 0; count < 3 && (await page.evaluate(() => window.glass.getWindowState())).material !== material; count++) await page.evaluate(() => window.glass.windowAction('material'));
      await page.waitForTimeout(400);
      const rect = await app.evaluate(({ BrowserWindow, screen }, id) => {
        const glass = BrowserWindow.getAllWindows().find(w => w.id !== id);
        return screen.dipToScreenRect(glass, glass.getBounds());
      }, backdropId);
      const file = join(tmpdir(), `dsh-glass-liquid-${material}.png`);
      const helper = process.env.GLASS_SCREENSHOT_HELPER ?? join(process.env.USERPROFILE, '.codex', 'skills', 'screenshot', 'scripts', 'take_screenshot.ps1');
      execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Path', file, '-Region', `${rect.x},${rect.y},${rect.width},${rect.height}`], { windowsHide: true, stdio: 'pipe' });
      report.nativeCaptures.push(file);
    }
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), backdropId);
    report.results.push('Windows DWM composited captures over controlled background: captured for visual inspection');
  }
  await writeFile(`${output}/acceptance.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); }
