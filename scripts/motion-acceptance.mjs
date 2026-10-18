import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

const output = resolve('reports/motion-upgrade');
const native = process.argv.includes('--native');
await mkdir(output, { recursive: true });
const f = await fixture();
const errors = [];
try {
  const { page, menu, backdrop, capture } = f;
  page.on('pageerror', error => errors.push(error.message));
  await menu('view-expanded');
  const tabs = page.locator('.task-tabs');
  await expect(tabs).toHaveAttribute('data-active', 'process');
  await expect(page.locator('.task-panel .process-list')).toBeVisible();
  const initial = await tabs.evaluate(element => getComputedStyle(element, '::before').transform);
  await page.getByRole('tab', { name: /步骤/ }).click();
  await expect(tabs).toHaveAttribute('data-active', 'steps');
  await expect(page.locator('.task-panel .todo-list')).toBeVisible();
  await page.waitForTimeout(420);
  const moved = await tabs.evaluate(element => getComputedStyle(element, '::before').transform);
  assert.notEqual(moved, initial, 'selection lens should move to the other tab');
  await page.screenshot({ path: resolve(output, 'expanded-steps.png') });
  if (native) { await backdrop(); await capture(resolve(output, 'native-expanded-steps.png')); }

  const picker = page.getByRole('button', { name: /选择会话/ });
  await picker.click();
  await expect(page.locator('.session-picker')).toHaveAttribute('data-open', 'true');
  await expect(page.getByRole('listbox', { name: '选择会话' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.session-picker')).toHaveAttribute('data-open', 'false');
  await expect(page.locator('main')).toHaveAttribute('data-mode', 'expanded');
  await page.waitForTimeout(300);
  await expect(page.getByRole('listbox', { name: '选择会话' })).toBeHidden();

  await page.evaluate(() => window.glass.setSettings({ animation: 'off' }));
  await expect(page.locator('main')).toHaveAttribute('data-animation', 'off');
  const disabledMotion = await tabs.evaluate(element => getComputedStyle(element, '::before').transitionDuration);
  assert.equal(disabledMotion, '0s');
  await page.getByRole('tab', { name: '过程' }).click();
  await expect(page.locator('.task-panel .process-list')).toBeVisible();

  await page.evaluate(() => window.glass.setSettings({ animation: 'full' }));
  await page.emulateMedia({ reducedMotion:'reduce' });
  const systemMotion = await tabs.evaluate(element => getComputedStyle(element, '::before').transitionDuration);
  assert.equal(systemMotion, '0s');
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await menu('view-approval');
  await expect(page.getByRole('button', { name: '允许一次', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '拒绝', exact: true })).toBeDisabled();
  await page.screenshot({ path: resolve(output, 'approval.png') });
  if (native) await capture(resolve(output, 'native-approval.png'));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ result:'PASS', checks:['tab lens and content swap','picker open and Escape without window collapse','animation off','system reduced motion','read-only approval remains disabled'], nativeCapture: native, rendererErrors:errors }, null, 2));
  console.log('Motion acceptance: PASS');
} finally { await f.app.close(); }
