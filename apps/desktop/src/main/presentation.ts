import { systemPreferences, type BrowserWindow } from 'electron';
import { morphBounds, roundedRegion, type Bounds } from '../shared/window';
import type { WindowState } from '../shared/api';

export function createPresentation(win: BrowserWindow) {
  let material: WindowState['material'] = 'acrylic';
  let morphing: WindowState['morphing'] = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let target: Bounds | undefined;
  const state = (): WindowState => ({ pinned: !win.isDestroyed() && win.isAlwaysOnTop(), material, morphing });
  function publish() { if (!win.isDestroyed()) win.webContents.send('glass:window-update', state()); }
  function applyShape() {
    if (process.platform === 'win32' && !win.isDestroyed()) {
      const { width, height } = win.getBounds();
      win.setShape(roundedRegion(width, height));
    }
  }
  function applyMaterial() {
    try { win.setBackgroundMaterial(material === 'acrylic' ? 'acrylic' : 'none'); }
    catch { material = 'clear'; }
    win.setBackgroundColor(material === 'solid' ? '#172131' : '#00000000');
    applyShape(); publish();
  }
  function stop() { clearInterval(timer); timer = undefined; morphing = null; target = undefined; publish(); }
  function finish() { if (target && !win.isDestroyed()) win.setBounds(target); stop(); }
  function morphTo(bounds: Bounds, reducedMotion = false) {
    const start = win.getBounds(); stop(); target = bounds;
    if (reducedMotion || systemPreferences.getAnimationSettings().prefersReducedMotion) { finish(); return; }
    morphing = bounds.height > start.height ? 'expanding' : 'collapsing'; publish();
    const began = performance.now();
    timer = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(timer); return; }
      const t = Math.min(1, (performance.now() - began) / 420);
      win.setBounds(morphBounds(start, bounds, t));
      if (t === 1) finish();
    }, 16);
  }
  win.on('resize', applyShape);
  win.on('closed', () => clearInterval(timer));
  applyMaterial();
  return { state, publish, morphTo, stop, applyShape,
    cycleMaterial: () => { material = material === 'acrylic' ? 'clear' : material === 'clear' ? 'solid' : 'acrylic'; applyMaterial(); },
  };
}
