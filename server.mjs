import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import handler from "./dist/server/index.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const maxRequestBytes = 25 * 1024 * 1024;
const clientRoot = resolve("./dist/client");
const handleRequest = typeof handler === "function" ? handler : handler.fetch.bind(handler);

const server = createServer(async (incoming, outgoing) => {
  try {
    const contentLength = Number(incoming.headers["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      outgoing.writeHead(413, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: "Запрос должен быть не больше 25 МБ" }));
      return;
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const origin = process.env.APP_URL?.replace(/\/+$/, "") || `http://${headers.get("host") || "localhost"}`;
    const url = new URL(incoming.url || "/", origin);
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
