import { getAdminUser } from "../../../admin-auth";
import { ensureDatabase, ensureStreamerForOwner, getD1, getDemoStreamer, type StreamerRecord } from "../../../../db";
import { demoModeEnabled } from "../../../demo-mode";

export const dynamic = "force-dynamic";

async function streamerForRequest(request: Request): Promise<StreamerRecord | null> {
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

    const [history, blocked] = await Promise.all([
      getD1().prepare(`SELECT
          alerts.id,
          alerts.meme_id,
          alerts.message,
          alerts.viewer_name,
          alerts.viewer_ip,
          alerts.created_at,
          alerts.started_at,
          alerts.completed_at,
          meme_assets.tags,
          meme_assets.source_type,
          meme_assets.media_type,
          meme_assets.preview_url
        FROM alerts
        LEFT JOIN meme_assets ON meme_assets.id = alerts.meme_id
        WHERE alerts.streamer_id = ?
        ORDER BY alerts.created_at DESC LIMIT 100`)
        .bind(streamer.id)
        .all<HistoryRow>(),
      getD1().prepare(`SELECT id, ip_address, viewer_name, created_at
        FROM blocked_viewers WHERE streamer_id = ? ORDER BY created_at DESC`)
        .bind(streamer.id)
        .all<BlockedRow>(),
    ]);

    return Response.json({
      history: history.results.map((row) => ({
        id: row.id,
        memeId: row.meme_id,
        message: row.message,
        viewerName: row.viewer_name || "Зритель",
        ipAddress: row.viewer_ip,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        tags: row.tags?.split(",").filter(Boolean) ?? [],
        sourceType: row.source_type,
        mediaType: row.media_type,
        previewUrl: row.preview_url,
      })),
      blocked: blocked.results.map((row) => ({
        id: row.id,
        ipAddress: row.ip_address,
        viewerName: row.viewer_name,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка журнала" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const streamer = await streamerForRequest(request);
    if (!streamer) return Response.json({ error: "Нужно войти" }, { status: 401 });
    const payload = await request.json() as { action?: "block" | "unblock"; ipAddress?: string; viewerName?: string; id?: string };

    if (payload.action === "block") {
      const ipAddress = payload.ipAddress?.trim().slice(0, 180) ?? "";
      if (!ipAddress) return Response.json({ error: "IP недоступен для этого события" }, { status: 400 });
      const viewerName = payload.viewerName?.trim().replace(/\s+/g, " ").slice(0, 32) || null;
      await getD1().prepare(`INSERT INTO blocked_viewers (id, streamer_id, ip_address, viewer_name, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(streamer_id, ip_address) DO UPDATE SET viewer_name = excluded.viewer_name`)
        .bind(crypto.randomUUID(), streamer.id, ipAddress, viewerName, Date.now()).run();
      return Response.json({ ok: true });
    }

    if (payload.action === "unblock") {
      const id = payload.id?.trim() ?? "";
      if (!id) return Response.json({ error: "Не выбрана блокировка" }, { status: 400 });
      await getD1().prepare("DELETE FROM blocked_viewers WHERE id = ? AND streamer_id = ?")
        .bind(id, streamer.id).run();
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка блокировки" }, { status: 500 });
  }
}

type HistoryRow = {
  id: string;
  meme_id: string | null;
  message: string | null;
  viewer_name: string | null;
  viewer_ip: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  tags: string | null;
  source_type: string | null;
  media_type: string | null;
  preview_url: string | null;
};

type BlockedRow = { id: string; ip_address: string; viewer_name: string | null; created_at: number };
