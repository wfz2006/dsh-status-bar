export type PoolPoint = { x: number; y: number };
export type PoolWhalePose = PoolPoint & { yaw: number };
export type PoolSize = { width: number; height: number };

const TURN_SECONDS = 0.16;
const SWIM_SECONDS = 0.62;
const CLOSE_SECONDS = 0.36;

export function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function samplePoolOpening(from: PoolWhalePose, to: PoolPoint, age: number) {
  // The resting artwork faces left. Rightward routes need a half turn.
  const heading = to.x > from.x ? Math.PI : 0;
  const turnIn = heading !== from.yaw ? TURN_SECONDS : 0;
  const swimAge = age - turnIn;
  const swim = smooth(swimAge / SWIM_SECONDS);
  const yaw = swimAge < 0
    ? from.yaw + (heading - from.yaw) * smooth(age / TURN_SECONDS)
    : heading * (1 - smooth((swimAge - SWIM_SECONDS) / TURN_SECONDS));

  return {
    x: from.x + (to.x - from.x) * swim,
    y: from.y + (to.y - from.y) * swim,
    yaw,
    swim,
    reveal: smooth((swimAge - 0.06) / 0.54),
    settled: swim === 1 && yaw === 0,
  };
}

export function samplePoolClosing(from: PoolWhalePose, before: PoolSize, viewport: PoolSize, to: PoolPoint, age: number) {
  const progress = smooth(age / CLOSE_SECONDS);
  // The HWND can shrink faster than the swim. Project the starting pose into
  // the current viewport before interpolating to the capsule's resting pose.
  const x = from.x * viewport.width / Math.max(1, before.width);
  const y = from.y * viewport.height / Math.max(1, before.height);
  return { x: x + (to.x - x) * progress, y: y + (to.y - y) * progress, yaw: from.yaw * (1 - progress), progress };
}
