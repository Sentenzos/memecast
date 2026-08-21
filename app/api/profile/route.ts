import { getAdminUser } from "../../admin-auth";
import { ensureStreamerForOwner, updateStreamerSettings } from "../../../db";

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
    overlayAnimation: streamer.overlay_animation,
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
    const user = await getAdminUser();
    if (!user) return Response.json({ error: "Нужно войти" }, { status: 401 });
    const payload = await request.json() as { displayName?: string; slug?: string; cooldownSeconds?: number; mediaDisplaySeconds?: number; textDisplaySeconds?: number; overlayPosition?: string; overlayMediaWidth?: number; overlayMediaHeight?: number; overlayAnimation?: string };
    const displayName = payload.displayName?.trim().slice(0, 40) ?? "";
    const slug = payload.slug?.trim() ?? "";
    const cooldownSeconds = Math.round(Number(payload.cooldownSeconds));
    const mediaDisplaySeconds = Math.round(Number(payload.mediaDisplaySeconds));
    const textDisplaySeconds = Math.round(Number(payload.textDisplaySeconds));
    const overlayPosition = normalizeOverlayPosition(payload.overlayPosition);
    const overlayMediaWidth = Math.round(Number(payload.overlayMediaWidth));
    const overlayMediaHeight = Math.round(Number(payload.overlayMediaHeight));
    const overlayAnimation = normalizeOverlayAnimation(payload.overlayAnimation);
    if (!displayName || !/^[a-z0-9_-]{3,40}$/.test(slug) || !Number.isFinite(cooldownSeconds) || cooldownSeconds < 5 || cooldownSeconds > 300 || !Number.isFinite(mediaDisplaySeconds) || mediaDisplaySeconds < 1 || mediaDisplaySeconds > 30 || !Number.isFinite(textDisplaySeconds) || textDisplaySeconds < 1 || textDisplaySeconds > 30 || !overlayPosition || !Number.isFinite(overlayMediaWidth) || overlayMediaWidth < 120 || overlayMediaWidth > 900 || !Number.isFinite(overlayMediaHeight) || overlayMediaHeight < 120 || overlayMediaHeight > 700 || !overlayAnimation) {
      return Response.json({ error: "Проверь ник, адрес, таймаут и настройки OBS" }, { status: 400 });
    }
    const streamer = await updateStreamerSettings(user.userId, { displayName, slug, cooldownSeconds, mediaDisplaySeconds, textDisplaySeconds, overlayPosition, overlayMediaWidth, overlayMediaHeight, overlayAnimation });
    if (!streamer) throw new Error("Профиль не найден");
    return Response.json({ profile: serialize(streamer) });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE") ? "Этот адрес уже занят" : error instanceof Error ? error.message : "Ошибка сохранения";
    return Response.json({ error: message }, { status: 500 });
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
