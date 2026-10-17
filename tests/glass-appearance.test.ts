import { expect, it } from 'vitest';
import { DEFAULT_GLASS_APPEARANCE, normalizeGlassAppearance, tintFill } from '../apps/desktop/src/shared/glass-appearance';
import { normalizeSettings } from '../apps/desktop/src/shared/view-model';

it('migrates old preferences to the existing 10% black glass without losing choices', () => {
  const settings = normalizeSettings({ theme: 'dark', animation: 'reduced' });
  expect(settings).toMatchObject({ ...DEFAULT_GLASS_APPEARANCE, theme: 'dark', animation: 'reduced' });
  expect(tintFill(settings)).toBe('rgba(0,0,0,0.1)');
});
it('preserves custom color and independently clamps finite percentages', () => {
  expect(normalizeGlassAppearance({ tintColor: '#64AADD', tintOpacity: 22.7, brightness: 125 })).toEqual({ tintColor: '#64aadd', tintOpacity: 23, brightness: 125 });
  expect(normalizeGlassAppearance({ tintOpacity: -10, brightness: 500 })).toMatchObject({ tintOpacity: 0, brightness: 150 });
  expect(normalizeGlassAppearance({ tintOpacity: 110, brightness: -100 })).toMatchObject({ tintOpacity: 100, brightness: 50 });
  expect(tintFill({ tintColor: '#64aadd', tintOpacity: 23, brightness: 125 })).toBe('rgba(100,170,221,0.23)');
});
it('rejects invalid persisted and IPC color/number values instead of inserting CSS', () => {
  for (const tintColor of ['red', '#fff', '#123456;filter:none', null, 123]) expect(normalizeGlassAppearance({ tintColor })).toEqual(DEFAULT_GLASS_APPEARANCE);
  for (const input of [NaN, Infinity, -Infinity, '25', null]) expect(normalizeGlassAppearance({ tintOpacity: input, brightness: input })).toEqual(DEFAULT_GLASS_APPEARANCE);
  expect(normalizeGlassAppearance([])).toEqual(DEFAULT_GLASS_APPEARANCE);
});
