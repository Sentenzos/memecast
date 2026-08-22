import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import handler from "./dist/server/index.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const appOrigin = validateProductionConfiguration();
const defaultMaxRequestBytes = 256 * 1024;
const uploadMaxRequestBytes = 25 * 1024 * 1024;
const clientRoot = resolve("./dist/client");
const handleRequest = typeof handler === "function" ? handler : handler.fetch.bind(handler);

const server = createServer(async (incoming, outgoing) => {
  try {
    applySecurityHeaders(outgoing);
    const origin = appOrigin || `http://${incoming.headers.host || "localhost"}`;
    const url = new URL(incoming.url || "/", origin);
    const maxRequestBytes = requestLimit(url.pathname, incoming.method, incoming.headers["content-type"]);
    const contentLength = Number(incoming.headers["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      outgoing.writeHead(413, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: maxRequestBytes === uploadMaxRequestBytes ? "Запрос должен быть не больше 25 МБ" : "Запрос должен быть не больше 256 КБ" }));
      return;
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    if ((incoming.method === "GET" || incoming.method === "HEAD") && await serveStatic(url.pathname, incoming.method, outgoing)) return;
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const request = new Request(url, {
      method: incoming.method,
      headers,
      body: hasBody ? Readable.toWeb(incoming) : undefined,
      ...(hasBody ? { duplex: "half" } : {}),
    });
    const response = await handleRequest(request);

    outgoing.statusCode = response.status;
    outgoing.statusMessage = response.statusText;
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() !== "set-cookie") outgoing.setHeader(name, value);
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length) outgoing.setHeader("set-cookie", setCookies);
    if (!response.body) {
      outgoing.end();
      return;
    }
    Readable.fromWeb(response.body).pipe(outgoing);
  } catch (error) {
    console.error("[memecast] request failed", error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    outgoing.end("Internal Server Error");
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.listen(port, host, () => {
  console.log(`[memecast] listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function serveStatic(pathname, method, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const target = resolve(clientRoot, decoded.replace(/^\/+/, ""));
  if (target !== clientRoot && !target.startsWith(`${clientRoot}${sep}`)) return false;
  let info;
  try {
    info = await stat(target);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  response.statusCode = 200;
  response.setHeader("content-type", contentType(target));
  response.setHeader("content-length", String(info.size));
  response.setHeader("etag", `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`);
  response.setHeader("cache-control", decoded.startsWith("/_next/") ? "public, max-age=31536000, immutable" : "public, max-age=3600");
  if (method === "HEAD") response.end();
  else createReadStream(target).pipe(response);
  return true;
}

function contentType(pathname) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  })[extname(pathname).toLowerCase()] || "application/octet-stream";
}

function requestLimit(pathname, method, contentTypeHeader) {
  const isUpload = method === "POST" &&
    (pathname === "/api/admin/media" || pathname === "/api/admin/media-upload") &&
    String(contentTypeHeader || "").toLowerCase().startsWith("multipart/form-data");
  return isUpload ? uploadMaxRequestBytes : defaultMaxRequestBytes;
}

function applySecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("x-permitted-cross-domain-policies", "none");
  response.setHeader("content-security-policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://giphy.com https://*.giphy.com https://giphy.media https://*.giphy.media",
    "media-src 'self' data: blob: https://giphy.com https://*.giphy.com https://giphy.media https://*.giphy.media",
    "connect-src 'self'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
  ].join("; "));
}

function validateProductionConfiguration() {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return configured || null;
  if (!configured) throw new Error("APP_URL must be configured in production");
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("APP_URL must use http or https");
  if (configured !== parsed.origin) throw new Error("APP_URL must contain only the public origin, for example http://203.0.113.10");
  const login = process.env.ADMIN_LOGIN?.trim() || "";
  const password = process.env.ADMIN_PASSWORD || "";
  if (!login || login.length > 128) throw new Error("ADMIN_LOGIN must be configured and no longer than 128 characters");
  if (password.length < 16 || password === login || /replace-with|change-this|password/i.test(password)) {
    throw new Error("ADMIN_PASSWORD must be a unique password of at least 16 characters");
  }
  const localOnlyValue = process.env.ADMIN_LOCAL_ONLY?.trim().toLowerCase();
  if (localOnlyValue && localOnlyValue !== "true" && localOnlyValue !== "false") {
    throw new Error("ADMIN_LOCAL_ONLY must be true or false");
  }
  const localOnly = localOnlyValue ? localOnlyValue === "true" : parsed.protocol !== "https:";
  if (parsed.protocol !== "https:" && !localOnly) {
    console.warn("[memecast] WARNING: remote admin access over HTTP is enabled. Credentials and session cookies are not encrypted.");
  } else if (localOnly) {
    console.log("[memecast] admin access is restricted to localhost and SSH tunnels");
  }
  return parsed.origin;
}
