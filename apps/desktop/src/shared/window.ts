export type Bounds = { x: number; y: number; width: number; height: number };
export function clampBounds(bounds: Bounds, area: Bounds): Bounds {
  const width = Math.min(Math.max(bounds.width, 180), area.width);
  const height = Math.min(Math.max(bounds.height, 54), area.height);
  return { width, height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) };
}
export function density(width: number, height: number): 'capsule' | 'compact' | 'workspace' {
  if (width < 240 || height < 86) return 'capsule';
  if (width < 340 || height < 250) return 'compact';
  return 'workspace';
}
