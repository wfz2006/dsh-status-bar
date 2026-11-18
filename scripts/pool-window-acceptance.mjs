import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

if (process.platform !== 'win32') throw new Error('This acceptance run needs Windows.');
const output = resolve('reports/pool-companion-prototype');
await mkdir(output, { recursive: true });
const f = await fixture({ ELECTRON_RENDERER_URL: '' });
const { app, page, mainId } = f;
const main = page.locator('main.glass');
const whale = page.locator('.pool-whale-target');
const orb = page.locator('button.capsule-edge-orb');
const mouse = await page.context().newCDPSession(page);
const report = { status: 'running', pointer: 'Chromium DevTools mouse events in the real Electron window',
  shortcut: 'Win32 SendInput to the accelerator registered by this Electron process',
  screenshots: 'Isolated Electron renderer with transparent background', checks: [], errors: [] };
const geometryIssues = [];
page.on('pageerror', error => report.errors.push(error.message));

const bounds = () => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), mainId);
const visible = () => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), mainId);
const ownsShortcut = () => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+G'));
let identity, area;

async function snapshot() {
  const win = await app.evaluate(({ BrowserWindow, screen }, id) => {
    const window = BrowserWindow.fromId(id), bounds = window.getBounds();
    return { bounds, visible: window.isVisible(), physical: screen.dipToScreenRect(window, bounds) };
  }, mainId);
  const values = execFileSync(resolve('apps/desktop/native/RegionCapture.exe'),
    ['--geometry', identity.handle, String(identity.pid)], { windowsHide: true, encoding: 'utf8' }).trim().split(/\s+/).map(Number);
  const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map((key, i) => [key, values[i]]));
  // Electron encloses both physical edges when reporting whole DIPs. Mapping
  // that rectangle back can add a DIP on each side on fractional displays.
  for (const key of Object.keys(rect)) {
    const limit = key === 'width' || key === 'height' ? 2 * identity.scaleFactor : identity.scaleFactor;
    assert.ok(Math.abs(rect[key] - win.physical[key]) <= Math.ceil(limit),
      'Win32 geometry outside the DIP rounding interval: ' + JSON.stringify({ rect, electron: win.physical }));
  }
  const ui = await page.evaluate(async () => {
    const root = document.querySelector('main.glass'), pool = root.querySelector('.pool-view');
    const state = await window.glass.getWindowState();
    return { appearance: state.settings.appearance, skin: state.settings.whaleSkin, mode: state.viewMode,
      dock: root.dataset.dockEdge ?? null, scene: pool?.dataset.poolScene ?? null, readable: pool?.dataset.readable === 'true',
      whales: root.querySelectorAll('.pool-whale-target,.capsule-edge-orb .whale-companion').length,
      heading: pool?.querySelector('.pool-heading p')?.textContent ?? null };
  });
  assert.equal(ui.appearance, 'whale-pool');
  assert.equal(ui.skin, 'classic');
  assert.equal(ui.whales, 1, 'There must be exactly one whale in the active view.');
  return { ...ui, visible: win.visible, bounds: win.bounds, win32Pixels: rect };
}

async function trace() {
  return page.evaluate(() => window.poolWindowTrace.splice(0));
}
async function dragTo(target, drop) {
  const start = await bounds(), box = await target.boundingBox();
  assert.ok(box, 'The drag starts on a visible target.');
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const send = (type, x, y, buttons) => mouse.send('Input.dispatchMouseEvent',
    { type, x, y, button: 'left', buttons, clickCount: 1 });
  await send('mouseMoved', point.x, point.y, 0);
  await send('mousePressed', point.x, point.y, 1);
  const steps = Math.max(2, Math.ceil(Math.hypot(drop.x - start.x, drop.y - start.y) / 12));
  for (let step = 1; step <= steps; step++) {
    const current = await bounds();
    const wanted = { x: start.x + Math.round((drop.x - start.x) * step / steps),
      y: start.y + Math.round((drop.y - start.y) * step / steps) };
    // Hold the test cursor in desktop DIPs while the HWND moves underneath it.
    await send('mouseMoved', point.x + wanted.x - current.x, point.y + wanted.y - current.y, 1);
    await expect.poll(async () => {
      const next = await bounds();
      return Math.max(Math.abs(next.x - wanted.x), Math.abs(next.y - wanted.y));
    }, { timeout: 3000, intervals: [10, 20, 40], message: 'Native window follows the held pointer' }).toBeLessThanOrEqual(2);
  }
  const held = await bounds();
  await send('mouseReleased', point.x + drop.x - held.x, point.y + drop.y - held.y, 0);
  return { start, held, steps };
}

async function rest() {
  await expect(whale).toBeVisible();
  await expect(main).not.toHaveAttribute('data-dock-edge');
  await expect(main).toHaveAttribute('data-mode', 'capsule');
  await expect(main).toHaveAttribute('data-morph', 'idle');
}

async function dockRight() {
  const normal = await bounds(), right = area.x + area.width;
  const x = right - normal.width - 112, y = area.y + Math.round((area.height - normal.height) / 2);
  await app.evaluate(({ BrowserWindow }, id) => {
    const window = BrowserWindow.fromId(id); window.show(); window.focus();
  }, mainId);
  await page.evaluate(point => window.glass.moveWindow(point), { x, y });
  await expect.poll(async () => Math.abs((await bounds()).x - x)).toBeLessThanOrEqual(1);
  const beforeDrag = await snapshot();
  const drag = await dragTo(whale, { x: right - normal.width - 2, y });
  await expect(main).toHaveAttribute('data-dock-edge', 'right');
  await expect(main).not.toHaveAttribute('data-edge-motion');
  await expect(orb).toBeVisible();
  const docked = await snapshot();
  // At 150% an outward-rounded DIP rectangle can include a fractional pixel
  // at the right work-area boundary. Check the HWND extent in physical pixels.
  for (const size of ['width', 'height']) {
    assert.ok(Math.abs(docked.win32Pixels[size] - 64 * identity.scaleFactor) <= 1, '64-DIP orb: ' + JSON.stringify(docked));
  }
  assert.ok(Math.abs(docked.bounds.x + docked.bounds.width - right) <= 1);
  return { beforeDrag, drag, docked };
}

try {
  identity = await app.evaluate(({ app, BrowserWindow, screen, systemPreferences }, id) => {
    const window = BrowserWindow.fromId(id), display = screen.getDisplayMatching(window.getBounds());
    return { handle: window.getNativeWindowHandle().readBigUInt64LE().toString(), pid: process.pid,
      isolatedSmoke: process.env.GLASS_SMOKE === '1' && process.env.GLASS_USER_DATA_DIR === app.getPath('userData'),
      workArea: display.workArea, scaleFactor: display.scaleFactor, systemReduced: systemPreferences.getAnimationSettings().prefersReducedMotion,
      electron: process.versions.electron, chromium: process.versions.chrome };
  }, mainId);
  assert.equal(identity.isolatedSmoke, true);
  area = identity.workArea;
  const renderer = await page.evaluate(() => ({ protocol: location.protocol,
    bundle: document.querySelector('script[type="module"]')?.src.split('/').at(-1) }));
  assert.equal(renderer.protocol, 'file:');
  report.environment = { ...identity, renderer, shortcutRegistered: await ownsShortcut() };
  await page.evaluate(() => window.glass.mockAction('edge-cases'));
  await page.evaluate(() => window.glass.setSettings({ appearance: 'whale-pool', whaleSkin: 'classic', animation: 'off', edgeDock: true,
    sound: false, autoApproval: false, autoCollapse: false, desktopOptics: false }));
  await page.evaluate(() => window.glass.windowAction('collapse', true));
  await rest();
  await page.evaluate(() => {
    window.poolWindowTrace = [];
    window.poolClipChanges = [];
    const root = document.querySelector('main.glass');
    let previous;
    const record = () => {
      const pool = root.querySelector('.pool-view');
      const sample = { edgeMotion: root.dataset.edgeMotion ?? null, dock: root.dataset.dockEdge ?? null, mode: root.dataset.mode,
        scene: pool?.dataset.poolScene ?? null, whales: root.querySelectorAll('.pool-whale-target,.capsule-edge-orb .whale-companion').length };
      const key = JSON.stringify(sample);
      if (key !== previous) { window.poolWindowTrace.push(sample); previous = key; }
    };
    new MutationObserver(changes => {
      for (const change of changes) {
        if (change.attributeName === 'data-pool-clip' || change.attributeName === 'data-pool-cue') {
          window.poolClipChanges.push({ attribute: change.attributeName, before: change.oldValue,
            after: change.target.getAttribute(change.attributeName) });
        }
      }
      record();
    }).observe(root, { subtree: true, childList: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['data-edge-motion', 'data-dock-edge', 'data-mode', 'data-pool-scene', 'data-pool-clip', 'data-pool-cue'] });
    record();
  });
  await page.evaluate(() => window.glass.setSettings({ animation: 'full' }));
  const normal = await snapshot();
  const first = await dockRight();
  await page.screenshot({ path: join(output, 'native-window-edge-orb.png'), omitBackground: true });
  await orb.click();
  await rest();
  const clicked = await snapshot();
  for (const size of ['width', 'height']) {
    if (Math.abs(clicked.win32Pixels[size] - first.beforeDrag.win32Pixels[size]) > 1)
      geometryIssues.push({ action: 'click', size, before: first.beforeDrag.win32Pixels[size], after: clicked.win32Pixels[size] });
  }
  assert.ok(Math.abs(clicked.bounds.x + clicked.bounds.width - area.x - area.width) <= 1);
  const animation = await trace();
  if (!identity.systemReduced) {
    for (const phase of ['gather', 'spread']) assert.ok(animation.some(frame => frame.edgeMotion === phase), 'Expected ' + phase);
  }
  assert.ok(animation.every(frame => frame.whales === 1), 'One whale through both edge transitions.');
  report.checks.push({ name: 'Drag to right edge and click the orb to restore the whale', normal, ...first, clicked, animation });

  await page.evaluate(() => window.glass.setSettings({ animation: 'reduced' }));
  const second = await dockRight();
  const drop = { x: second.docked.bounds.x - 172, y: second.docked.bounds.y + 48 };
  const leave = await dragTo(orb, drop);
  await rest();
  const detached = await snapshot(), reducedFrames = await trace();
  for (const [position, size] of [['x', 'width'], ['y', 'height']]) {
    if (Math.abs(detached.win32Pixels[size] - first.beforeDrag.win32Pixels[size]) > 1)
      geometryIssues.push({ action: 'detach', size, before: first.beforeDrag.win32Pixels[size], after: detached.win32Pixels[size] });
    assert.ok(Math.abs(detached.bounds[position] + detached.bounds[size] / 2 - drop[position] - second.docked.bounds[size] / 2) <= 2,
      'The restored whale is centered on the orb release.');
  }
  assert.ok(reducedFrames.every(frame => frame.edgeMotion === null && frame.whales === 1),
    'Reduced motion uses the final geometry with one whale throughout.');
  report.checks.push({ name: 'Reduced-motion edge drag and detach at release', ...second, leave, detached, reducedFrames });
  await page.evaluate(() => window.glass.setSettings({ animation: 'full' }));
  await expect(main).toHaveAttribute('data-animation', 'full');
  await whale.click();
  await expect(page.locator('.pool-view')).toHaveAttribute('data-readable', 'true');
  await expect(page.getByRole('button', { name: /任务详情/ })).toBeEnabled();
  const open = await snapshot();
  assert.equal(open.mode, 'peek');
  assert.ok(open.bounds.width > normal.bounds.width && open.bounds.height > normal.bounds.height);
  report.checks.push({ name: 'Restored whale opens the readable pool', open });

  assert.equal(await ownsShortcut(), true, 'This fixture must own Ctrl+Shift+G before sending Windows input.');
  const guard = await app.evaluate(async ({ BrowserWindow }, id) => {
    const main = BrowserWindow.fromId(id), { x, y } = main.getBounds();
    const guard = new BrowserWindow({ x, y, width: 180, height: 80, frame: false, show: false, skipTaskbar: true,
      title: '鲸鱼水池 · 窗口验收', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await guard.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<title>鲸鱼水池 · 窗口验收</title><p>正在验证窗口唤醒</p>'));
    return { id: guard.id, handle: guard.getNativeWindowHandle().readBigUInt64LE().toString() };
  }, mainId);
  await page.evaluate(() => { window.poolClipChanges.length = 0; });
  await f.menu('hide');
  await expect.poll(visible).toBe(false);
  await page.evaluate(() => window.glass.mockAction('completed'));
  await expect.poll(() => page.evaluate(async () => {
    const data = await window.glass.getState(); return data.sessions[data.selectedSession]?.phase;
  }), { timeout: 12000, intervals: [80, 150, 200] }).toBe('finished');
  const whileHidden = await page.evaluate(async () => {
    const state = await window.glass.getWindowState(), data = await window.glass.getState();
    return { visible: state.visible, event: data.poolEvent ?? null, completionFeedback: state.completionFeedback };
  });
  await trace();
  // Prepare the native input probe before focusing the guard. Starting PowerShell
  // and compiling its Win32 bindings can otherwise steal the foreground in between.
  const native = await new Promise((resolveResult, reject) => {
    const probe = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', resolve('scripts/wake-owned-pool-window.ps1'), '-MainHandle', identity.handle, '-GuardHandle', guard.handle,
      '-Owner', String(identity.pid)], { windowsHide: true, encoding: 'utf8', timeout: 12000 }, (error, stdout) => {
      if (error) return reject(error);
      try { resolveResult(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch (parseError) { reject(parseError); }
    });
    createInterface({ input: probe.stdout }).once('line', async line => {
      try {
        assert.equal(line, 'ready');
        assert.equal(await ownsShortcut(), true);
        await app.evaluate(({ app, BrowserWindow }, id) => {
          const guard = BrowserWindow.fromId(id);
          guard.setAlwaysOnTop(true); guard.show(); guard.moveTop(); app.focus({ steal:true }); guard.focus();
        }, guard.id);
        await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFocused(), guard.id)).toBe(true);
        probe.stdin.end('wake\n');
      } catch (error) { probe.kill(); reject(error); }
    });
  });
  assert.equal(native.inputRecords, 6);
  assert.equal(native.mainVisibleAfter, true, 'Win32 IsWindowVisible after the registered hotkey');
  await expect.poll(visible).toBe(true);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFocused(), mainId)).toBe(true);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(), guard.id);
  await expect(page.locator('.pool-heading p')).toContainText('已完成');
  await expect(page.locator('.pool-view')).toHaveAttribute('data-pool-scene', 'completed');
  await expect(page.locator('.pool-view')).toHaveAttribute('data-pool-clip', 'settled');
  const clips = await page.locator('.pool-view').evaluate(pool => ({ current: pool.dataset.poolClip, cue: pool.dataset.poolCue ?? null,
    changesDuringHideAndWake: window.poolClipChanges.slice() }));
  assert.ok(clips.changesDuringHideAndWake.every(({ before, after }) =>
    ![before, after].some(value => value === 'happy' || value === 'completed')), 'The awakened whale must not replay the hidden celebration.');
  const paintedWhale = await page.locator('canvas.pool-whale-art').evaluate(canvas => {
    const sample = document.createElement('canvas'); sample.width = sample.height = 32;
    const ctx = sample.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 32, 32);
    const rgba = ctx.getImageData(0, 0, 32, 32).data;
    return { pixels: 32 * 32, opaqueSamples: rgba.filter((value, i) => i % 4 === 3 && value > 16).length };
  });
  assert.ok(paintedWhale.opaqueSamples > 4, 'The awakened actor canvas contains the rendered whale.');
  const awake = await snapshot(), wakeFrames = await trace();
  assert.equal(awake.readable, true);
  assert.equal(awake.mode, open.mode);
  assert.deepEqual(awake.bounds, open.bounds);
  assert.deepEqual(awake.win32Pixels, open.win32Pixels);
  assert.ok(wakeFrames.every(frame => frame.whales === 1));
  const completion = await page.evaluate(async () => {
    const data = await window.glass.getState(), state = await window.glass.getWindowState();
    return { phase: data.sessions[data.selectedSession]?.phase, event: data.poolEvent ?? null, completionFeedback: state.completionFeedback };
  });
  await page.screenshot({ path: join(output, 'native-window-awake.png'), omitBackground: true });
  await page.getByRole('button', { name: /任务详情/ }).click();
  await expect(main).toHaveAttribute('data-mode', 'expanded');
  report.checks.push({ name: 'Hide, finish a mock task while hidden, Windows shortcut wake, and open details', native, awake,
    whileHidden, completion, clips, paintedWhale, wakeFrames, detailsOpened: true });
  assert.deepEqual(whileHidden, { visible: false, event: null, completionFeedback: false });
  assert.equal(completion.event, null, 'Hidden completion must not enqueue a stale effect on wake.');
  assert.equal(completion.completionFeedback, false);
  assert.deepEqual(geometryIssues, [], 'Resting HWND dimensions must stay stable across successive dock and restore cycles.');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error.stack ?? error);
  if (identity) report.lastWindow = await snapshot().catch(cause => ({ unavailable: String(cause) }));
  throw error;
} finally {
  report.geometryIssues = geometryIssues;
  try { await app.close(); }
  finally { await writeFile(join(output, 'native-window-verification.json'), JSON.stringify(report, null, 2)); }
}
console.log(report.status + ' — ' + report.checks.map(check => check.name).join(' / '));
