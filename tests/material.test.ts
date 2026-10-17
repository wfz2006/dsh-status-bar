import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

function map(width: number, height: number) {
  const source = readFileSync('apps/desktop/src/renderer/vendor/edge-liquid-glass.js', 'utf8');
  let pixels = { width: 0, height: 0, data: new Uint8ClampedArray() };
  const context = vm.createContext({ document: { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: (image: typeof pixels) => { pixels = image; } }), toDataURL: () => 'data:image/png,test' }) } });
  vm.runInContext(source.slice(source.indexOf('  function ss('), source.indexOf('  /* ---------------- SVG')), context);
  context.dispMap(width, height, 18, 16, 10);
  return pixels;
}
it('retains the reference lens interior, stationary center and bounded sampling', () => {
  const image = map(120, 104);
  function delta(x: number, y: number) { const i = (y * image.width + x) * 4; return { x: (image.data[i]! / 255 - .5) * 20, y: (image.data[i + 1]! / 255 - .5) * 20 }; }
  expect(delta(30, 52).x).toBeGreaterThan(3); expect(delta(90, 52).x).toBeLessThan(-3);
  expect(Math.abs(delta(60, 52).x)).toBeLessThan(.2);
  expect(Math.abs(delta(60, 52).y)).toBeLessThan(.2);
  for (let y = 0; y < 104; y++) for (let x = 0; x < 120; x++) {
    const d = delta(x, y);
    expect(x + .5 + d.x).toBeGreaterThanOrEqual(0); expect(x + .5 + d.x).toBeLessThanOrEqual(120);
    expect(y + .5 + d.y).toBeGreaterThanOrEqual(0); expect(y + .5 + d.y).toBeLessThanOrEqual(104);
  }
});
it('caps the reference displacement map resolution for large desktop views', () => {
  const image = map(900, 1000);
  expect(image.width).toBe(216); expect(image.height).toBe(240);
});
