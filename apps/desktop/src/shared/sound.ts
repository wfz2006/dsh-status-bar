export type ChimeKind = 'complete' | 'approval';
export type ChimeSnapshot = { sessionId: string; status: string; attention: number };

/** Decides whether a projection update deserves a chime. Pure so the transition
 *  rules can be tested without an AudioContext. */
export function chimeFor(previous: ChimeSnapshot | null, next: ChimeSnapshot, sound: boolean): ChimeKind | null {
  if (!sound || !previous) return null;
  if (previous.sessionId !== next.sessionId) return null;
  if (next.attention > previous.attention) return 'approval';
  if (next.status === 'completed' && previous.status !== 'completed') return 'complete';
  return null;
}
