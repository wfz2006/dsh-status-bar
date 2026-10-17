import { expect, it } from 'vitest';
import { clampBounds, density } from '../apps/desktop/src/shared/window';
it('restores a window into a smaller or replaced work area', () => {
  expect(clampBounds({ x: 2500, y: -800, width: 900, height: 900 }, { x: 0, y: 0, width: 800, height: 600 })).toEqual({ x: 0, y: 0, width: 800, height: 600 });
});
it('uses both dimensions so a wide short window stays compact', () => {
  expect(density(180, 54)).toBe('capsule');
  expect(density(280, 140)).toBe('compact');
  expect(density(520, 90)).toBe('compact');
  expect(density(420, 480)).toBe('workspace');
});
