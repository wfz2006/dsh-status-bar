import { expect, it } from 'vitest';
import { PoolDragMotion } from '../apps/desktop/src/renderer/pool-drag-motion';

it('moves water against the drag, crosses rest after release, and settles', () => {
  const motion = new PoolDragMotion();
  motion.set({ phase: 'moving', x: -.8, y: .5, energy: .3 }, 0);
  for (let time = 16; time <= 320; time += 16) motion.sample(time);
  const held = motion.sample(320);
  expect(held.sloshX).toBeLessThan(-.25);
  expect(held.sloshY).toBeGreaterThan(.22);

  motion.set(null, 320);
  const release = [];
  for (let time = 336; time <= 2400; time += 16) release.push(motion.sample(time));
  expect(release[0]!.rippleStrength).toBeGreaterThan(.2);
  expect(Math.max(...release.map(frame => frame.sloshX))).toBeGreaterThan(.05);
  expect(Math.min(...release.map(frame => frame.sloshY))).toBeLessThan(-.04);
  expect(release.at(-1)).toMatchObject({ sloshX: 0, sloshY: 0, energy: 0, rippleStrength: 0 });
});

it('retains momentum when the moving and release events arrive between render frames', () => {
  const motion = new PoolDragMotion();
  motion.sample(0);
  motion.set({ phase: 'moving', x: -4.8, y: 0, energy: 1 }, 1);
  motion.set(null, 18);
  const next = motion.sample(30);
  expect(next.sloshX).toBeLessThan(-.02);
  expect(next.rippleStrength).toBe(1);
});

it('bounds fast drag motion and clears it immediately on reset', () => {
  const motion = new PoolDragMotion();
  motion.set({ phase: 'moving', x: -90, y: 90, energy: 90 }, 0);
  for (let time = 16; time <= 320; time += 16) {
    const frame = motion.sample(time);
    expect(Math.abs(frame.sloshX)).toBeLessThanOrEqual(1.15);
    expect(Math.abs(frame.sloshY)).toBeLessThanOrEqual(1.15);
    expect(frame.energy).toBeLessThanOrEqual(.78);
  }
  motion.set(null, 320);
  motion.reset();
  expect(motion.sample(350)).toMatchObject({ sloshX: 0, sloshY: 0, energy: 0, rippleStrength: 0 });
});
