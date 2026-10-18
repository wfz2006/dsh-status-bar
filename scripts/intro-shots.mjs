import { fixture } from './native-fixture.mjs';
import { mkdir } from 'node:fs/promises';

const out = process.env.GLASS_UI_REPORT ?? 'reports/intro-shots';
await mkdir(out, { recursive: true });
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

  console.log('intro shots written to', out);
} finally {
  await f.app.close();
}
