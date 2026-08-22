import { clearAdminSession } from "../../../admin-auth";
import { rejectCrossOriginRequest } from "../../../request-security";

export async function POST(request: Request) {
  const rejected = rejectCrossOriginRequest(request);
  if (rejected) return rejected;
  await clearAdminSession();
  return new Response(null, { status: 303, headers: { location: "/", "cache-control": "no-store" } });
}
