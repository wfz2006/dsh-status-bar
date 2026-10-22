// Capture a real refraction A/B: the same owned window over the same real
// window-behind stripes, once with zero displacement and once with the
// live desktop optics enabled. Both frames come from native screen capture.
import { fixture } from './native-fixture.mjs';
import { mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const out = process.env.GLASS_UI_REPORT ?? 'reports/intro-shots';
await mkdir(out, { recursive: true });
const f = await fixture();
try {
  await f.page.evaluate(() => window.glass.setSettings({
    theme: 'light', animation: 'off', material: 'transparent', pin: 'always', tintOpacity: 0, tintColor: '#ffffff',
  }));
  await f.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).setPosition(200, 150), f.mainId);
  await f.backdrop('repeating-linear-gradient(90deg,#f4f4f4 0 10px,#141414 10px 13px,#f4f4f4 13px 36px)');
  await f.menu('view-peek');
  await f.page.evaluate(() => window.glass.setOpticsEnabled(true));
  await f.page.waitForTimeout(2000);

  await f.page.evaluate(() => document.querySelectorAll('#glass-defs feDisplacementMap').forEach((n) => {
    n.dataset.originalScale = n.getAttribute('scale');
    n.setAttribute('scale', '0');
  }));
  await f.page.waitForTimeout(400);
  await f.page.screenshot({ path: out + '/optics-zero.png' });

  await f.page.evaluate(() => document.querySelectorAll('#glass-defs feDisplacementMap').forEach((n) => n.setAttribute('scale', n.dataset.originalScale)));
  await f.page.waitForTimeout(800);
  await f.page.screenshot({ path: out + '/optics-on.png' });

  execFileSync('python', ['scripts/compose-optics-comparison.py', out, out + '/optics-comparison.png'], { stdio: 'inherit' });
  await copyFile(out + '/optics-comparison.png', 'docs/images/comparison.png');

  console.log('optics comparison frames written to', out);
} finally {
  await f.app.close();
}
