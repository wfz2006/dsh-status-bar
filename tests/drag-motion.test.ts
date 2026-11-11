import { expect, it } from 'vitest';
import { createDragMotion, releaseOffset, windowDragProfile, type DragPaint, type Point } from '../apps/desktop/src/renderer/drag-motion';

function fixture(animated: boolean | 'peek' | 'pool' = true, transport?: (p: Point) => Promise<unknown>, release?: (p: Point) => Promise<unknown>, allowNativeSpring?: (p: Point) => boolean) {
  let time = 0, id = 0, position = { x: 100, y: 100 };
  const frames = new Map<number, (time: number) => void>();
  const moves: Point[] = [], paints: DragPaint[] = [];
  const motion = createDragMotion({
    now: () => time, position: () => position,
    profile: () => typeof animated === 'string' ? animated : animated ? 'capsule' : null,
    requestFrame: cb => { frames.set(++id, cb); return id; }, cancelFrame: id => { frames.delete(id); },
    paint: p => { paints.push(p); },
    move: async p => { moves.push(p); if (transport) await transport(p); position = p; },
    release, allowNativeSpring,
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

it('commits the pointer-up position immediately for an eligible edge drop', async () => {
  const releases: Point[] = [];
  const f = fixture(true, undefined, async point => { releases.push(point); }, point => point.x !== 0);
  f.motion.begin(1, { x: 150, y: 120 });
  await f.advance(16);
  f.motion.update(1, { x: 85, y: 120 });
  await f.advance(16);
  f.motion.end(1, { x: 50, y: 120 });
  expect(releases).toEqual([{ x: 0, y: 100 }]);
  expect(f.frames.size).toBe(0);
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

it('selects distinct drag feedback for classic peek and both whale pool states', () => {
  const peek = { mode: 'peek', appearance: 'classic', panel: 'none', morph: 'idle', animation: 'full' };
  expect(windowDragProfile(peek, false)).toBe('peek');
  const pool = { ...peek, appearance: 'whale-pool' };
  expect(windowDragProfile(pool, false)).toBe('pool');
  expect(windowDragProfile({ ...pool, mode: 'capsule' }, false)).toBe('pool');
  for (const change of [
    { mode: 'expanded' }, { panel: 'settings' },
    { morph: 'expanding' }, { dockEdge: 'left' }, { animation: 'reduced' }, { animation: 'off' },
  ]) for (const surface of [peek, pool]) expect(windowDragProfile({ ...surface, ...change }, false)).toBeNull();
  expect(windowDragProfile(peek, true)).toBeNull();
  expect(windowDragProfile(pool, true)).toBeNull();
});

it('moves peek one-to-one while held and settles promptly after a short release', async () => {
  const f = fixture('peek');
  await f.drag();
  expect(f.moves.at(-1)).toEqual({ x: 160, y: 100 });
  expect(f.paints.some(v => v?.phase === 'moving' && v.energy > .5)).toBe(true);
  f.motion.end(1);
  for (let t = 0; t < 360; t += 16) await f.advance(16);
  expect(Math.max(...f.moves.map(p => p.x - 160))).toBeGreaterThan(3);
  expect(Math.max(...f.moves.map(p => p.x - 160))).toBeLessThanOrEqual(8);
  expect(f.moves.at(-1)).toEqual({ x: 160, y: 100 });
  expect(f.paints.at(-1)).toBeNull();
  expect(f.frames.size).toBe(0);
});

it('feeds the pool on a quick drag and commits the native drop without rebound', async () => {
  const releases: Point[] = [];
  const f = fixture('pool', undefined, async point => { releases.push(point); });
  f.motion.begin(1, { x: 150, y: 120 });
  await f.advance(16);
  f.motion.update(1, { x: 165, y: 130 });
  expect(f.paints.at(-1)).toMatchObject({ phase: 'moving', x: expect.any(Number), y: expect.any(Number) });
  expect(f.paints.at(-1)!.x).toBeLessThan(0);
  f.motion.end(1, { x: 165, y: 130 });
  await f.advance(0);
  expect(f.paints.at(-1)).toBeNull();
  expect(releases).toEqual([{ x: 115, y: 110 }]);
  expect(f.frames.size).toBe(0);
});

it('keeps the pool drop queued through an immediate click and waits for the native move', async () => {
  const acknowledgements: (() => void)[] = [];
  const releases: Point[] = [];
  const f = fixture('pool', () => new Promise<void>(done => acknowledgements.push(done)), point => {
    releases.push(point);
    return new Promise<void>(done => acknowledgements.push(done));
  });
  await f.drag();
  f.motion.end(1, { x: 216, y: 120 });
  f.motion.begin(2, { x: 216, y: 120 });
  f.motion.end(2);
  let settled = false;
  const ready = f.motion.whenSettled()?.then(() => { settled = true; });
  expect(ready).toBeDefined();
  expect(releases).toEqual([]);
  acknowledgements.shift()!();
  await f.advance(0);
  expect(releases).toEqual([{ x: 166, y: 100 }]);
  expect(settled).toBe(false);
  acknowledgements.shift()!();
  await ready;
  expect(settled).toBe(true);
  expect(f.frames.size).toBe(0);
});
