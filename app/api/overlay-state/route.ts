import { getD1, getStreamerByToken } from "../../../db";
import { apiError, readJsonBody, rejectCrossOriginRequest } from "../../request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossOriginRequest(request);
    if (rejected) return rejected;
    const payload = await readJsonBody<{ token?: string; alertId?: string; state?: "started" | "completed" }>(request, 2 * 1024);
    const token = payload.token?.trim() ?? "";
    const alertId = payload.alertId?.trim() ?? "";
    if (!token || token.length > 128 || !alertId || alertId.length > 128 || (payload.state !== "started" && payload.state !== "completed")) {
      return Response.json({ error: "Некорректное состояние оверлея" }, { status: 400 });
    }

    const streamer = await getStreamerByToken(token);
    if (!streamer) return Response.json({ error: "Оверлей не найден" }, { status: 404 });

    const now = Date.now();
    if (payload.state === "started") {
      await getD1().prepare(`UPDATE alerts
        SET started_at = COALESCE(started_at, ?), completed_at = NULL
        WHERE id = ? AND streamer_id = ?`)
        .bind(now, alertId, streamer.id).run();
    } else {
      await getD1().prepare(`UPDATE alerts
        SET started_at = COALESCE(started_at, ?), completed_at = ?
        WHERE id = ? AND streamer_id = ?`)
        .bind(now, now, alertId, streamer.id).run();
    }
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "Ошибка состояния оверлея", "overlay state update failed");
  }
}
