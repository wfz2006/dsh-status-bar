import { expect, it } from 'vitest';
import { createDragMotion, releaseOffset, type DragPaint, type Point } from '../apps/desktop/src/renderer/drag-motion';

function fixture(animated = true, transport?: (p: Point) => Promise<unknown>, release?: (p: Point) => Promise<unknown>) {
  let time = 0, id = 0, position = { x: 100, y: 100 };
  const frames = new Map<number, (time: number) => void>();
  const moves: Point[] = [], paints: DragPaint[] = [];
  const motion = createDragMotion({
    now: () => time, position: () => position, animated: () => animated,
    requestFrame: cb => { frames.set(++id, cb); return id; }, cancelFrame: id => { frames.delete(id); },
    paint: p => { paints.push(p); },
    move: async p => { moves.push(p); if (transport) await transport(p); position = p; },
    release,
  });
  async function advance(ms: number) {
    time += ms;
    const batch = [...frames.values()]; frames.clear();
    batch.forEach(cb => cb(time));
    await Promise.resolve(); await Promise.resolve();
  }
  async function drag() {
    motion.begin(1, { x: 150, y: 120 });
    for (let i = 1; i <= 6; i++) { await advance(16); motion.update(1, { x: 150 + i * 10, y: 120 }); }
    await advance(1);
  }
  return { motion, moves, paints, frames, advance, drag, disable: () => { animated = false; } };
}

it('bounds a fast release in every direction and lands exactly at rest independent of frame rate', () => {
  for (let t = 0; t <= 650; t++) {
    const p = releaseOffset({ x: 100, y: -100 }, t);
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(14);
  }
  expect(releaseOffset({ x: 1, y: 0 }, 560)).toEqual({ x: 0, y: 0 });
});

it('keeps held movement one-to-one, rejects other pointers, and never moves on a plain click', async () => {
  const f = fixture();
  f.motion.begin(7, { x: 20, y: 20 });
  expect(f.motion.begin(8, { x: 50, y: 50 })).toBe(false);
  expect(f.motion.update(8, { x: 100, y: 100 })).toBe(false);
  expect(f.motion.update(7, { x: 23, y: 20 })).toBe(false);
  f.motion.end(7); await f.advance(500);
  expect(f.moves).toEqual([]); expect(f.frames.size).toBe(0);
  await f.drag();
  expect(f.moves.at(-1)).toEqual({ x: 160, y: 100 });
  expect(f.paints.some(v => v?.phase === 'moving' && v.x < 0)).toBe(true);
});

it('adds a small release overshoot then restores the exact drop anchor and stops scheduling', async () => {
  for (const interval of [8, 16, 33]) {
    const f = fixture(); await f.drag(); f.motion.end(1);
    for (let t = 0; t < 640; t += interval) await f.advance(interval);
    expect(f.moves.some(p => p.x > 162)).toBe(true);
    expect(f.moves.at(-1)).toEqual({ x: 160, y: 100 });
    expect(f.paints.at(-1)).toBe(null); expect(f.frames.size).toBe(0);
  }
});

it('does not fling after pausing before release or with animation disabled', async () => {
  const f = fixture(); await f.drag(); await f.advance(240); f.motion.end(1);
  const count = f.moves.length; await f.advance(500);
  expect(f.moves.length).toBe(count); expect(f.frames.size).toBe(0);
  const still = fixture(false); await still.drag(); still.motion.end(1); await still.advance(500);
  expect(still.moves.at(-1)).toEqual({ x: 160, y: 100 }); expect(still.paints.filter(Boolean)).toEqual([]);
});

it('allows re-grabbing the current location and cancels the old spring without snapping back', async () => {
  const f = fixture(); await f.drag(); f.motion.end(1); await f.advance(40);
  const current = f.moves.at(-1)!;
  f.motion.begin(2, { x: 220, y: 120 }); await f.advance(16);
  f.motion.update(2, { x: 230, y: 120 }); await f.advance(1);
  expect(f.moves.at(-1)).toEqual({ x: current.x + 10, y: current.y });
  f.motion.cancel(); const count = f.moves.length; await f.advance(500);
  expect(f.moves.length).toBe(count); expect(f.frames.size).toBe(0);
});

it('coalesces a slow native transport and discards pending movement on cancellation', async () => {
  let resolve: (() => void) | undefined;
  const f = fixture(true, () => new Promise<void>(done => { resolve = done; }));
  await f.drag(); expect(f.moves.length).toBe(1);
  f.motion.cancel(); resolve!(); await f.advance(500);
  expect(f.moves.length).toBe(1); expect(f.frames.size).toBe(0);
});

it('finishes an in-progress spring when reduced motion is requested', async () => {
  const f = fixture(); await f.drag(); f.motion.end(1); await f.advance(32);
  f.disable(); await f.advance(16);
  expect(f.moves.at(-1)).toEqual({ x: 160, y: 100 });
  expect(f.frames.size).toBe(0); expect(f.paints.at(-1)).toBe(null);
});

it('delivers a single committed release after pending movement settles, even without animation', async () => {
  const releases: Point[] = [];
  const acknowledgements: (() => void)[] = [];
  const f = fixture(false, () => new Promise<void>(resolve => acknowledgements.push(resolve)),
    async point => { releases.push(point); });
  await f.drag();
  f.motion.end(1);
  expect(releases).toEqual([]);
  acknowledgements.shift()!();
  await f.advance(1);
  expect(releases).toEqual([{ x: 160, y: 100 }]);
  f.motion.begin(2, { x: 150, y: 120 });
  f.motion.end(2);
  expect(releases).toHaveLength(1);
});

it('flushes only the newest queued target when the native transport catches up', async () => {
  const acknowledgements: (() => void)[] = [];
  const f = fixture(false, () => new Promise<void>(done => { acknowledgements.push(done); }));
  await f.drag(); expect(f.moves).toEqual([{ x: 110, y: 100 }]);
  acknowledgements.shift()!(); await f.advance(1);
  expect(f.moves).toEqual([{ x: 110, y: 100 }, { x: 160, y: 100 }]);
  acknowledgements.shift()!(); await f.advance(1); f.motion.end(1);
  expect(f.frames.size).toBe(0);
});

it('returns to the drop anchor when the motion preference changes during a release', async () => {
  const f = fixture(); await f.drag(); f.motion.end(1); await f.advance(40);
  expect(f.moves.at(-1)!.x).toBeGreaterThan(160);
  f.motion.finish(); await f.advance(1);
  expect(f.moves.at(-1)).toEqual({ x: 160, y: 100 }); expect(f.frames.size).toBe(0);
});

it('provides noticeable content feedback and release travel at a normal pointer speed', async () => {
  const f = fixture(); await f.drag();
  const moving = f.paints.filter((p): p is NonNullable<DragPaint> => p?.phase === 'moving');
  expect(Math.max(...moving.map(p => Math.abs(p.x)))).toBeGreaterThan(3.5);
  f.motion.end(1);
  for (let t = 0; t < 640; t += 16) await f.advance(16);
  expect(Math.max(...f.moves.map(p => p.x))).toBeGreaterThan(168);
  expect(f.moves.at(-1)).toEqual({ x: 160, y: 100 });
  expect(f.frames.size).toBe(0);
});
