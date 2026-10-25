import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

const f = await fixture();
const output = resolve('reports/optimization');
const checks = [];
try {
  const { app, page, mainId, menu } = f;
  await menu('view-expanded');
  await expect(page.locator('#glass-defs feDisplacementMap')).toHaveCount(3);
  const map = await page.locator('#glass-defs feImage').first().getAttribute('href');
  for (let i = 0; i < 3; i++) {
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).hide(), mainId);
    await expect.poll(() => page.evaluate(async () => (await window.glass.getWindowState()).visible)).toBe(false);
    await expect(page.locator('#glass-defs filter')).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).show(), mainId);
    await expect.poll(() => page.evaluate(async () => (await window.glass.getWindowState()).visible)).toBe(true);
    await expect(page.locator('#glass-defs feDisplacementMap')).toHaveCount(3);
    assert.equal(await page.locator('#glass-defs feImage').first().getAttribute('href'), map);
  }
  checks.push('three hide/show cycles release hidden SVG filters and restore the exact map and all three RGB passes');
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(), mainId);
  await expect.poll(() => page.evaluate(async () => (await window.glass.getWindowState()).visible)).toBe(false);
  await expect(page.locator('#glass-defs filter')).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).restore(), mainId);
  await expect(page.locator('#glass-defs feDisplacementMap')).toHaveCount(3);
  assert.equal(await page.locator('#glass-defs feImage').first().getAttribute('href'), map);
  checks.push('native minimize/restore releases and restores the same optical map');
  await menu('settings');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await page.getByLabel('玻璃主题', { exact: true }).selectOption('solid');
  await expect(page.locator('#glass-defs filter')).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).hide(), mainId);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).show(), mainId);
  await expect(page.locator('#glass-defs filter')).toHaveCount(0);
  await page.getByLabel('玻璃主题', { exact: true }).selectOption('transparent');
  await expect(page.locator('#glass-defs feDisplacementMap')).toHaveCount(3);
  checks.push('settings, solid material, hidden solid window and return to transparent remain functional');
  await mkdir(output, { recursive: true });
  const environment = await app.evaluate(({ screen }) => ({ node: process.versions.node, electron: process.versions.electron, scaleFactor: screen.getPrimaryDisplay().scaleFactor }));
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ result: 'PASS', environment, checks }, null, 2));
  console.log('Optimization lifecycle acceptance: PASS', checks);
} finally { await f.app.close(); }
