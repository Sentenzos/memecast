import { ensureDatabase, getD1, type MemeAssetRecord } from "../../../../db";
import { mediaFileSize, mediaFileStream } from "../../../../storage/local-media";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const { id } = await params;
    const asset = await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? AND provider = ? LIMIT 1")
      .bind(id, "custom").first<MemeAssetRecord>();
    if (!asset?.storage_key) return new Response("Not found", { status: 404 });

    const isPreview = new URL(request.url).searchParams.get("preview") === "1";
    const storageKey = isPreview ? `${asset.storage_key}.poster.png` : asset.storage_key;
    const size = await mediaFileSize(storageKey);
    if (size === null) return new Response("Not found", { status: 404 });

    const headers = new Headers();
    headers.set("content-type", isPreview ? "image/png" : asset.mime_type || "application/octet-stream");
    headers.set("etag", `W/"${asset.updated_at}-${size}"`);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("accept-ranges", "bytes");
    headers.set("x-content-type-options", "nosniff");
    const range = parseRange(request.headers.get("range"), size);
    if (range.kind === "invalid") {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range.kind === "range") {
      headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
      headers.set("content-length", String(range.end - range.start + 1));
      return new Response(mediaFileStream(storageKey, range), { status: 206, headers });
    }
    headers.set("content-length", String(size));
    return new Response(mediaFileStream(storageKey), { headers });
  } catch (error) {
    console.error("[memecast] media delivery failed", error);
    return new Response("Media error", { status: 500 });
  }
}

function parseRange(value: string | null, size: number) {
  if (!value) return { kind: "none" } as const;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return { kind: "invalid" } as const;
  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  const start = requestedStart ?? Math.max(0, size - (requestedEnd ?? 0));
  const end = Math.min(size - 1, requestedEnd ?? size - 1);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) return { kind: "invalid" } as const;
  return { kind: "range", start, end } as const;
}
