import { isIP } from "node:net";

export class RequestBodyTooLargeError extends Error {}

export function rejectCrossOriginRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  const supplied = request.headers.get("origin");
  let suppliedUrl: URL | null = null;
  if (supplied) {
    try {
      suppliedUrl = new URL(supplied);
    } catch {
      return Response.json({ error: "Запрос с другого сайта запрещён" }, { status: 403 });
    }
  }
  const tunneledAdminOrigin = Boolean(
    suppliedUrl &&
    adminLocalOnlyEnabled() &&
    isLoopbackIp(clientIp(request)) &&
    isLoopbackHostname(suppliedUrl.hostname),
  );
  if (fetchSite === "cross-site" && !tunneledAdminOrigin) {
    return Response.json({ error: "Запрос с другого сайта запрещён" }, { status: 403 });
  }
  if (!supplied) return null;
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    return Response.json({ error: "Некорректный адрес запроса" }, { status: 400 });
  }
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      allowed.add(new URL(configured).origin);
    } catch {
      // Production startup validates APP_URL. Ignore an invalid value in build-time tests.
    }
  }
  if (!suppliedUrl || (!allowed.has(suppliedUrl.origin) && !tunneledAdminOrigin)) {
    return Response.json({ error: "Запрос с другого сайта запрещён" }, { status: 403 });
  }
  return null;
}

export function rejectRemoteAdminRequest(request: Request) {
  if (!adminLocalOnlyEnabled() || isLoopbackIp(clientIp(request))) return null;
  return Response.json({ error: "Кабинет доступен только через локальное соединение или SSH-туннель" }, { status: 403 });
}

export function adminAccessAllowed(headers: { get(name: string): string | null }) {
  if (!adminLocalOnlyEnabled()) return true;
  return isLoopbackIp(clientIpFromHeaders(headers));
}

export async function readJsonBody<T>(request: Request, maxBytes = 16 * 1024): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyTooLargeError();
  if (!request.body) throw new SyntaxError("Missing request body");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text) as T;
}

export function clientIp(request: Request) {
  return clientIpFromHeaders(request.headers);
}

function clientIpFromHeaders(headers: { get(name: string): string | null }) {
  const realIp = firstHeaderValue(headers.get("x-real-ip"));
  if (realIp && isIP(realIp)) return normalizeIp(realIp);

  if (process.env.NODE_ENV !== "production") {
    const forwarded = firstHeaderValue(headers.get("x-forwarded-for"));
    if (forwarded && isIP(forwarded)) return normalizeIp(forwarded);
  }
  return process.env.NODE_ENV === "production" ? "unknown" : "local";
}

export function adminLocalOnlyEnabled() {
  const configured = process.env.ADMIN_LOCAL_ONLY?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  if (process.env.NODE_ENV !== "production") return false;
  try {
    return new URL(process.env.APP_URL || "http://localhost").protocol !== "https:";
  } catch {
    return true;
  }
}

function isLoopbackIp(value: string) {
  return value === "127.0.0.1" || value === "::1";
}

function isLoopbackHostname(value: string) {
  return value === "localhost" || value === "127.0.0.1" || value === "[::1]" || value === "::1";
}

export function apiError(error: unknown, fallback: string, context: string) {
  if (error instanceof RequestBodyTooLargeError) {
    return Response.json({ error: "Запрос слишком большой" }, { status: 413 });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Некорректный формат запроса" }, { status: 400 });
  }
  console.error(`[memecast] ${context}`, error);
  return Response.json({ error: fallback }, { status: 500 });
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? "";
}

function normalizeIp(value: string) {
  return value.startsWith("::ffff:") && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
}
