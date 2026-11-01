export const WHALE_POOL_FEATURE = 'whale-pool-v1';
export function normalizeAnnouncements(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && /^[a-z0-9-]{1,80}$/.test(item)))].slice(0,32) : [];
}
export function acknowledgeFeature(value: unknown, feature: string): string[] {
  return normalizeAnnouncements([feature,...normalizeAnnouncements(value)]);
}
export function shouldIntroduceWhalePool(value: unknown, smoke: boolean): boolean {
  return !smoke && !normalizeAnnouncements(value).includes(WHALE_POOL_FEATURE);
}
