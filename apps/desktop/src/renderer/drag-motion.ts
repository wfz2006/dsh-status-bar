export type Point = { x: number; y: number };
type Sample = Point & { time: number };
export type DragPaint = { phase: 'pressed' | 'moving' | 'settling'; x: number; y: number; energy: number } | null;
type DragEnvironment = {
  now(): number;
  position(): Point;
  move(point: Point): Promise<unknown>;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  animated(): boolean;
  paint(value: DragPaint): void;
};

// An analytic spring keeps the landing identical at 60/120 Hz and after a
// dropped frame. Its maximum excursion is fourteen DIP, never a free throw.
export const DRAG_RELEASE_MS = 560;
export function releaseOffset(velocity: Point, elapsed: number): Point {
  if (elapsed <= 0 || elapsed >= DRAG_RELEASE_MS) return { x: 0, y: 0 };
  const speed = Math.hypot(velocity.x, velocity.y);
  const gain = Math.min(1.7, .65 / (speed || 1));
  const spring = Math.exp(-.014 * elapsed) * Math.sin(.020 * elapsed) / .020;
  return { x: velocity.x * gain * spring, y: velocity.y * gain * spring };
}

export function recentVelocity(velocity: Point, age: number): Point {
  const decay = Math.exp(-Math.max(0, age - 16) / 36);
  return { x: velocity.x * decay, y: velocity.y * decay };
}

/** Imperative pointer/motion state: no React renders or timers while idle. */
export function createDragMotion(env: DragEnvironment) {
  let gesture: { id: number; origin: Point; start: Sample; last: Sample; velocity: Point; moved: boolean } | null = null;
  let landing: { anchor: Point; velocity: Point; time: number } | null = null;
  let pending: Point | null = null;
  let busy = false;
  let frame: number | null = null;
  let lastFrame = 0;
  let lastNativeFrame = 0;
  let visual = { x: 0, y: 0 };

  async function flush() {
    if (busy) return;
    busy = true;
    try {
      while (pending) {
        const next = pending; pending = null;
        await env.move(next);
      }
    } catch { pending = null; }
    finally { busy = false; }
  }
  function move(point: Point) { pending = point; void flush(); }
  function wake() { if (frame === null) frame = env.requestFrame(tick); }
  function resetPaint() { visual = { x: 0, y: 0 }; env.paint(null); }
  function cancel() {
    if (frame !== null) env.cancelFrame(frame);
    frame = null; pending = null; gesture = null; landing = null;
    resetPaint();
  }
  function tick(time: number) {
    frame = null;
    if (!env.animated()) {
      // Finish an interrupted release at its intended drop position, but do
      // not stop an ordinary drag when the user disables animation.
      if (landing) move(landing.anchor);
      landing = null; resetPaint(); return;
    }
    const dt = Math.min(48, Math.max(1, time - lastFrame)); lastFrame = time;
    const velocity = gesture ? recentVelocity(gesture.velocity, time - gesture.last.time) : { x: 0, y: 0 };
    const target = { x: Math.max(-4.8, Math.min(4.8, -velocity.x * 9)), y: Math.max(-2.6, Math.min(2.6, -velocity.y * 6)) };
    const blend = 1 - Math.exp(-dt / 32);
    visual.x += (target.x - visual.x) * blend;
    visual.y += (target.y - visual.y) * blend;
    if (landing) {
      const age = time - landing.time;
      const offset = releaseOffset(landing.velocity, age);
      if (age >= DRAG_RELEASE_MS) { move(landing.anchor); landing = null; resetPaint(); return; }
      if (time - lastNativeFrame >= 16) {
        lastNativeFrame = time;
        move({ x: landing.anchor.x + offset.x, y: landing.anchor.y + offset.y });
      }
      visual = { x: -offset.x * .34, y: -offset.y * .19 };
    }
    env.paint({ phase: landing ? 'settling' : 'moving', ...visual, energy: Math.min(1, Math.hypot(visual.x, visual.y) / 3) });
    if (landing || Math.hypot(visual.x, visual.y, velocity.x, velocity.y) > .015) wake();
  }
  return {
    begin(id: number, point: Point) {
      if (gesture) return false;
      cancel();
      const time = env.now();
      lastFrame = time;
      gesture = { id, origin: env.position(), start: { ...point, time }, last: { ...point, time }, velocity: { x: 0, y: 0 }, moved: false };
      if (env.animated()) env.paint({ phase: 'pressed', x: 0, y: 0, energy: 0 });
      return true;
    },
    update(id: number, point: Point) {
      const g = gesture;
      if (!g || g.id !== id) return false;
      const time = env.now();
      const dx = point.x - g.start.x, dy = point.y - g.start.y;
      if (Math.hypot(dx, dy) >= 6) g.moved = true;
      const dt = time - g.last.time;
      if (dt > 0) {
        const weight = 1 - Math.exp(-dt / 24);
        g.velocity.x += ((point.x - g.last.x) / Math.max(8, dt) - g.velocity.x) * weight;
        g.velocity.y += ((point.y - g.last.y) / Math.max(8, dt) - g.velocity.y) * weight;
      }
      g.last = { ...point, time };
      if (g.moved) {
        move({ x: g.origin.x + dx, y: g.origin.y + dy });
        if (env.animated()) wake();
      }
      return g.moved;
    },
    end(id: number) {
      const g = gesture;
      if (!g || g.id !== id) return;
      gesture = null;
      const velocity = recentVelocity(g.velocity, env.now() - g.last.time);
      if (g.moved && env.animated() && Math.hypot(velocity.x, velocity.y) > .08) {
        landing = { anchor: { x: g.origin.x + g.last.x - g.start.x, y: g.origin.y + g.last.y - g.start.y }, velocity, time: env.now() };
        lastNativeFrame = 0; wake();
      } else {
        if (frame !== null) env.cancelFrame(frame);
        frame = null; resetPaint();
      }
    },
    owns(id: number) { return gesture?.id === id; },
    finish() { const anchor = landing?.anchor; cancel(); if (anchor) move(anchor); },
    cancel,
  };
}
