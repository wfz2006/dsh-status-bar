import { expect, it } from 'vitest';
import { clampBounds, density, morphBounds, roundedRegion, resizeBounds, migrateBounds } from '../apps/desktop/src/shared/window';
it('restores a window into a smaller or replaced work area', () => {
  expect(clampBounds({ x: 2500, y: -800, width: 900, height: 900 }, { x: 0, y: 0, width: 800, height: 600 })).toEqual({ x: 0, y: 0, width: 800, height: 600 });
});
it('morphs actual bounds through intermediate sizes and lands exactly on target', () => {
  const start = { x: 1100, y: 80, width: 180, height: 54 };
  const end = { x: 940, y: 80, width: 340, height: 360 };
  expect(morphBounds(start, end, 0)).toEqual(start);
  expect(morphBounds(start, end, 1)).toEqual(end);
  const middle = morphBounds(start, end, 0.35);
  expect(middle.width).toBeGreaterThan(180); expect(middle.width).toBeLessThan(340);
  expect(middle.height).toBeGreaterThan(54); expect(middle.height).toBeLessThan(360);
  expect(middle.x + middle.width).toBe(1280);
});
it('clips the native backdrop outside the rounded surface, retaining center and resize edges', () => {
  const region = roundedRegion(180, 54);
  const contains = (x: number, y: number) => region.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  expect(contains(0, 0)).toBe(false); expect(contains(179, 53)).toBe(false);
  expect(contains(90, 0)).toBe(true); expect(contains(0, 27)).toBe(true);
  expect(contains(179, 27)).toBe(true); expect(contains(90, 53)).toBe(true);
});
it('keeps a short capsule slightly squarer while clamping tiny-window corners', () => {
  const capsule = roundedRegion(300, 56);
  // These edge pixels are inside the new corners, outside the previous 24/26px curves.
  expect(capsule.some(r => r.x === 0 && r.y <= 16 && r.y + r.height > 16)).toBe(true);
  const panel = roundedRegion(400, 340);
  expect(panel.some(r => r.x === 0 && r.y <= 18 && r.y + r.height > 18)).toBe(true);
  const tiny = roundedRegion(30, 20);
  expect(tiny.every(r => r.x >= 0 && r.y >= 0 && r.x + r.width <= 30 && r.y + r.height <= 20)).toBe(true);
});
it('custom resizing respects minimum size while anchoring the opposite edge', () => {
  expect(resizeBounds({ x: 500, y: 100, width: 340, height: 360 }, 'w', 300, 0)).toEqual({ x: 660, y: 100, width: 180, height: 360 });
  expect(resizeBounds({ x: 500, y: 100, width: 340, height: 360 }, 'se', 40, -500)).toEqual({ x: 500, y: 100, width: 380, height: 54 });
});
it('uses both dimensions so a wide short window stays compact', () => {
  expect(density(180, 54)).toBe('capsule');
  expect(density(280, 140)).toBe('compact');
  expect(density(520, 90)).toBe('compact');
  expect(density(420, 480)).toBe('workspace');
});
it('migrates legacy oversized preview geometry but preserves new user sizes', () => {
  const previous = { x: 200, y: 80, width: 420, height: 560 };
  expect(migrateBounds(previous, undefined)).toEqual({ x: 200, y: 80, width: 340, height: 300 });
  expect(migrateBounds(previous, 2)).toEqual(previous);
  expect(migrateBounds({ x: 200, y: 80, width: 180, height: 54 }, undefined)).toEqual({ x: 200, y: 80, width: 180, height: 54 });
});
