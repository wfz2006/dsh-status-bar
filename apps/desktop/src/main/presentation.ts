import { nativeTheme, systemPreferences, type BrowserWindow } from 'electron';
import { morphBounds, roundedRegion, type Bounds } from '../shared/window';
import { orbRegion } from '../shared/edge-dock';
import type { PresentationState } from '../shared/api';

export function createPresentation(win: BrowserWindow, changed: () => void) {
  let material: PresentationState['material'] = 'acrylic';
  let morphing: PresentationState['morphing'] = null;
  let orb = false;
  let edgeSurface = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let target: Bounds | undefined;
  const state = (): PresentationState => ({ material, morphing });
  function publish() { if (!win.isDestroyed()) changed(); }
  function applyShape() {
    if (!edgeSurface && (process.platform === 'win32' || orb && process.platform === 'linux') && !win.isDestroyed()) {
      const { width, height } = win.getBounds();
      win.setShape(orb ? orbRegion(width, height) : roundedRegion(width, height, material === 'clear' || material === 'frosted' ? 1.25 : 0));
    }
  }
  function applyBackground() {
    win.setBackgroundColor(!edgeSurface && material === 'solid' ? nativeTheme.shouldUseDarkColors ? '#292929' : '#f0f0f0' : '#00000000');
  }
  function applyMaterial() {
    try { win.setBackgroundMaterial(material === 'acrylic' ? 'acrylic' : 'none'); }
    catch { if (material === 'acrylic') material = 'clear'; }
    applyBackground();
    applyShape(); publish();
  }
  function stop(notify = true) { clearInterval(timer); timer = undefined; morphing = null; target = undefined; if (notify) publish(); }
  function finish() { if (target && !win.isDestroyed()) win.setBounds(target); stop(); }
  function morphTo(bounds: Bounds, reducedMotion = false, duration = 320) {
    const start = win.getBounds(); stop(false); target = bounds;
    if (reducedMotion || systemPreferences.getAnimationSettings().prefersReducedMotion) { finish(); return; }
    morphing = bounds.height > start.height ? 'expanding' : 'collapsing'; publish();
    const delay = morphing === 'collapsing' ? 80 : 0;
    const began = performance.now() + delay;
    timer = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(timer); return; }
      const t = Math.max(0, Math.min(1, (performance.now() - began) / duration));
      win.setBounds(morphBounds(start, bounds, t));
      if (t === 1) finish();
    }, 16);
  }
  win.on('resize', applyShape);
  win.on('closed', () => clearInterval(timer));
  return { state, publish, morphTo, stop, applyShape,
    setEdgeSurface: (value: boolean) => {
      edgeSurface = value;
      applyBackground();
      if (value && (process.platform === 'win32' || process.platform === 'linux')) win.setShape([]);
      else applyShape();
    },
    setOrb: (value: boolean) => {
      orb = value;
      if (!orb && process.platform === 'linux' && !win.isDestroyed()) win.setShape([]);
      else applyShape();
    },
    setMaterial: (value: PresentationState['material']) => { material = value; applyMaterial(); },
  };
}
