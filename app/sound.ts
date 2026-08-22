import type { MemeDefinition } from "./memes";

function audioContextClass() {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function playMessageSound() {
  const AudioContextClass = audioContextClass();
  if (!AudioContextClass) return Promise.resolve();

  let context: AudioContext;
  try {
    context = new AudioContextClass();
  } catch {
    return Promise.resolve();
  }
  const now = context.currentTime;
  const tones: Array<[number, number]> = [[660, 0], [880, .13]];

  tones.forEach(([frequency, delay]) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + delay;
    const end = start + .14;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.11, start + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end);
  });

  void context.resume().catch(() => undefined);
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      void context.close().catch(() => undefined);
      resolve();
    }, 340);
  });
}

export function playMemeSound(kind: MemeDefinition["sound"]) {
  if (kind === "video") return;
  const AudioContextClass = audioContextClass();
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const now = context.currentTime;
  const gain = context.createGain();
  gain.connect(context.destination);

  const patterns: Record<Exclude<MemeDefinition["sound"], "video">, Array<[number, number, OscillatorType]>> = {
    boom: [[72, .34, "sine"], [46, .55, "sine"]],
    chirp: [[540, .12, "square"], [720, .16, "triangle"], [920, .2, "sine"]],
    drop: [[440, .12, "sawtooth"], [210, .22, "triangle"], [90, .4, "sine"]],
    stone: [[105, .18, "square"], [78, .32, "sine"]],
    salute: [[392, .13, "triangle"], [523, .13, "triangle"], [659, .2, "triangle"]],
    suspense: [[220, .2, "sawtooth"], [233, .2, "sawtooth"], [247, .38, "sawtooth"]],
  };

  let cursor = now;
  patterns[kind].forEach(([frequency, duration, type]) => {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, cursor);
    gain.gain.setValueAtTime(.0001, cursor);
    gain.gain.exponentialRampToValueAtTime(.16, cursor + .02);
    gain.gain.exponentialRampToValueAtTime(.0001, cursor + duration);
    oscillator.connect(gain);
    oscillator.start(cursor);
    oscillator.stop(cursor + duration);
    cursor += duration * .72;
  });
  window.setTimeout(() => void context.close(), Math.ceil((cursor - now + .5) * 1000));
}
