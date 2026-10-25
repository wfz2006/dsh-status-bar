import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

const output = resolve('reports/drag-motion');
await mkdir(output, { recursive: true });
const f = await fixture();
const errors = [], results = [];
const bounds = () => f.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), f.mainId);
async function reset(animation = 'full') {
  await f.page.evaluate(() => window.glass.mockAction('restart'));
  await expect.poll(async () => (await f.page.evaluate(() => window.glass.getState())).approvals.length).toBe(0);
  await f.page.evaluate(animation => window.glass.setSettings({ animation, sound: false, autoApproval: false }), animation);
  await f.menu('view-capsule');
  await f.app.evaluate(({ BrowserWindow }, id) => { const w = BrowserWindow.fromId(id); w.setPosition(250, 220); w.show(); w.focus(); }, f.mainId);
  await f.page.waitForTimeout(180);
}
async function drag({ pause = 0 } = {}) {
  const start = await bounds();
  await f.page.mouse.move(72, 22); await f.page.mouse.down();
  await expect(f.page.locator('main')).toHaveAttribute('data-drag', 'pressed');
  let feedback;
  for (let i = 1; i <= 10; i++) {
    const current = await bounds();
    // Playwright uses viewport coordinates, while a real cursor stays in
    // desktop coordinates when the window moves underneath it.
    await f.page.mouse.move(72 + i * 12 - (current.x - start.x), 22);
    await f.page.waitForTimeout(16);
    const next = await bounds();
    assert.equal(next.width, start.width); assert.equal(next.height, start.height);
    if (i === 8) feedback = await f.page.evaluate(() => ({
      phase: document.querySelector('main').dataset.drag,
      swimmer: getComputedStyle(document.querySelector('.whale-companion')).translate,
      lean: getComputedStyle(document.querySelector('.whale-companion')).rotate,
      scale: getComputedStyle(document.querySelector('.whale-companion')).scale,
      reflection: getComputedStyle(document.querySelector('.glass-material'), '::before').opacity,
      glass: getComputedStyle(document.querySelector('.lg-material-surface')).transform,
      filter: getComputedStyle(document.querySelector('.lg-optics-clip > span')).backdropFilter,
    }));
  }
  const drop = await bounds();
  if (pause) await f.page.waitForTimeout(pause);
  await f.page.mouse.up();
  return { start, drop, feedback };
}
try {
  f.page.on('pageerror', e => errors.push(e.message));
  await reset();
  const held = await drag();
  await writeFile(resolve(output, 'latest-attempt.json'), JSON.stringify(held, null, 2));
  assert.equal(held.drop.x - held.start.x, 120, 'native window follows the held pointer exactly');
  assert.equal(held.feedback.phase, 'moving');
  assert.notEqual(held.feedback.swimmer, '0px 0px');
  assert.notEqual(held.feedback.lean, '0deg');
  assert.ok(Math.abs(parseFloat(held.feedback.lean)) >= 6, 'normal-speed drag has a clearly visible swimmer lean');
  assert.ok(parseFloat(held.feedback.scale) > 1.1, 'drag scale remains perceptible: ' + JSON.stringify(held.feedback));
  assert.ok(parseFloat(held.feedback.reflection) > .75, 'reflection visibly strengthens while moving');
  assert.equal(held.feedback.glass, 'none', 'the filtered surface never transforms');
  assert.match(held.feedback.filter, /url/, 'RGB lens remains enabled while dragging');
  const release = [];
  for (let i = 0; i < 40; i++) { release.push(await bounds()); await f.page.waitForTimeout(16); }
  assert.ok(Math.max(...release.map(p => p.x)) >= held.drop.x + 7, 'quick release has an easily perceived short spring: ' + JSON.stringify({ drop: held.drop.x, samples: release.map(p => p.x) }));
  assert.ok(release.every(p => Math.abs(p.x - held.drop.x) <= 14));
  assert.deepEqual(await bounds(), held.drop, 'settles at the exact release anchor');
  await expect(f.page.locator('main')).not.toHaveAttribute('data-drag');
  assert.equal((await f.page.evaluate(() => window.glass.getWindowState())).viewMode, 'capsule');
  results.push({ name: 'direct manipulation and bounded native spring', ...held, release });

  await reset();
  const slow = await drag({ pause: 220 });
  await f.page.waitForTimeout(100);
  assert.deepEqual(await bounds(), slow.drop, 'paused release does not throw');
  await expect(f.page.locator('main')).not.toHaveAttribute('data-drag');
  results.push({ name: 'paused release', result: 'PASS' });

  await reset();
  await drag(); await f.page.waitForTimeout(32);
  const grab = await bounds();
  await f.page.mouse.move(72, 22); await f.page.mouse.down();
  const grabbed = await bounds(); await f.page.waitForTimeout(100);
  assert.deepEqual(await bounds(), grabbed, 'grabbing interrupts the previous spring immediately');
  assert.ok(Math.abs(grabbed.x - grab.x) <= 2, 're-grab starts at the current position');
  await f.page.mouse.move(96, 22); await f.page.waitForTimeout(40);
  assert.equal((await bounds()).x, grabbed.x + 24);
  await f.page.mouse.up(); await f.page.waitForTimeout(640);
  results.push({ name: 'interruptible re-grab', result: 'PASS' });

  // The actual region sampler must keep updating through a held drag and its
  // release. Persist geometry/counts only, not desktop pixels or screenshots.
  await reset();
  await f.page.evaluate(async () => {
    window.__opticsTrace = [];
    window.__offDragOptics = window.glass.subscribeOpticsFrame(v => {
      const x = v.windowLeft - v.left + 60, y = v.windowTop - v.top + 20;
      window.__opticsTrace.push({ x: v.windowLeft, pixel: v.pixels[(y * v.width + x) * 4] });
    });
    await window.glass.setOpticsEnabled(true);
  });
  await expect.poll(() => f.page.evaluate(() => window.glass.getOpticsState())).toMatchObject({ running: true });
  await drag(); await f.page.waitForTimeout(640);
  const optical = await f.page.evaluate(async () => {
    window.__offDragOptics(); await window.glass.setOpticsEnabled(false);
    const result = { frames: window.__opticsTrace.length, positions: new Set(window.__opticsTrace.map(v => v.x)).size };
    delete window.__opticsTrace; delete window.__offDragOptics;
    return result;
  });
  assert.ok(optical.frames >= 3); assert.ok(optical.positions >= 3, 'live optical frames follow multiple native positions');
  results.push({ name: 'live region sampling during native dragging', ...optical });

  // Actual clicks/keyboard and existing view transitions remain intact.
  await reset(); await f.page.locator('.task-capsule').click();
  await expect(f.page.locator('.task-peek')).toBeVisible();
  await f.menu('view-capsule'); await f.page.locator('.task-capsule').focus(); await f.page.keyboard.press('Enter');
  await expect(f.page.locator('.task-peek')).toBeVisible();
  results.push({ name: 'click and keyboard activation', result: 'PASS' });

  await reset(); await drag(); await f.page.waitForTimeout(20);
  await f.page.locator('.task-capsule').focus(); await f.page.keyboard.press('Enter');
  await expect(f.page.locator('main')).toHaveAttribute('data-mode', 'peek');
  await expect(f.page.locator('main')).toHaveAttribute('data-morph', 'idle');
  await expect(f.page.locator('main')).not.toHaveAttribute('data-drag');
  const expanded = await bounds(); await f.page.waitForTimeout(480);
  assert.deepEqual(await bounds(), expanded, 'a cancelled spring cannot move or interrupt the expanded window');
  assert.ok(expanded.height > 100);
  await reset(); await drag(); await f.menu('hide'); await f.page.waitForTimeout(480); await f.menu('show');
  await expect(f.page.locator('main')).not.toHaveAttribute('data-drag');
  const shown = await bounds(); await f.page.waitForTimeout(100); assert.deepEqual(await bounds(), shown);
  results.push({ name: 'expansion and hide cancel release motion', result: 'PASS' });

  for (const animation of ['reduced', 'off', 'system']) {
    await reset(animation === 'system' ? 'full' : animation);
    if (animation === 'system') await f.page.emulateMedia({ reducedMotion: 'reduce' });
    const start = await bounds();
    await f.page.mouse.move(72, 22); await f.page.mouse.down(); await f.page.mouse.move(108, 22);
    await f.page.waitForTimeout(50); const drop = await bounds(); await f.page.mouse.up(); await f.page.waitForTimeout(100);
    assert.equal(drop.x - start.x, 36); assert.deepEqual(await bounds(), drop);
    await expect(f.page.locator('main')).not.toHaveAttribute('data-drag');
    if (animation === 'system') await f.page.emulateMedia({ reducedMotion: 'no-preference' });
    results.push({ name: animation + ' respects reduced motion without affecting dragging', result: 'PASS' });
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ result: 'PASS', input: 'Playwright mouse on a real Electron BrowserWindow; native bounds sampled', results, errors }, null, 2));
  console.log('Drag motion acceptance: PASS');
} finally { await f.app.close(); }
