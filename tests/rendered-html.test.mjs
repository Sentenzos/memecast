import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(workerUrl.href);
  const request = new Request(`http://localhost${path}`, { headers: { accept: "text/html", "x-real-ip": "127.0.0.1" } });
  if (typeof handler === "function") return handler(request);
  return handler.fetch(request);
}

test("renders the MemeCast public channel", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>MemeCast — мемы прямо на стрим<\/title>/i);
  assert.doesNotMatch(html, /Демо-стример/);
  assert.match(html, /class="brand" href="\/"/);
  assert.match(html, /Имя в эфире/);
  assert.match(html, /Таймаут/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("renders the streamer sign-in page", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Войти в кабинет/);
  assert.match(html, /name="login"/);
  assert.match(html, /name="password"/);
  assert.doesNotMatch(html, /Twitch Client|api\/twitch/i);
  assert.doesNotMatch(html, /SSH-туннель|\.env|Открыть демо без входа/);
});

test("hides alert visuals on schedule while speech finishes and fits long text inside the viewport", async () => {
  const overlaySource = await readFile(new URL("../app/OverlayPlayer.tsx", import.meta.url), "utf8");
  assert.match(overlaySource, /setTimeout\(\(\) => setHiddenAlertId\(alert\.id\), settings\.textDisplaySeconds \* 1000\)/);
  assert.match(overlaySource, /await speak\(alert\.message, settings\.ttsVoice\)/);
  assert.match(overlaySource, /overlay-visual-hidden/);
  assert.doesNotMatch(overlaySource, /keepTextVisibleUntilSpeechEnds/);
  assert.doesNotMatch(overlaySource, /Promise\.race\(\[speak\(/);
  assert.match(overlaySource, /viewport\.width - 88/);
  assert.match(overlaySource, /width: `\$\{visibleAlertWidth\}px`/);
  assert.match(overlaySource, /maxWidth: `\$\{visibleTextWidth\}px`/);
  assert.match(overlaySource, /maxHeight: `\$\{visibleTextHeight\}px`/);
  assert.doesNotMatch(overlaySource, /width: `\$\{visibleTextWidth\}px`/);
  assert.match(overlaySource, /element\.scrollHeight <= element\.clientHeight/);
  assert.match(overlaySource, /trimEnd\(\)\}…/);
});

test("sizes the text card to its content and aligns text to the left", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.overlay-text\s*\{[^}]*width: fit-content;[^}]*height: fit-content;/s);
  assert.match(styles, /\.overlay-text\s*\{[^}]*padding: 13px 16px;[^}]*text-align: left;/s);
  assert.doesNotMatch(styles, /\.overlay-pos-[^{]+ \.overlay-text\s*\{\s*text-align:/);
});

test("plays the notification sound for text-only alerts", async () => {
  const overlaySource = await readFile(new URL("../app/OverlayPlayer.tsx", import.meta.url), "utf8");
  const soundSource = await readFile(new URL("../app/sound.ts", import.meta.url), "utf8");
  assert.match(overlaySource, /alert\.meme\.id\.startsWith\("text:"\)/);
  assert.match(overlaySource, /!isTextOnlyAlert \? \(/);
  assert.match(soundSource, /meme-notification\.mp3\?v=hadouken-20260828/);
  assert.match(soundSource, /setTimeout\(finish, 2000\)/);
});

test("shows a live music player backed by the broadcast API", async () => {
  const channelSource = await readFile(new URL("../app/PublicChannel.tsx", import.meta.url), "utf8");
  const playerSource = await readFile(new URL("../app/MusicBroadcastPlayer.tsx", import.meta.url), "utf8");
  const dashboardSource = await readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
  const relayConfig = await readFile(new URL("../mediamtx.yml", import.meta.url), "utf8");
  const broadcasterSource = await readFile(new URL("../broadcaster/app.mjs", import.meta.url), "utf8");
  assert.match(channelSource, /<MusicBroadcastPlayer slug=\{slug\}/);
  assert.match(playerSource, /api\/broadcast-state/);
  assert.match(playerSource, /new Hls/);
  assert.match(playerSource, /broadcast\.hlsUrl/);
  assert.match(playerSource, /aria-label="Громкость музыки"/);
  assert.match(playerSource, /audioRef\.current\.volume = volume/);
  assert.match(dashboardSource, /MemeCast Broadcaster/);
  assert.match(dashboardSource, /Токен метаданных/);
  assert.ok(Number(relayConfig.match(/^hlsSegmentCount:\s*(\d+)/m)?.[1]) >= 7);
  assert.match(broadcasterSource, /redactFfmpegLog/);
  assert.match(broadcasterSource, /compactBase64/);
  assert.match(broadcasterSource, /imageMimeType/);
});
