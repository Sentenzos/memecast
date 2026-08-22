import { getAdminUser } from "../../../admin-auth";
import { ensureDatabase, getD1, getDemoStreamer, ensureStreamerForOwner, type MemeAssetRecord } from "../../../../db";
import { deleteMediaFile, writeMediaFile } from "../../../../storage/local-media";
import { demoModeEnabled } from "../../../demo-mode";

export const dynamic = "force-dynamic";

const allowedTypes = new Map<string, "video" | "audio" | "image">([
  ["video/mp4", "video"],
  ["video/webm", "video"],
  ["video/ogg", "video"],
  ["audio/mpeg", "audio"],
  ["audio/mp3", "audio"],
  ["audio/wav", "audio"],
  ["audio/ogg", "audio"],
  ["image/gif", "image"],
  ["image/png", "image"],
  ["image/jpeg", "image"],
]);

function serialize(asset: MemeAssetRecord, index: number) {
  const mediaType = asset.media_type ?? "video";
  const sourceType = asset.source_type ?? "upload";
  const mediaUrl = displayMediaUrl(asset);
  return {
    id: asset.id,
    emoji: sourceType === "sticker" ? "🏷️" : mediaType === "audio" ? "🔊" : mediaType === "image" ? "🖼️" : "🎬",
    title: asset.title,
    subtitle: mediaKind(sourceType, mediaType),
    tone: ["violet", "lime", "orange", "blue", "pink", "yellow"][index % 6],
    sound: "video" as const,
    provider: "custom" as const,
    previewUrl: displayPreviewUrl(asset) ?? undefined,
    mediaUrl,
    mediaType,
    sourceType,
    tags: parseStoredTags(asset.tags),
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
    if (id) return giphyStillUrl(id);
  }
  return asset.preview_url;
}

function parseStoredTags(value: string | null) {
  if (!value) return [];
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function normalizeTags(value: unknown) {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return raw
    .split(/[,\n#]+/)
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean)
    .slice(0, 12)
    .join(",");
}

function giphyIdFromUrl(value: string) {
  try {
    const url = new URL(value);
    if (!isGiphyHost(url.hostname)) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "";
    if (/^giphy\.(?:gif|webp|mp4)$/i.test(last) && segments.length > 1) return segments.at(-2) ?? null;
    const directMatch = url.pathname.match(/\/media\/([^/]+)/i);
    if (directMatch?.[1]) return directMatch[1];
    const filenameId = last.match(/^([a-zA-Z0-9]+)\.(?:gif|webp|mp4)$/i)?.[1];
    if (filenameId && filenameId.toLowerCase() !== "giphy") return filenameId;
    const slugMatch = last.replace(/\.(?:gif|webp|mp4)$/i, "").match(/(?:^|-)([a-zA-Z0-9]+)$/);
    return slugMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

function giphyStillUrl(id: string) {
  return `https://media.giphy.com/media/${encodeURIComponent(id)}/giphy_s.gif`;
}

function isDirectGiphyGifUrl(value: string) {
  try {
    const url = new URL(value);
    return isGiphyHost(url.hostname) && /\.gif$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isGiphyHost(hostname: string) {
  return hostname === "giphy.com" ||
    hostname.endsWith(".giphy.com") ||
    hostname === "giphy.media" ||
    hostname.endsWith(".giphy.media");
}

function normalizeGiphyLink(value: string) {
  const url = value.trim();
  const id = giphyIdFromUrl(url);
  if (isDirectGiphyGifUrl(url)) {
    return {
      providerId: id ?? crypto.randomUUID(),
      mediaUrl: url,
      previewUrl: id ? giphyStillUrl(id) : url,
      mediaType: "image" as const,
    };
  }

  if (!id) throw new Error("Не получилось распознать GIPHY-ссылку");

  const mediaUrl = `https://i.giphy.com/media/${encodeURIComponent(id)}/giphy.gif`;
  return { providerId: id, mediaUrl, previewUrl: giphyStillUrl(id), mediaType: "image" as const };
}

async function streamerForRequest(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("demo") === "1" && demoModeEnabled()) return getDemoStreamer();

  const user = await getAdminUser();
  if (!user) return null;
  return ensureStreamerForOwner(user.userId, user.displayName);
}

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const streamer = await streamerForRequest(request);
    if (!streamer) return Response.json({ error: "Нужно войти" }, { status: 401 });

    const rows = await getD1().prepare(`SELECT * FROM meme_assets
      WHERE provider = ? AND provider_id LIKE ?
      ORDER BY created_at DESC`)
      .bind("custom", `${streamer.id}:%`)
      .all<MemeAssetRecord>();

    return Response.json({ assets: rows.results.map(serialize) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка библиотеки" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const streamer = await streamerForRequest(request);
    if (!streamer) return Response.json({ error: "Нужно войти" }, { status: 401 });

    if (request.headers.get("content-type")?.includes("application/json")) {
      const payload = await request.json() as { url?: string; sourceType?: "gif" | "sticker"; title?: string; tags?: string[] | string };
      const sourceType = payload.sourceType;
      const sourceUrl = payload.url?.trim() ?? "";
      if (!sourceUrl || (sourceType !== "gif" && sourceType !== "sticker")) {
        return Response.json({ error: "Укажи GIPHY-ссылку и тип: gif или sticker" }, { status: 400 });
      }
      const tags = normalizeTags(payload.tags);
      if (!tags) return Response.json({ error: "Добавь хотя бы один тег" }, { status: 400 });
      const normalized = normalizeGiphyLink(sourceUrl);
      const now = Date.now();
      const id = `custom:${crypto.randomUUID()}`;
      const title = id;
      const providerId = `${streamer.id}:${sourceType}:${normalized.providerId}`;

      const existing = await getD1().prepare("SELECT * FROM meme_assets WHERE provider = ? AND provider_id = ? LIMIT 1")
        .bind("custom", providerId).first<MemeAssetRecord>();
      if (existing) {
        await getD1().prepare("UPDATE meme_assets SET tags = ?, preview_url = ?, media_url = ?, source_url = ?, updated_at = ? WHERE id = ?")
          .bind(tags, normalized.previewUrl, normalized.mediaUrl, sourceUrl, now, existing.id).run();
        const updated = await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? LIMIT 1")
          .bind(existing.id).first<MemeAssetRecord>();
        if (!updated) throw new Error("Ссылка обновлена, но запись не найдена");
        return Response.json({ asset: serialize(updated, 0), existing: true });
      }

      await getD1().prepare(`INSERT INTO meme_assets
        (id, provider, provider_id, title, preview_url, media_url, media_type, source_type, source_url, tags, mime_type, storage_key, size_bytes, width, height, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`)
        .bind(id, "custom", providerId, title, normalized.previewUrl, normalized.mediaUrl, normalized.mediaType, sourceType, sourceUrl, tags || null, now, now)
        .run();

      const asset = await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? LIMIT 1")
        .bind(id).first<MemeAssetRecord>();
      if (!asset) throw new Error("Ссылка добавлена, но запись не найдена");
      return Response.json({ asset: serialize(asset, 0) }, { status: 201 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const poster = form.get("poster");
    const tags = normalizeTags(form.get("tags"));
    const width = positiveInt(form.get("width"));
    const height = positiveInt(form.get("height"));
    if (!(file instanceof File)) return Response.json({ error: "Выбери медиафайл" }, { status: 400 });
    if (!tags) return Response.json({ error: "Добавь хотя бы один тег" }, { status: 400 });
    const mediaType = allowedTypes.get(file.type);
    if (!mediaType) return Response.json({ error: "Поддерживаются mp4, webm, mp3, wav, ogg, gif, png и jpg" }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Файл должен быть до 20 МБ" }, { status: 400 });

    const id = `custom:${crypto.randomUUID()}`;
    const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
    const storageKey = `${streamer.id}/${id}.${extension}`;
    const bytes = await file.arrayBuffer();
    await writeMediaFile(storageKey, bytes);
    const hasPoster = poster instanceof File && poster.type === "image/png" && poster.size > 0;
    if (hasPoster) await writeMediaFile(`${storageKey}.poster.png`, await poster.arrayBuffer());

    const now = Date.now();
    const assetTitle = id;
    const mediaUrl = `/api/media/${encodeURIComponent(id)}`;
    await getD1().prepare(`INSERT INTO meme_assets
      (id, provider, provider_id, title, preview_url, media_url, media_type, source_type, source_url, tags, mime_type, storage_key, size_bytes, width, height, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, "custom", `${streamer.id}:${id}`, assetTitle, hasPoster && mediaType !== "audio" ? `${mediaUrl}?preview=1` : mediaType === "audio" ? null : mediaUrl, mediaUrl, mediaType, tags || null, file.type, storageKey, file.size, width, height, now, now)
      .run();

    const asset = await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? LIMIT 1")
      .bind(id).first<MemeAssetRecord>();
    if (!asset) throw new Error("Файл загружен, но запись не найдена");
    return Response.json({ asset: serialize(asset, 0) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка загрузки" }, { status: 500 });
  }
}

function positiveInt(value: FormDataEntryValue | null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const streamer = await streamerForRequest(request);
    if (!streamer) return Response.json({ error: "Нужно войти" }, { status: 401 });

    const payload = await request.json() as { id?: string; tags?: string[] | string };
    const id = payload.id?.trim() ?? "";
    if (!id) return Response.json({ error: "Укажи медиа" }, { status: 400 });
    const tags = normalizeTags(payload.tags);
    if (!tags) return Response.json({ error: "Добавь хотя бы один тег" }, { status: 400 });

    const asset = await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? AND provider = ? AND provider_id LIKE ? LIMIT 1")
      .bind(id, "custom", `${streamer.id}:%`).first<MemeAssetRecord>();
    if (!asset) return Response.json({ error: "Файл не найден" }, { status: 404 });

    await getD1().prepare("UPDATE meme_assets SET tags = ?, updated_at = ? WHERE id = ?")
      .bind(tags, Date.now(), id).run();

    const updated = await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? LIMIT 1")
      .bind(id).first<MemeAssetRecord>();
    if (!updated) throw new Error("Медиа обновлено, но запись не найдена");
    return Response.json({ asset: serialize(updated, 0) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка сохранения медиа" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDatabase();
    const streamer = await streamerForRequest(request);
    if (!streamer) return Response.json({ error: "Нужно войти" }, { status: 401 });

    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return Response.json({ error: "Не указан файл" }, { status: 400 });
    const asset = await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? AND provider = ? AND provider_id LIKE ? LIMIT 1")
      .bind(id, "custom", `${streamer.id}:%`).first<MemeAssetRecord>();
    if (!asset) return Response.json({ error: "Файл не найден" }, { status: 404 });

    if (asset.storage_key) {
      await Promise.all([
        deleteMediaFile(asset.storage_key).catch(() => undefined),
        deleteMediaFile(`${asset.storage_key}.poster.png`).catch(() => undefined),
      ]);
    }
    await getD1().prepare("DELETE FROM meme_assets WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка удаления" }, { status: 500 });
  }
}
