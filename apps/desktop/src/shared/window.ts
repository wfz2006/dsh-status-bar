export type Bounds = { x: number; y: number; width: number; height: number };
export type ResizeEdge = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se';
export function migrateBounds(bounds: Bounds, presentationVersion: unknown): Bounds {
  if (presentationVersion === 2 || density(bounds.width, bounds.height) === 'capsule') return bounds;
  return { ...bounds, width: Math.min(bounds.width, 340), height: Math.min(bounds.height, 300) };
}
export function morphBounds(start: Bounds, end: Bounds, progress: number): Bounds {
  const t = Math.max(0, Math.min(1, progress));
  const ease = 1 - (1 - t) ** 4;
  const heightEase = 1 - (1 - t) ** 3;
  const lerp = (a: number, b: number, amount: number) => Math.round(a + (b - a) * amount);
  // Position and width use the same curve so an edge anchored to the work area stays fixed.
  return { x: lerp(start.x, end.x, ease), y: lerp(start.y, end.y, heightEase), width: lerp(start.width, end.width, ease), height: lerp(start.height, end.height, heightEase) };
}
export function roundedRegion(width: number, height: number): Bounds[] {
  const radius = Math.min(height < 96 ? 16 : 20, Math.floor(height / 2), Math.floor(width / 2));
  const rows: Bounds[] = [{ x: 0, y: radius, width, height: height - radius * 2 }];
  for (let y = 0; y < radius; y++) {
    const inset = Math.max(0, Math.ceil(radius - Math.sqrt(radius ** 2 - (radius - y - 0.5) ** 2) - 0.5));
    rows.push({ x: inset, y, width: width - inset * 2, height: 1 }, { x: inset, y: height - 1 - y, width: width - inset * 2, height: 1 });
  }
  return rows.filter(r => r.height > 0 && r.width > 0);
}
export function resizeBounds(start: Bounds, edge: ResizeEdge, dx: number, dy: number): Bounds {
  const width = Math.max(180, Math.min(900, start.width + (edge.includes('w') ? -dx : edge.includes('e') ? dx : 0)));
  const height = Math.max(46, Math.min(1000, start.height + (edge.includes('n') ? -dy : edge.includes('s') ? dy : 0)));
  return { x: edge.includes('w') ? start.x + start.width - width : start.x,
    y: edge.includes('n') ? start.y + start.height - height : start.y, width, height };
}
export function clampBounds(bounds: Bounds, area: Bounds): Bounds {
  const width = Math.min(Math.max(bounds.width, 180), area.width);
  const height = Math.min(Math.max(bounds.height, 46), area.height);
  return { width, height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) };
}
export function density(width: number, height: number): 'capsule' | 'compact' | 'workspace' {
  if (width < 240 || height < 86) return 'capsule';
  if (width < 340 || height < 250) return 'compact';
  return 'workspace';
}
