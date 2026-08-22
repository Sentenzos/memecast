import { adminCredentialsConfigured, authenticateAdmin, createAdminSession, safeRelativeReturnPath } from "../../../admin-auth";
import { clientIp, rejectCrossOriginRequest, rejectRemoteAdminRequest } from "../../../request-security";

export const dynamic = "force-dynamic";

type Attempt = { count: number; resetAt: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_TRACKED_IPS = 5000;

export async function POST(request: Request) {
  const remote = rejectRemoteAdminRequest(request);
  if (remote) return remote;
  const rejected = rejectCrossOriginRequest(request);
  if (rejected) return rejected;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 32 * 1024) return Response.json({ error: "Запрос слишком большой" }, { status: 413 });
  const form = await request.formData();
  const login = String(form.get("login") ?? "").slice(0, 128);
  const password = String(form.get("password") ?? "").slice(0, 512);
  const returnTo = safeRelativeReturnPath(String(form.get("return_to") ?? "/dashboard"));

  if (!adminCredentialsConfigured()) return redirectTo("/login?error=not_configured");

  const ip = clientIp(request);
  const now = Date.now();
  pruneAttempts(now);
  const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= MAX_ATTEMPTS) {
    const response = redirectTo(`/login?error=invalid&return_to=${encodeURIComponent(returnTo)}`);
    response.headers.set("retry-after", String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
    return response;
  }

  if (!await authenticateAdmin(login, password)) {
    attempts.set(ip, current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + WINDOW_MS });
    return redirectTo(`/login?error=invalid&return_to=${encodeURIComponent(returnTo)}`);
  }

  attempts.delete(ip);
  await createAdminSession();
  return redirectTo(returnTo);
}

function redirectTo(path: string) {
  return new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store" } });
}

function pruneAttempts(now: number) {
  for (const [ip, attempt] of attempts) {
    if (attempt.resetAt <= now) attempts.delete(ip);
  }
  while (attempts.size >= MAX_TRACKED_IPS) {
    const oldest = attempts.keys().next().value as string | undefined;
    if (!oldest) break;
    attempts.delete(oldest);
  }
}
