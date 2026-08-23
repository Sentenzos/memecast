export type MemeDefinition = {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  tone: string;
  sound: "boom" | "chirp" | "drop" | "stone" | "salute" | "suspense" | "video";
  provider?: "giphy" | "custom";
  previewUrl?: string;
  mediaUrl?: string;
  mediaType?: "video" | "audio" | "image";
  sourceType?: "upload" | "gif" | "sticker" | "clip" | "local";
  tags?: string[];
  width?: number | null;
  height?: number | null;
};

export const memes: MemeDefinition[] = [
  { id: "suspicious", emoji: "🤨", title: "Подозрительно", subtitle: "Vine boom", tone: "violet", sound: "boom" },
  { id: "plot-twist", emoji: "🐸", title: "Вот это поворот", subtitle: "Dramatic hit", tone: "lime", sound: "chirp" },
  { id: "im-done", emoji: "💀", title: "Я всё", subtitle: "Skull reverb", tone: "orange", sound: "drop" },
  { id: "based", emoji: "🗿", title: "База", subtitle: "Stone silence", tone: "blue", sound: "stone" },
  { id: "salute", emoji: "🫡", title: "Моё почтение", subtitle: "Tiny salute", tone: "pink", sound: "salute" },
  { id: "oops", emoji: "😳", title: "Опа…", subtitle: "Suspense", tone: "yellow", sound: "suspense" },
];

export function getMeme(id: string) {
  return memes.find((meme) => meme.id === id) ?? null;
}

export const demoStreamer = {
  slug: "demo-streamer",
  displayName: "Демо-стример",
  avatarUrl: null as string | null,
  cooldownSeconds: 30,
  mediaDisplaySeconds: 5,
  textDisplaySeconds: 5,
  overlayPosition: "bottom-right" as const,
  overlayMediaWidth: 360,
  overlayMediaHeight: 300,
  overlayAnimation: "pop" as const,
  ttsVoice: "system" as const,
  overlayToken: "demo-overlay-local",
};
