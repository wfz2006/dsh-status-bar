import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture } from './native-fixture.mjs';

// This preview uses an isolated temporary userData directory and Mock data.
// It never installs the plugin or opens/changes the user's DSH Profile.
const f = await fixture();
await f.page.evaluate(() => window.glass.setSettings({ animation: 'full', sound: false, autoApproval: false, autoCollapse: false }));
await f.menu('view-capsule');
const preview = await f.app.evaluate(({ app, BrowserWindow, screen }, id) => {
  const win = BrowserWindow.fromId(id), area = screen.getPrimaryDisplay().workArea;
  const b = win.getBounds();
  win.setPosition(area.x + area.width - b.width - 60, area.y + 100);
  win.show(); win.focus(); win.moveTop();
  return { pid: process.pid, profile: app.getPath('userData'), bounds: win.getBounds(), source: 'Mock local drag experiment' };
}, f.mainId);
await mkdir(resolve('reports/drag-motion'), { recursive: true });
await writeFile(resolve('reports/drag-motion/preview.json'), JSON.stringify(preview, null, 2));
console.log(JSON.stringify({ ready: true, ...preview }));
await new Promise(resolve => f.app.once('close', resolve));
