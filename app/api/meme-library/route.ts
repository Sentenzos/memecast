import type { MemeDefinition } from "../../memes";
import { ensureDatabase, getD1, getStreamerBySlug, type MemeAssetRecord } from "../../../db";

export const dynamic = "force-dynamic";

type GiphyClip = {
  id?: string;
  title?: string;
  images?: {
    fixed_width?: { url?: string };
    fixed_width_still?: { url?: string };
    original?: { url?: string };
    original_still?: { url?: string };
  };
  video?: {
    description?: string;
    assets?: Record<string, { url?: string; width?: string | number; height?: string | number }>;
  };
};

const tones = ["violet", "lime", "orange", "blue", "pink", "yellow"];
const GIPHY_REFRESH_MS = 5 * 60 * 1000;
let nextGiphyRefreshAt = 0;

function apiKey() {
  return process.env.GIPHY_API_KEY;
}

function isGiphyUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "giphy.com" ||
      url.hostname.endsWith(".giphy.com") ||
      url.hostname === "giphy.media" ||
      url.hostname.endsWith(".giphy.media")
    );
  } catch {
    return false;
  }
}

function serialize(asset: MemeAssetRecord, index: number): MemeDefinition {
  const mediaType = asset.media_type ?? "video";
  const sourceType = asset.source_type ?? (asset.provider === "giphy" ? "clip" : "upload");
  const mediaUrl = displayMediaUrl(asset);
  if (asset.provider === "custom") {
    return {
      id: asset.id,
      emoji: sourceType === "sticker" ? "🏷️" : mediaType === "audio" ? "🔊" : mediaType === "image" ? "🖼️" : "🎬",
      title: asset.title,
      subtitle: mediaKind(sourceType, mediaType),
      tone: tones[index % tones.length],
      sound: "video",
      provider: "custom",
      previewUrl: displayPreviewUrl(asset) ?? undefined,
      mediaUrl,
      mediaType,
      sourceType,
      tags: parseTags(asset.tags),
      width: asset.width,
      height: asset.height,
    };
  }
  return {
    id: asset.id,
    emoji: "🎬",
    title: asset.title,
    subtitle: "CLIP",
    tone: tones[index % tones.length],
    sound: "video",
    provider: "giphy",
    previewUrl: asset.preview_url ?? undefined,
    mediaUrl: asset.media_url,
    mediaType: "video",
    sourceType: "clip",
    tags: parseTags(asset.tags),
    width: asset.width,
    height: asset.height,
  };
}

function mediaKind(sourceType: string, mediaType: string) {
  if (sourceType === "sticker") return "STICKER";
  if (sourceType === "clip" || mediaType === "video" || mediaType === "audio") return "CLIP";
  return "GIF";
}

function displayMediaUrl(asset: MemeAssetRecord) {
  if ((asset.source_type === "gif" || asset.source_type === "sticker") && asset.source_url && isDirectGiphyGifUrl(asset.source_url)) {
    return asset.source_url;
  }
  return asset.media_url;
}

function displayPreviewUrl(asset: MemeAssetRecord) {
  if (asset.source_type === "gif" || asset.source_type === "sticker") {
    const id = asset.source_url ? giphyIdFromUrl(asset.source_url) : null;
    if (id) return `https://media.giphy.com/media/${encodeURIComponent(id)}/giphy_s.gif`;
  }
  return asset.preview_url;
}

function giphyIdFromUrl(value: string) {
  try {
    const url = new URL(value);
    if (!isGiphyUrl(url.toString())) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "";
    if (/^giphy\.(?:gif|webp|mp4)$/i.test(last) && segments.length > 1) return segments.at(-2) ?? null;
    const directMatch = url.pathname.match(/\/media\/([^/]+)/i);
    if (directMatch?.[1]) return directMatch[1];
    const filenameId = last.match(/^([a-zA-Z0-9]+)\.(?:gif|webp|mp4)$/i)?.[1];
    if (filenameId && filenameId.toLowerCase() !== "giphy") return filenameId;
    return last.replace(/\.(?:gif|webp|mp4)$/i, "").match(/(?:^|-)([a-zA-Z0-9]+)$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isDirectGiphyGifUrl(value: string) {
  try {
    const url = new URL(value);
    return isGiphyUrl(url.toString()) && /\.gif$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function parseTags(value: string | null) {
  if (!value) return [];
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

async function customAssets(slug: string | null, search: string) {
  if (!slug) return [];
  const streamer = await getStreamerBySlug(slug).catch(() => null);
  if (!streamer) return [];
  const needle = `%${search.toLowerCase()}%`;
  if (search) {
    const rows = await getD1().prepare(`SELECT * FROM meme_assets
      WHERE provider = 'custom'
        AND provider_id LIKE ?
        AND lower(COALESCE(tags, '')) LIKE ?
      ORDER BY created_at DESC LIMIT 500`)
      .bind(`${streamer.id}:%`, needle).all<MemeAssetRecord>();
    return rows.results.map(serialize);
  }
  const rows = await getD1().prepare(`SELECT * FROM meme_assets
    WHERE provider = 'custom' AND provider_id LIKE ?
    ORDER BY created_at DESC LIMIT 500`)
    .bind(`${streamer.id}:%`).all<MemeAssetRecord>();
  return rows.results.map(serialize);
}

async function storedClips(offset = 0) {
  const rows = await getD1().prepare(`SELECT * FROM meme_assets
    WHERE provider = 'giphy' ORDER BY updated_at DESC LIMIT 6`).all<MemeAssetRecord>();
  return rows.results.map((asset, index) => serialize(asset, index + offset));
}

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const url = new URL(request.url);
    const slug = url.searchParams.get("streamerSlug")?.trim() ?? null;
    const search = url.searchParams.get("search")?.trim().slice(0, 50) ?? "";
    const custom = await customAssets(slug, search);
    const key = apiKey();
    if (!key) {
      return Response.json({
        provider: "giphy-clips",
        configured: false,
        clips: [...custom, ...await storedClips(custom.length)],
        message: "Для каталога GIPHY Clips нужен одобренный API-ключ.",
      });
    }

    const stored = await storedClips(custom.length);
    if (Date.now() < nextGiphyRefreshAt) {
      return Response.json({ provider: "giphy-clips", configured: true, clips: [...custom, ...stored] });
    }
    nextGiphyRefreshAt = Date.now() + GIPHY_REFRESH_MS;

    const endpoint = new URL("https://api.giphy.com/v1/clips/search");
    endpoint.searchParams.set("api_key", key);
    endpoint.searchParams.set("q", "funny meme reaction");
    endpoint.searchParams.set("limit", "6");
    endpoint.searchParams.set("rating", "pg");

    const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3500) });
    const payload = await response.json() as { data?: GiphyClip[]; meta?: { msg?: string } };
    if (response.status === 403) {
      throw new Error("Ключ найден, но для него не одобрен доступ к GIPHY Clips. Запросите доступ у clips@giphy.com.");
    }
    if (response.status === 401) {
      throw new Error("GIPHY отклонил API-ключ. Проверьте GIPHY_API_KEY и перезапустите сервер.");
    }
    if (!response.ok) throw new Error(payload.meta?.msg || "GIPHY Clips временно недоступен");

    const now = Date.now();
    const assets = (payload.data ?? []).flatMap((clip, index) => {
      const rendition = clip.video?.assets?.["360p"];
      const mediaUrl = rendition?.url ?? "";
      const previewUrl = clip.images?.fixed_width_still?.url ?? clip.images?.original_still?.url ?? clip.images?.fixed_width?.url ?? clip.images?.original?.url ?? null;
      if (!clip.id || !isGiphyUrl(mediaUrl) || (previewUrl && !isGiphyUrl(previewUrl))) return [];
      return [{
        id: `giphy:${clip.id}`,
        provider: "giphy",
        providerId: clip.id,
        title: (clip.title || clip.video?.description || "GIPHY Clip").trim().slice(0, 80),
        previewUrl,
        mediaUrl,
        width: Number(rendition?.width) || null,
        height: Number(rendition?.height) || null,
        index,
      }];
    });

    if (assets.length) {
      await getD1().batch(assets.map((asset) => getD1().prepare(`INSERT INTO meme_assets
        (id, provider, provider_id, title, preview_url, media_url, media_type, source_type, source_url, tags, mime_type, storage_key, size_bytes, width, height, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'video', 'clip', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          preview_url = excluded.preview_url,
          media_url = excluded.media_url,
          media_type = excluded.media_type,
          source_type = excluded.source_type,
          width = excluded.width,
          height = excluded.height,
          updated_at = excluded.updated_at`)
        .bind(asset.id, asset.provider, asset.providerId, asset.title, asset.previewUrl, asset.mediaUrl, asset.width, asset.height, now, now)));
    }

    const clips = assets.map((asset) => serialize({
      id: asset.id,
      provider: asset.provider,
      provider_id: asset.providerId,
      title: asset.title,
      preview_url: asset.previewUrl,
      media_url: asset.mediaUrl,
      media_type: "video",
      source_type: "clip",
      source_url: null,
      tags: null,
      mime_type: null,
      storage_key: null,
      size_bytes: null,
      width: asset.width,
      height: asset.height,
      created_at: now,
      updated_at: now,
    }, asset.index + custom.length));
    return Response.json({ provider: "giphy-clips", configured: true, clips: [...custom, ...clips] });
  } catch (error) {
    const url = new URL(request.url);
    const custom = await customAssets(url.searchParams.get("streamerSlug")?.trim() ?? null, url.searchParams.get("search")?.trim().slice(0, 50) ?? "").catch(() => []);
    const clips = [...custom, ...await storedClips(custom.length).catch(() => [])];
    return Response.json({
      provider: "giphy-clips",
      configured: true,
      clips,
      message: publicGiphyError(error),
    }, { status: clips.length ? 200 : 502 });
  }
}

function publicGiphyError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Ключ найден") || message.startsWith("GIPHY отклонил")) return message;
  return "GIPHY Clips временно недоступен";
}
