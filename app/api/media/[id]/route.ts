import { ensureDatabase, getD1, type MemeAssetRecord } from "../../../../db";
import { readMediaFile } from "../../../../storage/local-media";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const { id } = await params;
    const asset = await getD1().prepare("SELECT * FROM meme_assets WHERE id = ? AND provider = ? LIMIT 1")
      .bind(id, "custom").first<MemeAssetRecord>();
    if (!asset?.storage_key) return new Response("Not found", { status: 404 });

    const isPreview = new URL(request.url).searchParams.get("preview") === "1";
    const bytes = await readMediaFile(isPreview ? `${asset.storage_key}.poster.png` : asset.storage_key);
    if (!bytes) return new Response("Not found", { status: 404 });

    const headers = new Headers();
    headers.set("content-type", isPreview ? "image/png" : asset.mime_type || "application/octet-stream");
    headers.set("etag", `W/"${asset.updated_at}-${bytes.byteLength}"`);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("accept-ranges", "bytes");
    const range = parseRange(request.headers.get("range"), bytes.byteLength);
    if (range) {
      const body = bytes.subarray(range.start, range.end + 1);
      headers.set("content-range", `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
      headers.set("content-length", String(body.byteLength));
      return new Response(body, { status: 206, headers });
    }
    headers.set("content-length", String(bytes.byteLength));
    return new Response(bytes, { headers });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Media error", { status: 500 });
  }
}

function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  const start = requestedStart ?? Math.max(0, size - (requestedEnd ?? 0));
  const end = Math.min(size - 1, requestedEnd ?? size - 1);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) return null;
  return { start, end };
}
