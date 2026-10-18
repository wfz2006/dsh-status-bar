import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

const output = resolve('reports/whale-elements');
const native = process.argv.includes('--native');
await mkdir(output, { recursive:true });
const f = await fixture();
const errors = [];
try {
  const { app, page, menu, mainId } = f;
  page.on('pageerror', error => errors.push(error.message));
  async function preview(name) {
    // Controlled preview backing for a transparent renderer, not a native optics capture.
    const backing = await page.addStyleTag({content:'html { background:linear-gradient(125deg,#e4edff,#f2f4ee)!important; }'});
    await page.screenshot({path:resolve(output,'renderer-'+name+'.png')});
    await backing.evaluate(element => element.remove());
  }
  await expect(page.locator('.whale-companion')).toHaveAttribute('data-whale-state','running');
  await expect(page.locator('.whale-companion .status-orb')).toHaveAttribute('aria-label', '进行中');
  const boundsBefore = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), mainId);
  const box = await page.locator('.task-capsule').boundingBox();
  await page.mouse.move(box.x + 70, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 28);
  await page.mouse.up();
  const boundsAfter = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), mainId);
  assert.equal(boundsAfter.width, boundsBefore.width);
  assert.equal(boundsAfter.height, boundsBefore.height);
  await expect(page.locator('main')).toHaveAttribute('data-mode','capsule');
  await preview('capsule');
  if (native) { await f.backdrop(); await f.capture(resolve(output,'native-capsule.png')); }
  await page.locator('.whale-companion').click();
  await expect(page.locator('main')).toHaveAttribute('data-mode','peek');

  await menu('view-capsule');
  await page.evaluate(() => window.glass.setSettings({ animation:'reduced' }));
  await expect(page.locator('.whale-swimmer')).toHaveCSS('animation-name','none');
  await page.evaluate(() => window.glass.setSettings({ animation:'full' }));
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect(page.locator('.whale-swimmer')).toHaveCSS('animation-name','none');
  await page.emulateMedia({ reducedMotion:'no-preference' });

  await menu('view-expanded');
  await page.getByRole('button', { name:/选择会话/ }).click();
  await page.getByRole('option', { name:'视觉探索' }).click();
  await expect(page.locator('.picker-menu')).toBeHidden();
  await expect(page.locator('.whale-empty')).toBeVisible();
  await preview('empty');
  if (native) await f.capture(resolve(output,'native-empty.png'));
  await menu('settings');
  await expect(page.locator('.whale-signature')).toBeVisible();
  await preview('settings');
  await menu('view-capsule');
  await menu('mock-disconnect');
  await expect(page.locator('.whale-companion')).toHaveAttribute('data-whale-state','disconnected');
  await expect(page.locator('.whale-swimmer')).toHaveCSS('animation-name','none');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output,'acceptance.json'), JSON.stringify({result:'PASS',checks:['capsule status remains accessible','drag preserves window size and does not expand','whale click expands','reduced and system motion preferences','empty session whale','settings signature','disconnected whale stops swimming'],native,rendererErrors:errors},null,2));
  console.log('Whale elements acceptance: PASS');
} finally { await f.app.close(); }
