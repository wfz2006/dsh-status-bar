import { DEFAULT_CHIME_PRESET, type ChimeKind, type ChimePreset } from '../shared/sound';

type Tone = {
  frequency: number;
  offset: number;
  duration: number;
  level: number;
  waveform?: OscillatorType;
  attack?: number;
  glideFrom?: number;
};

const cues: Record<ChimePreset, Record<ChimeKind, readonly Tone[]>> = {
  classic: {
    complete: [
      { frequency: 659.25, offset: 0, duration: .45, level: .10 },
      { frequency: 987.77, offset: .13, duration: .45, level: .08 },
    ],
    approval: [
      { frequency: 523.25, offset: 0, duration: .45, level: .10 },
      { frequency: 783.99, offset: .13, duration: .45, level: .08 },
    ],
  },
  water: {
    complete: [
      { frequency: 587.33, glideFrom: 880, offset: 0, duration: .18, level: .12, attack: .007 },
      { frequency: 880, glideFrom: 1244.51, offset: .11, duration: .24, level: .09, attack: .008 },
      { frequency: 880, offset: .23, duration: .21, level: .025 },
    ],
    approval: [
      { frequency: 698.46, glideFrom: 1174.66, offset: 0, duration: .17, level: .12, attack: .006 },
      { frequency: 440, glideFrom: 739.99, offset: .18, duration: .21, level: .11, attack: .007 },
    ],
  },
  glass: {
    complete: [
      { frequency: 659.25, offset: 0, duration: .52, level: .075, attack: .009 },
      { frequency: 1794, offset: 0, duration: .24, level: .027, attack: .006 },
      { frequency: 1046.5, offset: .13, duration: .59, level: .063, attack: .009 },
      { frequency: 2845, offset: .13, duration: .31, level: .023, attack: .006 },
    ],
    approval: [
      { frequency: 830.61, offset: 0, duration: .46, level: .085, attack: .008 },
      { frequency: 2259, offset: 0, duration: .23, level: .028, attack: .006 },
      { frequency: 622.25, offset: .17, duration: .45, level: .071, attack: .008 },
      { frequency: 1692, offset: .17, duration: .23, level: .024, attack: .006 },
    ],
  },
  marimba: {
    complete: [
      { frequency: 440, offset: 0, duration: .18, level: .13, waveform: 'triangle', attack: .005 },
      { frequency: 554.37, offset: .08, duration: .17, level: .11, waveform: 'triangle', attack: .005 },
      { frequency: 659.25, offset: .17, duration: .23, level: .11, waveform: 'triangle', attack: .005 },
    ],
    approval: [
      { frequency: 392, offset: 0, duration: .16, level: .13, waveform: 'triangle', attack: .005 },
      { frequency: 392, offset: .14, duration: .19, level: .12, waveform: 'triangle', attack: .005 },
    ],
  },
  pulse: {
    complete: [
      { frequency: 523.25, offset: 0, duration: .08, level: .056, waveform: 'square', attack: .008 },
      { frequency: 783.99, offset: .085, duration: .15, level: .049, waveform: 'square', attack: .012 },
    ],
    approval: [
      { frequency: 493.88, offset: 0, duration: .075, level: .056, waveform: 'square', attack: .008 },
      { frequency: 493.88, offset: .10, duration: .075, level: .056, waveform: 'square', attack: .008 },
      { frequency: 369.99, offset: .20, duration: .13, level: .051, waveform: 'square', attack: .009 },
    ],
  },
};

type Playback = { output: GainNode; voices: Set<OscillatorNode> };
let context: AudioContext | undefined;
let current: Playback | undefined;

export function stopChime() {
  const playing = current;
  if (!playing) return;
  current = undefined;
  const now = playing.output.context.currentTime;
  playing.output.gain.setTargetAtTime(0, now, .003);
  for (const voice of playing.voices) voice.stop(now + .018);
}

/** Preview and live notifications share the same locally synthesized cues. */
export function playChime(kind: ChimeKind, preset: ChimePreset = DEFAULT_CHIME_PRESET) {
  try {
    if (!context || context.state === 'closed') context = new AudioContext();
    const audio = context;
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    const start = audio.currentTime + (current ? .025 : .01);
    stopChime();
    const playback: Playback = { output: audio.createGain(), voices: new Set() };
    playback.output.connect(audio.destination);
    current = playback;

    for (const tone of cues[preset][kind]) {
      const at = start + tone.offset;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = tone.waveform ?? 'sine';
      oscillator.frequency.setValueAtTime(tone.glideFrom ?? tone.frequency, at);
      if (tone.glideFrom) oscillator.frequency.exponentialRampToValueAtTime(tone.frequency, at + .055);
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(tone.level, at + (tone.attack ?? .02));
      gain.gain.exponentialRampToValueAtTime(.0001, at + tone.duration);
      oscillator.connect(gain).connect(playback.output);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        playback.voices.delete(oscillator);
        if (!playback.voices.size) {
          playback.output.disconnect();
          if (current === playback) current = undefined;
        }
      };
      oscillator.start(at);
      playback.voices.add(oscillator);
      oscillator.stop(at + tone.duration + .05);
    }

    const debug = window as Window & { __glassChime?: ChimeKind; __glassChimePreset?: ChimePreset; __glassAudioState?: string };
    debug.__glassChime = kind;
    debug.__glassChimePreset = preset;
    debug.__glassAudioState = audio.state;
  } catch {
    // Audio device failure must not break the status view.
  }
}
