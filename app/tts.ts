export const TTS_VOICE_PRESETS = [
  { value: "system", label: "Системный", description: "Текущий голос без изменений" },
  { value: "soft-female", label: "Мягкий женский", description: "Спокойная и мягкая подача" },
  { value: "bright-female", label: "Энергичный", description: "Быстрее и эмоциональнее" },
  { value: "male", label: "Мужской", description: "Ниже и спокойнее" },
  { value: "deep-male", label: "Глубокий", description: "Низкий голос с медленной подачей" },
] as const;

export type TtsVoicePreset = typeof TTS_VOICE_PRESETS[number]["value"];

export function normalizeTtsVoicePreset(value: unknown): TtsVoicePreset | null {
  return TTS_VOICE_PRESETS.find((preset) => preset.value === value)?.value ?? null;
}

type VoiceKind = "any" | "female" | "male";

const VOICE_STYLES: Record<TtsVoicePreset, { rate: number; pitch: number; kind: VoiceKind; alternate: boolean }> = {
  system: { rate: 1, pitch: 1, kind: "any", alternate: false },
  "soft-female": { rate: 0.94, pitch: 1.08, kind: "female", alternate: false },
  "bright-female": { rate: 1.08, pitch: 1.16, kind: "female", alternate: true },
  male: { rate: 0.96, pitch: 0.9, kind: "male", alternate: false },
  "deep-male": { rate: 0.88, pitch: 0.74, kind: "male", alternate: true },
};

const FEMALE_NAMES = ["irina", "alena", "elena", "anna", "maria", "katya", "milena", "svetlana", "tatyana", "victoria", "zira", "female", "woman"];
const MALE_NAMES = ["pavel", "maxim", "alexander", "aleksandr", "ivan", "yuri", "david", "male", "man"];

export function configureSpeechUtterance(
  utterance: SpeechSynthesisUtterance,
  voices: SpeechSynthesisVoice[],
  preset: TtsVoicePreset,
  language: string,
) {
  const style = VOICE_STYLES[preset] ?? VOICE_STYLES.system;
  utterance.lang = language;
  utterance.rate = style.rate;
  utterance.pitch = style.pitch;

  const prefix = language.slice(0, 2).toLowerCase();
  const exactLanguage = voices.filter((voice) => voice.lang.toLowerCase() === language.toLowerCase());
  const matchingLanguage = exactLanguage.length
    ? exactLanguage
    : voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
  const candidates = matchingLanguage.length ? matchingLanguage : voices;
  if (!candidates.length) return;

  if (style.kind === "any") {
    utterance.voice = candidates[0];
    return;
  }

  const keywords = style.kind === "female" ? FEMALE_NAMES : MALE_NAMES;
  const preferred = candidates.filter((voice) => keywords.some((keyword) => voice.name.toLowerCase().includes(keyword)));
  const pool = preferred.length ? preferred : candidates;
  utterance.voice = pool[style.alternate && pool.length > 1 ? 1 : 0];
}
