export type Point = { x: number; y: number };
type Sample = Point & { time: number };
type DragProfile = 'capsule' | 'peek' | 'pool';
export type DragPaint = { phase: 'pressed' | 'moving' | 'settling'; x: number; y: number; energy: number } | null;
type DragEnvironment = {
  now(): number;
  position(): Point;
  move(point: Point): Promise<unknown>;
  release?(point: Point): Promise<unknown>;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  profile(): DragProfile | null;
  allowNativeSpring?(anchor: Point): boolean;
  paint(value: DragPaint): void;
};

export const DRAG_RELEASE_MS = 560;
const DRAG_PROFILES = {
  capsule: { duration: DRAG_RELEASE_MS, travel: 1, feedback: 1 },
  peek: { duration: 340, travel: .55, feedback: .7 },
  pool: { duration: 0, travel: 0, feedback: 1 },
};

export function windowDragProfile(surface: DOMStringMap | undefined, reducedMotion: boolean): DragProfile | null {
  if (!surface || reducedMotion || surface.animation !== 'full' || surface.panel !== 'none'
    || surface.morph !== 'idle' || surface.dockEdge) return null;
  if (surface.mode !== 'capsule' && surface.mode !== 'peek') return null;
  if (surface.appearance === 'whale-pool') return 'pool';
  if (surface.mode === 'capsule') return 'capsule';
  return surface.appearance === 'classic' ? 'peek' : null;
}

// An analytic spring keeps the landing identical at 60/120 Hz and after a
// dropped frame. Its maximum excursion is fourteen DIP, never a free throw.
export function releaseOffset(velocity: Point, elapsed: number, profile: DragProfile = 'capsule'): Point {
  const { duration, travel } = DRAG_PROFILES[profile];
  if (elapsed <= 0 || elapsed >= duration) return { x: 0, y: 0 };
  const speed = Math.hypot(velocity.x, velocity.y);
  const gain = Math.min(1.7, .65 / (speed || 1)) * travel;
  const phase = elapsed * DRAG_RELEASE_MS / duration;
  const spring = Math.exp(-.014 * phase) * Math.sin(.020 * phase) / .020;
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
  let pending: { point: Point; released: boolean } | null = null;
  let activeMove: Promise<void> | undefined;
  let frame: number | null = null;
  let lastFrame = 0;
  let lastNativeFrame = 0;
  let visual = { x: 0, y: 0 };

  async function flush() {
    try {
      while (pending) {
        const next = pending; pending = null;
        if (next.released && env.release) await env.release(next.point);
        else await env.move(next.point);
      }
    } catch { pending = null; }
    finally { activeMove = undefined; }
  }
  function move(point: Point, released = false) {
    pending = { point, released };
    if (!activeMove) activeMove = flush();
  }
  function wake() { if (frame === null) frame = env.requestFrame(tick); }
  function resetPaint() { visual = { x: 0, y: 0 }; env.paint(null); }
  function cancel() {
    if (frame !== null) env.cancelFrame(frame);
    frame = null; pending = null; gesture = null; landing = null;
    resetPaint();
  }
  function tick(time: number) {
    frame = null;
    const profile = env.profile();
    if (!profile) {
      // Finish an interrupted release at its intended drop position, but do
      // not stop an ordinary drag when the user disables animation.
      if (landing) move(landing.anchor, true);
      landing = null; resetPaint(); return;
    }
    const { duration, feedback } = DRAG_PROFILES[profile];
    const dt = Math.min(48, Math.max(1, time - lastFrame)); lastFrame = time;
    const velocity = gesture ? recentVelocity(gesture.velocity, time - gesture.last.time) : { x: 0, y: 0 };
    const target = { x: Math.max(-4.8, Math.min(4.8, -velocity.x * 9)) * feedback,
      y: Math.max(-2.6, Math.min(2.6, -velocity.y * 6)) * feedback };
    const blend = 1 - Math.exp(-dt / 32);
    visual.x += (target.x - visual.x) * blend;
    visual.y += (target.y - visual.y) * blend;
    if (landing) {
      const age = time - landing.time;
      const offset = releaseOffset(landing.velocity, age, profile);
      if (age >= duration) { move(landing.anchor, true); landing = null; resetPaint(); return; }
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
    begin(id: number, point: Point, preserveDrop = env.profile() === 'pool') {
      if (gesture) return false;
      // The next click may arrive before the last native drag move is acknowledged.
      const drop = preserveDrop && pending?.released ? pending : null;
      cancel();
      pending = drop;
      const time = env.now();
      lastFrame = time;
      gesture = { id, origin: env.position(), start: { ...point, time }, last: { ...point, time }, velocity: { x: 0, y: 0 }, moved: false };
      if (env.profile()) env.paint({ phase: 'pressed', x: 0, y: 0, energy: 0 });
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
        const profile = env.profile();
        // Feed the first water impulse even if pointerup comes before a frame.
        if (profile === 'pool' && frame === null) tick(time);
        else if (profile) wake();
      }
      return g.moved;
    },
    end(id: number, point?: Point) {
      const g = gesture;
      if (!g || g.id !== id) return;
      gesture = null;
      const velocity = recentVelocity(g.velocity, env.now() - g.last.time);
      const end = point ?? g.last;
      const anchor = { x: g.origin.x + end.x - g.start.x, y: g.origin.y + end.y - g.start.y };
      const profile = env.profile();
      if (g.moved && profile && DRAG_PROFILES[profile].travel > 0 && env.allowNativeSpring?.(anchor) !== false && Math.hypot(velocity.x, velocity.y) > .08) {
        landing = { anchor, velocity, time: env.now() };
        lastNativeFrame = 0; wake();
      } else {
        if (frame !== null) env.cancelFrame(frame);
        frame = null; resetPaint();
        if (g.moved && env.release) move(anchor, true);
      }
    },
    owns(id: number) { return gesture?.id === id; },
    whenSettled() { return activeMove; },
    finish() { const anchor = landing?.anchor; cancel(); if (anchor) move(anchor, true); },
    cancel,
  };
}
