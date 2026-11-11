export type PoolPoint = { x: number; y: number };
export type PoolWhalePose = PoolPoint & { yaw: number };

const TURN_SECONDS = 0.24;
const SWIM_SECONDS = 1.2;

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
    reveal: smooth((swimAge - 0.48) / 1.3),
  };
}
