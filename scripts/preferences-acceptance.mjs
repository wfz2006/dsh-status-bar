import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const executablePath = createRequire(resolve('apps/desktop/package.json'))('electron');
const profile = await mkdtemp(join(tmpdir(), 'dsh-glass-preferences-'));
const path = join(profile, 'glass-ui.json');
const env = { ...process.env, GLASS_USER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.GLASS_SMOKE;
await writeFile(path, JSON.stringify({ settings: { defaultView: 'remember-last', autoApproval: true, theme: 'dark' }, mode: 'expanded', manual: true, bounds: { x: 120, y: 100, width: 500, height: 420 } }));
let expected = { width: 500, height: 420 };
for (let launch = 0; launch < 2; launch++) {
  const app = await electron.launch({ executablePath, args: [resolve('apps/desktop')], env });
  try {
    const page = await app.firstWindow();
    await page.locator('main').waitFor();
    const state = await page.evaluate(() => window.glass.getWindowState());
    assert.equal(state.manualSize, true); assert.equal(state.viewMode, 'expanded'); assert.equal(state.settings.theme, 'dark');
    await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).approvals.length, { timeout: 12000 }).toBe(1);
    const afterApproval=await page.evaluate(() => window.glass.getWindowState());
    assert.equal(afterApproval.viewMode, 'expanded',JSON.stringify({launch,initial:state,afterApproval}));
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    assert.equal(bounds.width, expected.width); assert.equal(bounds.height, expected.height);
    if (launch === 0) {
      expected = { width: 480, height: 390 };
      await page.evaluate(() => window.glass.resizeWindow({ x: 130, y: 110, width: 480, height: 390 }));
      await page.evaluate(() => window.glass.setSettings({ strength: 'readable' }));
      await page.evaluate(() => window.glass.setSettings({tintColor:'#4090e0',tintOpacity:27,brightness:125}));
      await expect.poll(async () => JSON.parse(await readFile(path, 'utf8')).bounds.width).toBe(480);
      assert.equal(JSON.parse(await readFile(path, 'utf8')).manual, true);
    } else {assert.equal(state.settings.strength, 'readable');assert.deepEqual({tintColor:state.settings.tintColor,tintOpacity:state.settings.tintOpacity,brightness:state.settings.brightness},{tintColor:'#4090e0',tintOpacity:27,brightness:125});assert.equal((await page.evaluate(()=>window.glass.getOpticsState())).enabled,false);}
  } finally { await app.close(); }
}
await writeFile(resolve('docs/evidence/redesign/preferences-acceptance.json'), JSON.stringify({ result: 'PASS', launches: 2, scope: 'Isolated profile: theme/strength/manual bounds survive restart and pending snapshot does not replace custom geometry' }, null, 2));
console.log('Preferences and manual-size protection across two actual Electron launches: PASS');
