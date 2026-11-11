import type { DragPaint } from './drag-motion';

export type PoolDragFrame = {
  flowX: number; flowY: number;
  sloshX: number; sloshY: number;
  energy: number; rippleAge: number; rippleStrength: number;
};

type Axis = { position: number; speed: number; target: number };
const still = (): Axis => ({ position: 0, speed: 0, target: 0 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function response(value: number, limit: number) {
  const normal = clamp(value / limit, -1, 1);
  return Math.abs(normal) < .007 ? 0 : Math.sign(normal) * Math.sqrt(Math.abs(normal));
}

// Closed-form underdamped spring. The pool advances it on its existing render clock.
function advanceAxis(axis: Axis, seconds: number) {
  const damping = 4.6, frequency = 10.2;
  const delta = axis.position - axis.target;
  const amplitude = (axis.speed + damping * delta) / frequency;
  const decay = Math.exp(-damping * seconds);
  const sine = Math.sin(frequency * seconds), cosine = Math.cos(frequency * seconds);
  const position = axis.target + decay * (delta * cosine + amplitude * sine);
  const speed = decay * (axis.speed * cosine - (damping * amplitude + frequency * delta) * sine);
  if (!axis.target && Math.abs(position) < .001 && Math.abs(speed) < .015) {
    axis.position = axis.speed = 0;
  } else {
    axis.position = clamp(position, -1.15, 1.15);
    axis.speed = Math.abs(position) > 1.15 ? 0 : speed;
  }
}

export class PoolDragMotion {
  private x = still();
  private y = still();
  private lastTime: number | null = null;
  private lastEnergy = 0;
  private moving = false;
  private ripple: { time: number; strength: number } | null = null;

  private advance(time: number) {
    if (this.lastTime === null) { this.lastTime = time; return; }
    if (time <= this.lastTime) return;
    const seconds = Math.min(time - this.lastTime, 100) / 1000;
    this.lastTime = time;
    advanceAxis(this.x, seconds);
    advanceAxis(this.y, seconds);
  }

  set(paint: DragPaint, time: number) {
    // Apply the previous force up to this event, even when drag and release
    // both arrive between frames.
    this.advance(time);
    const moving = paint?.phase === 'moving';
    if (paint?.phase === 'pressed') this.ripple = null;
    else if (this.moving && !moving && this.lastEnergy > .08) {
      this.ripple = { time, strength: this.lastEnergy };
    }
    this.moving = moving;
    this.lastEnergy = moving ? clamp(paint.energy, 0, 1) : 0;
    this.x.target = moving ? response(paint.x, 4.8) * .82 : 0;
    this.y.target = moving ? response(paint.y, 2.6) * .70 : 0;
  }

  sample(time: number): PoolDragFrame {
    this.advance(time);
    const sloshX = this.x.position, sloshY = this.y.position;
    const rippleAge = this.ripple ? Math.max(0, time - this.ripple.time) / 1000 : 0;
    if (rippleAge >= 1.35) this.ripple = null;
    const fade = clamp((1.35 - rippleAge) / .45, 0, 1);
    const energy = Math.min(.78, Math.hypot(sloshX, sloshY) * .62 + Math.hypot(this.x.speed, this.y.speed) * .017);
    return {
      flowX: sloshX ? -sloshX * .19 : 0, flowY: sloshY ? -sloshY * .13 : 0,
      sloshX, sloshY, energy, rippleAge,
      rippleStrength: this.ripple ? this.ripple.strength * fade * fade * (3 - 2 * fade) : 0,
    };
  }

  reset() {
    this.x = still(); this.y = still();
    this.lastTime = null;
    this.lastEnergy = 0;
    this.moving = false;
    this.ripple = null;
  }
}
