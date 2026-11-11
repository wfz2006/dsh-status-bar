export type ChimeKind = 'complete' | 'approval';
export type ChimeSnapshot = { sessionId: string; status: string; attention: number };

export const CHIME_PRESETS = [
  ['classic', '经典双音'],
  ['water', '水滴'],
  ['glass', '玻璃风铃'],
  ['marimba', '木琴'],
  ['pulse', '电子脉冲'],
] as const;
export type ChimePreset = typeof CHIME_PRESETS[number][0];
export const DEFAULT_CHIME_PRESET: ChimePreset = 'classic';

export function normalizeChimePreset(value: unknown): ChimePreset {
  return CHIME_PRESETS.find(([id]) => id === value)?.[0] ?? DEFAULT_CHIME_PRESET;
}

/** Decides whether a projection update deserves a chime. Pure so the transition
 *  rules can be tested without an AudioContext. */
export function chimeFor(previous: ChimeSnapshot | null, next: ChimeSnapshot, sound: boolean): ChimeKind | null {
  if (!sound || !previous) return null;
  if (previous.sessionId !== next.sessionId) return null;
  if (next.attention > previous.attention) return 'approval';
  if (next.status === 'completed' && previous.status !== 'completed') return 'complete';
  return null;
}
