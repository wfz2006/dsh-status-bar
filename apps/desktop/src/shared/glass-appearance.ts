export type GlassAppearance = { tintColor: string; tintOpacity: number; brightness: number };
export const DEFAULT_GLASS_APPEARANCE: GlassAppearance = { tintColor: '#000000', tintOpacity: 10, brightness: 100 };

export function normalizeGlassAppearance(value: unknown): GlassAppearance {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  function percent(key: 'tintOpacity' | 'brightness', min: number, max: number) {
    const input = v[key];
    return typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(min, Math.round(input))) : DEFAULT_GLASS_APPEARANCE[key];
  }
  return { tintColor: typeof v.tintColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.tintColor) ? v.tintColor.toLowerCase() : DEFAULT_GLASS_APPEARANCE.tintColor,
    tintOpacity: percent('tintOpacity', 0, 100), brightness: percent('brightness', 50, 150) };
}

export function tintChannels(color: string): [number, number, number] {
  return [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
}
export function tintFill(appearance: GlassAppearance): string {
  return `rgba(${tintChannels(appearance.tintColor).join(',')},${appearance.tintOpacity / 100})`;
}
