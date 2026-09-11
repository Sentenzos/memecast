import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, "public");
const configPath = join(root, "config.json");
const port = 43120;
let ffmpeg = null;
let metadataTimer = null;
let config = await loadConfig();
let lastArtworkSource = "";
let cachedArtwork = null;
let lastPublishedTrack = "";
let state = { running: false, message: "Готов к настройке", ffmpegLog: "", startedAt: null };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/api/config") return json(response, 200, config);
    if (request.method === "GET" && url.pathname === "/api/status") return json(response, 200, state);
    if (request.method === "GET" && url.pathname === "/api/devices") return json(response, 200, { devices: await listAudioDevices(config.ffmpegPath || "ffmpeg") });
    if (request.method === "POST" && url.pathname === "/api/start") {
      if (!isLocalWrite(request)) return json(response, 403, { error: "Запрос отклонён" });
      const next = validateConfig(await readJson(request));
      await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      config = next;
      await startBroadcast();
      return json(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/stop") {
      if (!isLocalWrite(request)) return json(response, 403, { error: "Запрос отклонён" });
      await stopBroadcast();
      return json(response, 200, { ok: true });
    }
    if (request.method === "GET") return serveFile(url.pathname, response);
    return json(response, 404, { error: "Не найдено" });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : "Ошибка Broadcaster" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`MemeCast Broadcaster: http://127.0.0.1:${port}`);
  spawn("cmd", ["/c", "start", "", `http://127.0.0.1:${port}`], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
});

async function startBroadcast() {
  await stopBroadcast(false);
  const streamId = `publish:radio/${config.slug}:${config.publishUser}:${config.publishPassword}`;
  const destination = `srt://${config.publishHost}:8890?streamid=${streamId}&pkt_size=1316&latency=250000&passphrase=${config.srtPassphrase}&pbkeylen=16`;
  const args = [
    "-hide_banner", "-loglevel", "warning",
    "-thread_queue_size", "1024", "-f", "dshow", "-i", `audio=${config.audioDevice}`,
    "-vn", "-c:a", "aac", "-profile:a", "aac_low", "-b:a", `${config.bitrateKbps}k`, "-ar", "48000", "-ac", "2",
    "-mpegts_flags", "+resend_headers", "-f", "mpegts", destination,
  ];
  const child = spawn(config.ffmpegPath || "ffmpeg", args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  ffmpeg = child;
  state = { running: true, message: "Подключаем аудиопоток к MemeCast…", ffmpegLog: "", startedAt: Date.now() };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    state.ffmpegLog = redactFfmpegLog(`${state.ffmpegLog}${chunk}`).slice(-4000);
    state.message = /error|failed|unable/i.test(chunk) ? "FFmpeg сообщил об ошибке — откройте журнал ниже" : "Аудиопоток отправляется на VPS";
  });
  child.once("error", (error) => {
    if (ffmpeg !== child) return;
    state = { ...state, running: false, message: `Не удалось запустить FFmpeg: ${error.message}` };
  });
  child.once("exit", (code) => {
    if (ffmpeg !== child) return;
    ffmpeg = null;
    state = { ...state, running: false, message: code === 0 ? "Эфир остановлен" : `FFmpeg завершился с кодом ${code}` };
    void publishMetadata(false).catch(() => undefined);
  });
  metadataTimer = setInterval(() => void publishMetadata(true).catch((error) => {
    state.message = `Поток работает, но сервер метаданных не отвечает: ${error.message}`;
  }), 2_000);
  await publishMetadata(true);
}

async function stopBroadcast(publishOffline = true) {
  if (metadataTimer) clearInterval(metadataTimer);
  metadataTimer = null;
  const process = ffmpeg;
  ffmpeg = null;
  if (process && !process.killed) process.kill("SIGTERM");
  state = { ...state, running: false, message: "Эфир остановлен" };
  if (publishOffline && config.overlayToken && config.siteUrl) await publishMetadata(false).catch(() => undefined);
}

async function publishMetadata(allowLive) {
  if (!config.overlayToken || !config.siteUrl) return;
  let session = null;
  try {
    const response = await fetch(config.smtcUrl, { signal: AbortSignal.timeout(1_500) });
    const payload = await response.json();
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    session = sessions.find((item) => /apple\s*music|applemusic/i.test(String(item.source_app_id || "")) && item.playback_info?.PlaybackStatus === 4)
      ?? sessions.find((item) => item.playback_info?.PlaybackStatus === 4)
      ?? null;
  } catch {
    state.message = state.running ? "Аудио отправляется, но SMTC Bridge не отвечает" : state.message;
  }
  const media = session?.media_properties ?? {};
  const timeline = session?.timeline_properties ?? {};
  const artwork = session ? await artworkDataUrl(media.Thumbnail) : null;
  const live = Boolean(allowLive && ffmpeg && session && media.Title && (media.Artist || media.AlbumArtist));
  const trackKey = [media.Title, media.Artist || media.AlbumArtist, media.AlbumTitle].map((value) => String(value || "")).join("\u0000");
  const response = await fetch(new URL("/api/broadcast-state", config.siteUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${config.overlayToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      live,
      title: media.Title || null,
      artist: media.Artist || media.AlbumArtist || null,
      album: media.AlbumTitle || null,
      artworkDataUrl: live && trackKey !== lastPublishedTrack ? artwork : null,
      positionMs: Number(timeline.Position || 0),
      durationMs: Number(timeline.EndTime || timeline.MaxSeekTime || 0),
      sourceUpdatedAt: Date.now(),
    }),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`MemeCast API: HTTP ${response.status}`);
  lastPublishedTrack = live ? trackKey : "";
}

async function artworkDataUrl(source) {
  if (!source || typeof source !== "string") return null;
  if (source === lastArtworkSource) return cachedArtwork;
  lastArtworkSource = source;
  cachedArtwork = null;
  let bytes = null;
  let mimeType = null;
  const dataUrl = source.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([a-z0-9+/=\s]+)$/i);
  const compactBase64 = (dataUrl?.[1] ?? source).replace(/\s+/g, "");
  if (compactBase64.length >= 16 && compactBase64.length <= 6 * 1024 * 1024 && /^[a-z0-9+/]+={0,2}$/i.test(compactBase64)) {
    bytes = Buffer.from(compactBase64, "base64");
    mimeType = imageMimeType(bytes);
  }
  try {
    if (!bytes) {
      const parsed = new URL(source);
      if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname)) return null;
      const response = await fetch(parsed, { signal: AbortSignal.timeout(1_500) });
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 4 * 1024 * 1024) return null;
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > 4 * 1024 * 1024) return null;
      mimeType = imageMimeType(bytes);
    }
    if (!mimeType || !bytes?.length) return null;
    if (bytes.byteLength > 130 * 1024) {
      bytes = await compressArtwork(bytes, config.ffmpegPath || "ffmpeg");
      mimeType = bytes ? "image/jpeg" : null;
    }
    if (!mimeType || !bytes || bytes.byteLength > 130 * 1024) return null;
    cachedArtwork = `data:${mimeType};base64,${bytes.toString("base64")}`;
    return cachedArtwork;
  } catch { return null; }
}

function imageMimeType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function compressArtwork(bytes, ffmpegPath) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath || "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-vf", "scale=384:384:force_original_aspect_ratio=decrease",
      "-frames:v", "1", "-an", "-c:v", "mjpeg", "-q:v", "5",
      "-f", "image2pipe", "pipe:1",
    ], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const chunks = [];
    let outputSize = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, 5_000);
    child.stdout.on("data", (chunk) => {
      outputSize += chunk.length;
      if (outputSize > 150 * 1024) {
        child.kill("SIGKILL");
        finish(null);
      } else chunks.push(chunk);
    });
    child.once("error", () => finish(null));
    child.once("exit", (code) => finish(code === 0 ? Buffer.concat(chunks) : null));
    child.stdin.on("error", () => undefined);
    child.stdin.end(bytes);
  });
}

async function listAudioDevices(ffmpegPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath || "ffmpeg", ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], { windowsHide: true });
    let output = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", () => {
      const devices = [];
      for (const line of output.split(/\r?\n/)) {
        const match = !/Alternative name/i.test(line) ? line.match(/"([^"]+)"\s+\(audio\)/i) : null;
        if (match && !devices.includes(match[1])) devices.push(match[1]);
      }
      resolve(devices);
    });
  });
}

function validateConfig(value) {
  const siteUrl = new URL(String(value.siteUrl || "").replace(/\/+$/, ""));
  if (!/^https?:$/.test(siteUrl.protocol)) throw new Error("Укажите адрес MemeCast с http:// или https://");
  const result = {
    siteUrl: siteUrl.origin,
    publishHost: String(value.publishHost || siteUrl.hostname).trim(),
    slug: String(value.slug || "").trim().toLowerCase(),
    overlayToken: String(value.overlayToken || "").trim(),
    publishUser: String(value.publishUser || "").trim(),
    publishPassword: String(value.publishPassword || "").trim(),
    srtPassphrase: String(value.srtPassphrase || "").trim(),
    audioDevice: String(value.audioDevice || "").trim(),
    ffmpegPath: String(value.ffmpegPath || "ffmpeg").trim(),
    bitrateKbps: Math.min(192, Math.max(64, Number(value.bitrateKbps) || 128)),
    smtcUrl: String(value.smtcUrl || "http://127.0.0.1:5000/now-playing").trim(),
  };
  if (!/^[a-z0-9_-]{3,40}$/.test(result.slug)) throw new Error("Некорректный адрес стримера");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(result.overlayToken)) throw new Error("Некорректный OBS/Broadcaster-токен");
  for (const [name, text] of [["Логин публикации", result.publishUser], ["Пароль публикации", result.publishPassword]]) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(text)) throw new Error(`${name}: используйте 8–80 латинских букв, цифр, _ или -`);
  }
  if (!/^[a-zA-Z0-9_-]{10,79}$/.test(result.srtPassphrase)) throw new Error("SRT-пароль должен содержать 10–79 латинских букв или цифр");
  if (!result.publishHost || !result.audioDevice) throw new Error("Выберите аудиоустройство и адрес VPS");
  return result;
}

async function loadConfig() {
  try { return JSON.parse(await readFile(configPath, "utf8")); }
  catch { return { ffmpegPath: "ffmpeg", bitrateKbps: 128, smtcUrl: "http://127.0.0.1:5000/now-playing" }; }
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32 * 1024) throw new Error("Слишком большой запрос");
  }
  return JSON.parse(body);
}

function isLocalWrite(request) {
  const origin = request.headers.origin;
  return !origin || origin === `http://127.0.0.1:${port}`;
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(payload));
}

function redactFfmpegLog(value) {
  return String(value)
    .replace(/(streamid=)[^&\s]+/gi, "$1[скрыто]")
    .replace(/([?&]passphrase=)[^&\s]+/gi, "$1[скрыто]");
}

function serveFile(pathname, response) {
  const file = pathname === "/" ? join(publicRoot, "index.html") : join(publicRoot, pathname.replace(/^\/+/, ""));
  if (!file.startsWith(publicRoot)) return json(response, 404, { error: "Не найдено" });
  response.writeHead(200, { "content-type": extname(file) === ".js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", "x-content-type-options": "nosniff" });
  createReadStream(file).on("error", () => response.destroy()).pipe(response);
}

async function shutdown() {
  await stopBroadcast();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
