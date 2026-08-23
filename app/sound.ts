import type { MemeDefinition } from "./memes";

function audioContextClass() {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

let messageAudio: HTMLAudioElement | null = null;
const MESSAGE_SOUND_URL = "/meme-notification.mp3";

export function preloadMessageSound() {
  if (typeof window === "undefined") return;
  if (!messageAudio) {
    messageAudio = new Audio(MESSAGE_SOUND_URL);
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
