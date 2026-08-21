import { getMeme } from "../../memes";
import { ensureDatabase, getD1, getStreamerBySlug, getStreamerByToken, type MemeAssetRecord } from "../../../db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { streamerSlug?: string; memeId?: string; viewerKey?: string; message?: string; viewerName?: string };
    const slug = payload.streamerSlug?.trim() ?? "";
    const viewerKey = payload.viewerKey?.trim() ?? "";
    const memeId = payload.memeId?.trim() ?? "";
    const message = payload.message?.trim().replace(/\s+/g, " ").slice(0, 220) ?? "";
    const viewerName = payload.viewerName?.trim().replace(/\s+/g, " ").slice(0, 32) || "Зритель";
    const localMeme = memeId ? getMeme(memeId) : null;
    if (!slug || (!memeId && !message) || memeId.length > 160 || viewerKey.length < 8 || viewerKey.length > 128) {
      return Response.json({ error: "Некорректный мем, текст или адрес стримера" }, { status: 400 });
    }
    const streamer = await getStreamerBySlug(slug);
    if (!streamer) return Response.json({ error: "Стример не найден" }, { status: 404 });
    const ip = clientIp(request);
    const now = Date.now();
    const blocked = await getD1().prepare("SELECT id FROM blocked_viewers WHERE streamer_id = ? AND ip_address = ? LIMIT 1")
      .bind(streamer.id, ip).first<{ id: string }>();
    if (blocked) {
      return Response.json({ ok: true, createdAt: now, cooldownSeconds: streamer.cooldown_seconds }, { status: 201 });
    }
    if (message && containsProfanity(message)) {
      return Response.json({ error: "Сообщение не отправлено: убери мат." }, { status: 400 });
    }
    const remoteMeme = !memeId || localMeme ? null : await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? LIMIT 1")
      .bind(memeId).first<MemeAssetRecord>();
    if (memeId && !localMeme && !remoteMeme) {
      return Response.json({ error: "Мем больше недоступен" }, { status: 404 });
    }

    const identity = `ip:${ip}`.slice(0, 180);
    const threshold = now - streamer.cooldown_seconds * 1000;
    const result = await getD1().prepare(`INSERT INTO alerts (id, streamer_id, meme_id, message, viewer_name, viewer_key, viewer_ip, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM alerts WHERE streamer_id = ? AND viewer_key = ? AND created_at > ?
      )`)
      .bind(crypto.randomUUID(), streamer.id, memeId || null, message || null, viewerName, identity, ip, now, streamer.id, identity, threshold)
      .run();

    if (!result.meta.changes) {
      const last = await getD1().prepare(`SELECT created_at FROM alerts
        WHERE streamer_id = ? AND viewer_key = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(streamer.id, identity).first<{ created_at: number }>();
      const retryAfter = Math.max(1, Math.ceil(((last?.created_at ?? now) + streamer.cooldown_seconds * 1000 - now) / 1000));
      return Response.json({ error: `Подожди ещё ${retryAfter} сек.`, retryAfter, cooldownSeconds: streamer.cooldown_seconds, serverTime: now }, { status: 429 });
    }

    return Response.json({ ok: true, createdAt: now, cooldownSeconds: streamer.cooldown_seconds }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка отправки" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const after = Number(url.searchParams.get("after") ?? 0);
    const streamer = await getStreamerByToken(token);
    if (!streamer) return Response.json({ error: "Оверлей не найден" }, { status: 404 });

    const rows = await getD1().prepare(`SELECT
        alerts.id,
        alerts.meme_id,
        alerts.message,
        alerts.viewer_name,
        alerts.created_at,
        meme_assets.provider,
        meme_assets.title AS asset_title,
        meme_assets.preview_url,
        meme_assets.media_url,
        meme_assets.media_type,
        meme_assets.source_type,
        meme_assets.source_url,
        meme_assets.width,
        meme_assets.height
      FROM alerts
      LEFT JOIN meme_assets ON meme_assets.id = alerts.meme_id
      WHERE alerts.streamer_id = ? AND alerts.created_at > ?
      ORDER BY alerts.created_at ASC LIMIT 20`)
      .bind(streamer.id, Number.isFinite(after) ? after : 0)
      .all<{ id: string; meme_id: string | null; message: string | null; viewer_name: string | null; created_at: number; provider: string | null; asset_title: string | null; preview_url: string | null; media_url: string | null; media_type: "video" | "audio" | "image" | null; source_type: "upload" | "gif" | "sticker" | "clip" | null; source_url: string | null; width: number | null; height: number | null }>();

    const tones = ["violet", "lime", "orange", "blue", "pink", "yellow"];
    const alerts = rows.results.flatMap((row, index) => {
      const localMeme = row.meme_id ? getMeme(row.meme_id) : null;
      if (localMeme) return [{ id: row.id, createdAt: row.created_at, message: row.message ?? undefined, viewerName: row.viewer_name ?? undefined, meme: localMeme }];
      if (row.provider && row.asset_title && row.media_url) {
        const mediaType = row.media_type ?? "video";
        const sourceType = row.source_type ?? "upload";
        return [{
          id: row.id,
          createdAt: row.created_at,
          message: row.message ?? undefined,
          viewerName: row.viewer_name ?? undefined,
          meme: {
            id: row.meme_id ?? row.id,
            emoji: sourceType === "sticker" ? "🏷️" : mediaType === "audio" ? "🔊" : mediaType === "image" ? "🖼️" : "🎬",
            title: row.asset_title,
            subtitle: sourceType === "sticker" ? "STICKER" : sourceType === "gif" || mediaType === "image" ? "GIF" : "CLIP",
            tone: tones[index % tones.length],
            sound: "video" as const,
            provider: row.provider as "giphy" | "custom",
            previewUrl: displayPreviewUrl(row) ?? undefined,
            mediaUrl: displayMediaUrl(row),
            mediaType,
            sourceType,
            width: row.width,
            height: row.height,
          },
        }];
      }
      if (row.message) {
        return [{
          id: row.id,
          createdAt: row.created_at,
          message: row.message,
          viewerName: row.viewer_name ?? undefined,
          meme: {
            id: `text:${row.id}`,
            emoji: "💬",
            title: "Сообщение в эфир",
            subtitle: "TEXT TO SPEECH",
            tone: tones[index % tones.length],
            sound: "video" as const,
          },
        }];
      }
      return [];
    });
    return Response.json({
      alerts,
      settings: {
        mediaDisplaySeconds: streamer.media_display_seconds,
        textDisplaySeconds: streamer.text_display_seconds,
        overlayPosition: streamer.overlay_position,
        overlayMediaWidth: streamer.overlay_media_width,
        overlayMediaHeight: streamer.overlay_media_height,
        overlayAnimation: streamer.overlay_animation,
      },
      serverTime: Date.now(),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка оверлея" }, { status: 500 });
  }
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

function containsProfanity(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[a@]/g, "а")
    .replace(/[e3]/g, "е")
    .replace(/[o0]/g, "о")
    .replace(/[p]/g, "р")
    .replace(/[c]/g, "с")
    .replace(/[xх]/g, "х")
    .replace(/[yу]/g, "у")
    .replace(/[6]/g, "б")
    .replace(/[1i!]/g, "и")
    .replace(/[^а-яёa-z]+/g, "");
  return [
    /ху[йиеяю]/,
    /п[ие]зд/,
    /бл[яе]/,
    /еб[а-яё]*|ёб[а-яё]*/,
    /сука/,
    /мудак/,
    /мудил/,
    /залуп/,
    /гандон/,
    /пид[ао]?р/,
    /шлюх/,
    /долбо[её]б/,
  ].some((pattern) => pattern.test(normalized));
}

function displayMediaUrl(asset: { source_type: string | null; source_url: string | null; media_url: string | null }) {
  if ((asset.source_type === "gif" || asset.source_type === "sticker") && asset.source_url && isDirectGiphyGifUrl(asset.source_url)) {
    return asset.source_url;
  }
  return asset.media_url ?? "";
}

function displayPreviewUrl(asset: { source_type: string | null; source_url: string | null; preview_url: string | null }) {
  if ((asset.source_type === "gif" || asset.source_type === "sticker") && asset.source_url && isDirectGiphyGifUrl(asset.source_url)) {
    return asset.source_url;
  }
  return asset.preview_url;
}

function isDirectGiphyGifUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /\.gif$/i.test(url.pathname) &&
      (url.hostname === "giphy.com" ||
        url.hostname.endsWith(".giphy.com") ||
        url.hostname === "giphy.media" ||
        url.hostname.endsWith(".giphy.media"))
    );
  } catch {
    return false;
  }
}
