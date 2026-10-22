import { fixture } from './native-fixture.mjs';
import { mkdir, copyFile } from 'node:fs/promises';

const out = process.env.GLASS_UI_REPORT ?? 'reports/intro-shots';
const published = 'docs/images';
await mkdir(out, { recursive: true });
await mkdir(published, { recursive: true });
const f = await fixture();
try {
  await f.page.evaluate(() => window.glass.setSettings({ animation: 'off', theme: 'auto', pin: 'always' }));
  await f.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).setPosition(210, 150), f.mainId);

  await f.backdrop('#e9e5dd');
  await f.page.screenshot({ path: out + '/capsule.png' });
  await f.menu('view-peek');
  await f.page.screenshot({ path: out + '/peek.png' });
  await f.menu('view-expanded');
  await f.page.screenshot({ path: out + '/expanded.png' });

  await f.backdrop('#171c22');
  await f.menu('mock-approval-queue');
  await f.page.waitForTimeout(20000);
  await f.page.evaluate(async () => {
    const state = await window.glass.getState();
    if (!state.approvals?.length) throw new Error('no approvals in projection');
    await window.glass.selectSession(state.approvals[0].sessionId);
  });
  await f.menu('view-approval');
  await f.page.screenshot({ path: out + '/approval.png' });
  await f.menu('settings');
  await f.page.screenshot({ path: out + '/settings.png' });
  await f.page.evaluate(() => {
    const toggle = document.querySelector('input[aria-label="真实折射与色散"]');
    toggle?.scrollIntoView({ block: 'center' });
  });
  await f.page.waitForTimeout(400);
  await f.page.screenshot({ path: out + '/settings-optics.png' });

  for (const name of ['capsule', 'peek', 'expanded', 'approval', 'settings', 'settings-optics']) {
    await copyFile(out + '/' + name + '.png', published + '/' + name + '.png');
  }

  console.log('intro shots written to', out, 'and published to', published);
} finally {
  await f.app.close();
}
