import { adminCredentialsConfigured, authenticateAdmin, createAdminSession, safeRelativeReturnPath } from "../../../admin-auth";
import { publicOrigin } from "../../../public-origin";

export const dynamic = "force-dynamic";

type Attempt = { count: number; resetAt: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export async function POST(request: Request) {
  const origin = publicOrigin(request);
  const form = await request.formData();
  const login = String(form.get("login") ?? "");
  const password = String(form.get("password") ?? "");
  const returnTo = safeRelativeReturnPath(String(form.get("return_to") ?? "/dashboard"));

  if (!adminCredentialsConfigured()) return redirectTo(origin, "/login?error=not_configured");

  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= MAX_ATTEMPTS) {
    return redirectTo(origin, `/login?error=invalid&return_to=${encodeURIComponent(returnTo)}`);
  }

  if (!await authenticateAdmin(login, password)) {
    attempts.set(ip, current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + WINDOW_MS });
    return redirectTo(origin, `/login?error=invalid&return_to=${encodeURIComponent(returnTo)}`);
  }

  attempts.delete(ip);
  await createAdminSession();
  return redirectTo(origin, returnTo);
}

function redirectTo(origin: string, path: string) {
  return Response.redirect(new URL(path, origin), 303);
}
