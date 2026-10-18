import type { ChimeKind } from '../shared/sound';

let context: AudioContext | undefined;

/** Plays a short two-note chime with Web Audio: no bundled assets, no network.
 *  The window opts into autoplay so the first chime is not swallowed. */
export function playChime(kind: ChimeKind) {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime + 0.01;
    const notes = kind === 'approval' ? [523.25, 783.99] : [659.25, 987.77];
    notes.forEach((frequency, index) => {
      const at = start + index * 0.13;
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.10 : 0.08, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.5);
    });
    const debug = window as Window & { __glassChime?: ChimeKind; __glassAudioState?: string };
    debug.__glassChime = kind;
    debug.__glassAudioState = context.state;
  } catch {
    // The chime is optional; a missing audio device must not break the status view.
  }
}
