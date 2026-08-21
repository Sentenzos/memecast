import { ensureDatabase, getD1 } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();
    await getD1().prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
