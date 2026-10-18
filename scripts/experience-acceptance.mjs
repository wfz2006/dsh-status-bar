import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

const output = resolve('reports/experience-upgrade');
await mkdir(output, { recursive:true });
const f = await fixture();
const errors = [];
try {
  const { page, menu } = f;
  page.on('pageerror', error => errors.push(error.message));
  async function preview(name) {
    // A controlled backing makes transparent renderer content inspectable.
    const dark = await page.locator('main').getAttribute('data-theme') === 'dark';
    const backing = await page.addStyleTag({content:'html {background:'+(dark ? 'linear-gradient(125deg,#101d33,#253c4b)' : 'linear-gradient(125deg,#e4edff,#f2f4ee)')+'!important;}'});
    await page.screenshot({path:resolve(output,name+'.png'),animations:'disabled'});
    await backing.evaluate(element => element.remove());
  }
  await expect(page.locator('.capsule-metrics')).toHaveText('3轮 · 42步');
  await expect(page.locator('.task-capsule .step-count')).toContainText('任务');
  await preview('capsule');
  await menu('view-expanded');
  const picker = page.getByRole('button', {name:/选择会话/});
  await expect(picker).toContainText('构建 DSH Glass 悬浮伴侣');
  await picker.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option',{name:/构建 DSH Glass/})).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option',{name:/视觉探索/})).toBeFocused();
  await expect(page.locator('.task-heading h1')).toHaveText('构建 DSH Glass 悬浮伴侣');
  await page.keyboard.press('Enter');
  await expect(page.locator('.task-heading h1')).toHaveText('视觉探索');
  await expect(picker).toBeFocused();
  await expect(page.locator('.task-metrics .usage-speed')).toHaveText('上次 154 tok/s');
  await expect(page.locator('.task-metrics')).toContainText('执行 11 次');
  await preview('idle');

  await picker.press('ArrowUp');
  await page.keyboard.press('Home');
  await expect(page.getByRole('option',{name:/构建 DSH Glass/})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).toBeFocused();
  await expect(page.locator('main')).toHaveAttribute('data-mode','expanded');
  await expect(page.locator('.task-heading h1')).toHaveText('视觉探索');
  await picker.press('ArrowDown');
  await expect(page.getByRole('option',{name:/视觉探索/})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(picker).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('tab',{name:'过程'})).toBeFocused();

  await menu('mock-disconnect');
  await expect(page.locator('.task-metrics .usage-speed')).toHaveCount(0);
  await expect(page.locator('.task-metrics')).toContainText('离线快照');
  await preview('offline');
  await menu('reconnect');
  await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).connection).toBe('connected');
  await picker.focus(); await picker.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(page.locator('.task-heading h1')).toHaveText('构建 DSH Glass 悬浮伴侣');
  await menu('view-approval');
  await expect(page.locator('.readonly-label')).toBeVisible({timeout:15000});
  await expect(page.getByRole('button',{name:'允许一次',exact:true})).toBeDisabled();
  const size = await page.evaluate(() => ({width:innerWidth,height:innerHeight}));
  assert.ok(Math.abs(size.width - 400) <= 1 && Math.abs(size.height - 300) <= 1,'compact approval size allows 1 DIP native scale rounding');
  await preview('approval');

  await menu('mock-edge-cases'); await menu('view-expanded');
  await page.evaluate(() => window.glass.resizeWindow({x:250,y:150,width:360,height:360}));
  const overflow = await page.locator('.glass').evaluate(element => element.scrollWidth > element.clientWidth);
  assert.equal(overflow,false,'long names must not push the narrow window wider');
  await preview('narrow-long-title');
  await page.evaluate(() => window.glass.setSettings({theme:'dark',animation:'reduced'}));
  await preview('dark');
  assert.deepEqual(errors,[]);
  await rm(resolve(output,'failure.json'),{force:true});
  await writeFile(resolve(output,'acceptance.json'),JSON.stringify({result:'PASS',checks:['capsule hierarchy','keyboard opens at selection and navigates Home/End without premature selection','Enter commits and restores trigger focus','Escape cancels without collapsing window','Tab leaves the menu without a focus trap','idle speed labelled historical','offline speed hidden and snapshot marked','readonly approval remains disabled','compact default approval size','360 DIP long-title layout'],rendererErrors:errors,preview:'controlled renderer background; not native optics'},null,2));
  console.log('Experience acceptance: PASS');
} catch (error) {
  await pageFailure();
  throw error;
} finally { await f.app.close(); }

async function pageFailure() {
  await writeFile(resolve(output,'failure.json'),JSON.stringify(await f.page.evaluate(async () => ({text:document.body.innerText,window:await window.glass.getWindowState(),source:await window.glass.getState()})),null,2));
}
