import { getBroadcastState, getStreamerBySlug, getStreamerByToken, updateBroadcastState } from "../../../db";
import { apiError, readJsonBody } from "../../request-security";

export const dynamic = "force-dynamic";

type BroadcastPayload = {
  live?: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  artworkDataUrl?: string | null;
  positionMs?: number;
  durationMs?: number;
  sourceUpdatedAt?: number;
};

const LIVE_TTL_MS = 10_000;

export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get("slug")?.trim() ?? "";
    if (!/^[a-z0-9_-]{3,40}$/.test(slug)) {
      return Response.json({ error: "Некорректный адрес стримера" }, { status: 400 });
    }
    const streamer = await getStreamerBySlug(slug);
    if (!streamer) return Response.json({ error: "Стример не найден" }, { status: 404 });
    const state = await getBroadcastState(streamer.id);
    const live = Boolean(state?.is_live && state.updated_at > Date.now() - LIVE_TTL_MS);
    return Response.json({
      live,
      title: state?.title ?? null,
      artist: state?.artist ?? null,
      album: state?.album ?? null,
      artworkDataUrl: state?.artwork_data_url ?? null,
      positionMs: live ? state?.position_ms ?? 0 : 0,
      durationMs: state?.duration_ms ?? 0,
      sourceUpdatedAt: state?.source_updated_at ?? 0,
      hlsUrl: `/radio/${encodeURIComponent(streamer.slug)}/index.m3u8`,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error, "Ошибка состояния трансляции", "broadcast state read failed");
  }
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token || token.length > 128) return Response.json({ error: "Нужен токен Broadcaster" }, { status: 401 });
    const streamer = await getStreamerByToken(token);
    if (!streamer) return Response.json({ error: "Токен Broadcaster недействителен" }, { status: 401 });

    const payload = await readJsonBody<BroadcastPayload>(request, 220 * 1024);
    const live = payload.live === true;
    const title = cleanText(payload.title, 180);
    const artist = cleanText(payload.artist, 180);
    const album = cleanText(payload.album, 180);
    const artworkDataUrl = cleanArtwork(payload.artworkDataUrl);
    const positionMs = cleanInteger(payload.positionMs, 0, 24 * 60 * 60 * 1000);
    const durationMs = cleanInteger(payload.durationMs, 0, 24 * 60 * 60 * 1000);
    const sourceUpdatedAt = cleanInteger(payload.sourceUpdatedAt, 0, Date.now() + 60_000);
    if (live && (!title || !artist)) {
      return Response.json({ error: "Для эфира нужны название и исполнитель" }, { status: 400 });
    }
    await updateBroadcastState(streamer.id, {
      isLive: live,
      title,
      artist,
      album,
      artworkDataUrl,
      positionMs,
      durationMs,
      sourceUpdatedAt: sourceUpdatedAt || Date.now(),
    });
    return Response.json({ ok: true, slug: streamer.slug });
  } catch (error) {
    return apiError(error, "Ошибка обновления трансляции", "broadcast state update failed");
  }
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  const cleaned = withoutControls.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanInteger(value: unknown, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(Number(value))));
}

function cleanArtwork(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  if (value.length > 190 * 1024) return null;
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
}
