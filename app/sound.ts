import type { MemeDefinition } from "./memes";

function audioContextClass() {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

let messageSoundUrl: string | null = null;
let messageAudio: HTMLAudioElement | null = null;

function createMessageSoundUrl() {
  if (messageSoundUrl) return messageSoundUrl;
  const sampleRate = 24000;
  const duration = .42;
  const samples = Math.ceil(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples * 2, true);

  const tone = (time: number, start: number, length: number, frequency: number) => {
    const local = time - start;
    if (local < 0 || local > length) return 0;
    const attack = Math.min(1, local / .012);
    const release = Math.min(1, (length - local) / .075);
    return Math.sin(Math.PI * 2 * frequency * local) * attack * release;
  };
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const value = (tone(time, 0, .2, 659.25) + tone(time, .15, .24, 880)) * .38;
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true);
  }

  messageSoundUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  return messageSoundUrl;
}

export function preloadMessageSound() {
  if (typeof window === "undefined") return;
  if (!messageAudio) {
    messageAudio = new Audio(createMessageSoundUrl());
    messageAudio.preload = "auto";
    messageAudio.load();
  }
}

export function playMessageSound() {
  if (typeof window === "undefined") return Promise.resolve();
  preloadMessageSound();
  const audio = messageAudio;
  if (!audio) return Promise.resolve();
  audio.pause();
  audio.currentTime = 0;
  audio.volume = .9;
  return new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
      resolve();
    };
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    const timer = window.setTimeout(finish, 1200);
    void audio.play().catch(finish);
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
