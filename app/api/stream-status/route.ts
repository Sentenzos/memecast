import { getD1, getStreamerBySlug } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get("streamerSlug")?.trim() ?? "";
    if (!slug) return Response.json({ error: "Не указан стример" }, { status: 400 });
    const streamer = await getStreamerBySlug(slug);
    if (!streamer) return Response.json({ error: "Стример не найден" }, { status: 404 });

    const active = await getD1().prepare(`SELECT viewer_name
      FROM alerts
      WHERE streamer_id = ? AND started_at IS NOT NULL AND completed_at IS NULL AND started_at > ?
      ORDER BY started_at DESC LIMIT 1`)
      .bind(streamer.id, Date.now() - 120_000)
      .first<{ viewer_name: string | null }>();

    return Response.json({ busy: Boolean(active), viewerName: active?.viewer_name ?? undefined });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка статуса стрима" }, { status: 500 });
  }
}
