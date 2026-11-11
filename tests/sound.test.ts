import { describe, expect, it } from 'vitest';
import { chimeFor } from '../apps/desktop/src/shared/sound';
import { normalizeSettings } from '../apps/desktop/src/shared/view-model';

const base = { sessionId: 's1', status: 'working', attention: 0 };

describe('chimeFor', () => {
  it('chimes once when the watched session completes', () => {
    expect(chimeFor(base, { ...base, status: 'completed' }, true)).toBe('complete');
    expect(chimeFor({ ...base, status: 'completed' }, { ...base, status: 'completed' }, true)).toBeNull();
  });

  it('chimes when a new approval or question asks for attention', () => {
    expect(chimeFor(base, { ...base, attention: 1 }, true)).toBe('approval');
    expect(chimeFor({ ...base, attention: 2 }, { ...base, attention: 1 }, true)).toBeNull();
  });

  it('stays quiet on first observation, session switches and muted settings', () => {
    expect(chimeFor(null, { ...base, status: 'completed', attention: 1 }, true)).toBeNull();
    expect(chimeFor(base, { ...base, sessionId: 's2', status: 'completed' }, true)).toBeNull();
    expect(chimeFor(base, { ...base, status: 'completed', attention: 1 }, false)).toBeNull();
  });

  it('prefers the approval chime when a completion and a request land together', () => {
    expect(chimeFor(base, { ...base, status: 'completed', attention: 1 }, true)).toBe('approval');
  });
});

describe('chime settings', () => {
  it('uses the original chime for older settings and unknown presets', () => {
    expect(normalizeSettings({ sound: true })).toMatchObject({ sound: true, soundPreset: 'classic' });
    expect(normalizeSettings({ soundPreset: 'unknown' }).soundPreset).toBe('classic');
  });

  it('keeps the selected chime even while automatic sound is muted', () => {
    expect(normalizeSettings({ sound: false, soundPreset: 'water' })).toMatchObject({ sound: false, soundPreset: 'water' });
  });
});
