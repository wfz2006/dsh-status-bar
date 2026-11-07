import { clampBounds, type Bounds } from './window';

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';
export const EDGE_ORB_SIZE = 64;

export type EdgeMotion = {
  direction: 'gather' | 'spread';
  capsule: Bounds;
  orb: Bounds;
  startedAt: number;
  duration: number;
};

/** Both endpoints fit in a single native window while the renderer changes the visible outline. */
export function edgeMotionLayout(capsule: Bounds, orb: Bounds) {
  const x = Math.min(capsule.x, orb.x), y = Math.min(capsule.y, orb.y);
  const host = {
    x, y,
    width: Math.max(capsule.x + capsule.width, orb.x + orb.width) - x,
    height: Math.max(capsule.y + capsule.height, orb.y + orb.height) - y,
  };
  const local = (bounds: Bounds) => ({ ...bounds, x: bounds.x - x, y: bounds.y - y });
  return { host, capsule: local(capsule), orb: local(orb) };
}

/** Work areas and window rectangles use DIP, including on secondary displays. */
export function edgeAtBounds(bounds: Bounds, area: Bounds): EdgeSide | null {
  const distances: [EdgeSide, number][] = [
    ['left', Math.abs(bounds.x - area.x)],
    ['right', Math.abs(area.x + area.width - bounds.x - bounds.width)],
    ['top', Math.abs(bounds.y - area.y)],
    ['bottom', Math.abs(area.y + area.height - bounds.y - bounds.height)],
  ];
  let closest = Infinity;
  let edge: EdgeSide | null = null;
  for (const [side, distance] of distances) {
    if (distance <= 24 && distance < closest) { closest = distance; edge = side; }
  }
  return edge;
}

/** Center the replacement at the previous window, with an optional edge anchor. */
export function edgeReplacementBounds(from: Bounds, size: Pick<Bounds, 'width' | 'height'>, area: Bounds, edge: EdgeSide | null = null): Bounds {
  const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height);
  return clampBounds({
    width, height,
    x: edge === 'left' ? area.x : edge === 'right' ? area.x + area.width - width
      : Math.round(from.x + (from.width - width) / 2),
    y: edge === 'top' ? area.y : edge === 'bottom' ? area.y + area.height - height
      : Math.round(from.y + (from.height - height) / 2),
  }, area, { width, height });
}

export function orbRegion(width: number, height: number): Bounds[] {
  const rows: Bounds[] = [], rx = width / 2, ry = height / 2;
  for (let y = 0; y < height; y++) {
    const inset = Math.floor(rx * (1 - Math.sqrt(Math.max(0, 1 - ((y + .5 - ry) / ry) ** 2))));
    if (width > inset * 2) rows.push({ x: inset, y, width: width - inset * 2, height: 1 });
  }
  return rows;
}
