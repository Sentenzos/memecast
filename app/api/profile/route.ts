import { getAdminUser } from "../../admin-auth";
import { ensureStreamerForOwner, updateStreamerSettings } from "../../../db";
import { apiError, readJsonBody, rejectCrossOriginRequest } from "../../request-security";
import { normalizeTtsVoicePreset } from "../../tts";

export const dynamic = "force-dynamic";

function serialize(streamer: Awaited<ReturnType<typeof ensureStreamerForOwner>>) {
  return {
    displayName: streamer.display_name,
    slug: streamer.slug,
    cooldownSeconds: streamer.cooldown_seconds,
    mediaDisplaySeconds: streamer.media_display_seconds,
    textDisplaySeconds: streamer.text_display_seconds,
    overlayPosition: streamer.overlay_position,
    overlayMediaWidth: streamer.overlay_media_width,
    overlayMediaHeight: streamer.overlay_media_height,
    overlayTextWidth: streamer.overlay_text_width,
    overlayTextHeight: streamer.overlay_text_height,
    overlayTextFontSize: streamer.overlay_text_font_size,
    overlayAnimation: streamer.overlay_animation,
    ttsVoice: streamer.tts_voice,
    overlayToken: streamer.overlay_token,
  };
}

export async function GET() {
  const user = await getAdminUser();
  if (!user) return Response.json({ error: "Нужно войти" }, { status: 401 });
  const streamer = await ensureStreamerForOwner(user.userId, user.displayName);
  return Response.json({ profile: serialize(streamer) });
}

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossOriginRequest(request);
    if (rejected) return rejected;
    const user = await getAdminUser();
    if (!user) return Response.json({ error: "Нужно войти" }, { status: 401 });
    const payload = await readJsonBody<{ displayName?: string; slug?: string; cooldownSeconds?: number; mediaDisplaySeconds?: number; textDisplaySeconds?: number; overlayPosition?: string; overlayMediaWidth?: number; overlayMediaHeight?: number; overlayTextWidth?: number; overlayTextHeight?: number; overlayTextFontSize?: number; overlayAnimation?: string; ttsVoice?: string }>(request, 8 * 1024);
    const displayName = payload.displayName?.trim().slice(0, 40) ?? "";
    const slug = payload.slug?.trim() ?? "";
    const cooldownSeconds = Math.round(Number(payload.cooldownSeconds));
    const mediaDisplaySeconds = Math.round(Number(payload.mediaDisplaySeconds));
    const textDisplaySeconds = Math.round(Number(payload.textDisplaySeconds));
    const overlayPosition = normalizeOverlayPosition(payload.overlayPosition);
    const overlayMediaWidth = Math.round(Number(payload.overlayMediaWidth));
    const overlayMediaHeight = Math.round(Number(payload.overlayMediaHeight));
    const overlayTextWidth = Math.round(Number(payload.overlayTextWidth));
    const overlayTextHeight = Math.round(Number(payload.overlayTextHeight));
    const overlayTextFontSize = Math.round(Number(payload.overlayTextFontSize));
    const overlayAnimation = normalizeOverlayAnimation(payload.overlayAnimation);
    const ttsVoice = normalizeTtsVoicePreset(payload.ttsVoice);
    if (!displayName || !/^[a-z0-9_-]{3,40}$/.test(slug) || !Number.isFinite(cooldownSeconds) || cooldownSeconds < 5 || cooldownSeconds > 300 || !Number.isFinite(mediaDisplaySeconds) || mediaDisplaySeconds < 1 || mediaDisplaySeconds > 30 || !Number.isFinite(textDisplaySeconds) || textDisplaySeconds < 1 || textDisplaySeconds > 30 || !overlayPosition || !Number.isFinite(overlayMediaWidth) || overlayMediaWidth < 120 || overlayMediaWidth > 900 || !Number.isFinite(overlayMediaHeight) || overlayMediaHeight < 120 || overlayMediaHeight > 700 || !Number.isFinite(overlayTextWidth) || overlayTextWidth < 200 || overlayTextWidth > 1000 || !Number.isFinite(overlayTextHeight) || overlayTextHeight < 70 || overlayTextHeight > 500 || !Number.isFinite(overlayTextFontSize) || overlayTextFontSize < 14 || overlayTextFontSize > 64 || !overlayAnimation || !ttsVoice) {
      return Response.json({ error: "Проверь ник, адрес, таймаут, размеры и настройки OBS" }, { status: 400 });
    }
    const streamer = await updateStreamerSettings(user.userId, { displayName, slug, cooldownSeconds, mediaDisplaySeconds, textDisplaySeconds, overlayPosition, overlayMediaWidth, overlayMediaHeight, overlayTextWidth, overlayTextHeight, overlayTextFontSize, overlayAnimation, ttsVoice });
    if (!streamer) throw new Error("Профиль не найден");
    return Response.json({ profile: serialize(streamer) });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return Response.json({ error: "Этот адрес уже занят" }, { status: 409 });
    return apiError(error, "Ошибка сохранения", "profile update failed");
  }
}

function normalizeOverlayPosition(value: string | undefined) {
  const positions = ["bottom-right", "bottom-left", "top-right", "top-left", "center"] as const;
  return positions.find((position) => position === value) ?? null;
}

function normalizeOverlayAnimation(value: string | undefined) {
  const animations = ["pop", "slide", "zoom", "bounce", "glitch"] as const;
  return animations.find((animation) => animation === value) ?? null;
}
