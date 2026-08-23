import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const testId = `${process.pid}-${Date.now()}`;
const databasePath = resolve(`work/security-${testId}.sqlite`);
process.env.NODE_ENV = "production";
process.env.APP_URL = "http://localhost";
process.env.ADMIN_LOGIN = "security-admin";
process.env.ADMIN_PASSWORD = "security-test-credential-42";
process.env.DATABASE_PATH = databasePath;
process.env.MEDIA_ROOT = resolve(`work/security-media-${testId}`);
process.env.ENABLE_DEMO_MODE = "false";
process.env.ADMIN_LOCAL_ONLY = "false";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("security-test", testId);
const { default: exportedHandler } = await import(workerUrl.href);
const handler = typeof exportedHandler === "function" ? exportedHandler : exportedHandler.fetch.bind(exportedHandler);

function call(path, options = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has("x-real-ip")) headers.set("x-real-ip", "198.51.100.10");
  return handler(new Request(`http://localhost${path}`, { ...options, headers }));
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie") ?? "";
  return value.split(";", 1)[0];
}

test("security controls reject cross-site writes, spoofed files and IP-header bypasses", async () => {
  const hostileLogin = new URLSearchParams({ login: "security-admin", password: "security-test-credential-42" });
  const hostileResponse = await call("/api/auth/login", {
    method: "POST",
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    body: hostileLogin,
  });
  assert.equal(hostileResponse.status, 403);

  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
    body: new URLSearchParams({ login: "security-admin", password: "security-test-credential-42", return_to: "/dashboard" }),
  });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/dashboard");
  const cookie = cookieFrom(login);
  assert.match(cookie, /^memecast-admin-session=/);

  const profileResponse = await call("/api/profile", { headers: { cookie } });
  assert.equal(profileResponse.status, 200);
  const { profile } = await profileResponse.json();
  assert.match(profile.slug, /^[a-z0-9_-]{3,40}$/);
  assert.equal(profile.ttsVoice, "system");
  assert.equal(profile.overlayTextWidth, 480);
  assert.equal(profile.overlayTextHeight, 160);
  assert.equal(profile.overlayTextFontSize, 28);

  const changedVoice = await call("/api/profile", {
    method: "POST",
    headers: { cookie, origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ ...profile, ttsVoice: "deep-male", overlayTextWidth: 620, overlayTextHeight: 210, overlayTextFontSize: 36 }),
  });
  assert.equal(changedVoice.status, 200);
  const changedProfile = (await changedVoice.json()).profile;
  assert.equal(changedProfile.ttsVoice, "deep-male");
  assert.equal(changedProfile.overlayTextWidth, 620);
  assert.equal(changedProfile.overlayTextHeight, 210);
  assert.equal(changedProfile.overlayTextFontSize, 36);

  const invalidVoice = await call("/api/profile", {
    method: "POST",
    headers: { cookie, origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ ...profile, ttsVoice: "untrusted-voice" }),
  });
  assert.equal(invalidVoice.status, 400);

  const invalidTextSize = await call("/api/profile", {
    method: "POST",
    headers: { cookie, origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ ...profile, overlayTextWidth: 199 }),
  });
  assert.equal(invalidTextSize.status, 400);

  const hostileProfile = await call("/api/profile", {
    method: "POST",
    headers: { cookie, origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify(profile),
  });
  assert.equal(hostileProfile.status, 403);

  const fakeImage = new FormData();
  fakeImage.set("tags", "unsafe");
  fakeImage.set("file", new File(["<script>alert(1)</script>"], "payload.png", { type: "image/png" }));
  const rejectedUpload = await call("/api/admin/media-upload", {
    method: "POST",
    headers: { cookie, origin: "http://localhost" },
    body: fakeImage,
  });
  assert.equal(rejectedUpload.status, 400);
  assert.match((await rejectedUpload.json()).error, /не соответствует/i);

  const audioForm = new FormData();
  audioForm.set("tags", "security-audio");
  audioForm.set("file", new File([new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0])], "sound.mp3", { type: "audio/mpeg" }));
  const uploaded = await call("/api/admin/media-upload", {
    method: "POST",
    headers: { cookie, origin: "http://localhost" },
    body: audioForm,
  });
  assert.equal(uploaded.status, 201);
  const uploadedAsset = (await uploaded.json()).asset;
  assert.ok(uploadedAsset?.id);

  const invalidRange = await call(`/api/media/${encodeURIComponent(uploadedAsset.id)}`, {
    headers: { range: "bytes=999-1000" },
  });
  assert.equal(invalidRange.status, 416);

  const benignMessage = "При создании генератора мы использовали небезизвестный универсальный код речей. Текст генерируется абзацами случайным образом от двух до десяти предложений в абзаце, что позволяет сделать текст более привлекательным и живым для визуально-слухового восприятия.";
  const benignAlert = await call("/api/alerts", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json", "x-real-ip": "198.51.100.18" },
    body: JSON.stringify({ streamerSlug: profile.slug, viewerKey: "benign-message-test", viewerName: "Tester", message: benignMessage }),
  });
  assert.equal(benignAlert.status, 201);

  for (const [index, message] of ["ебаный тест", "х.у.й", "пиздец"].entries()) {
    const rejectedProfanity = await call("/api/alerts", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json", "x-real-ip": `198.51.100.${40 + index}` },
      body: JSON.stringify({ streamerSlug: profile.slug, viewerKey: `profanity-test-${index}`, viewerName: "Tester", message }),
    });
    assert.equal(rejectedProfanity.status, 400);
    assert.match((await rejectedProfanity.json()).error, /убери мат/i);
  }

  const firstAlert = await call("/api/alerts", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "x-real-ip": "198.51.100.20",
      "cf-connecting-ip": "203.0.113.1",
    },
    body: JSON.stringify({ streamerSlug: profile.slug, viewerKey: "viewer-key-one", viewerName: "Tester", message: "first" }),
  });
  assert.equal(firstAlert.status, 201);

  const overlayPoll = await call(`/api/alerts?token=${encodeURIComponent(profile.overlayToken)}&after=0`);
  assert.equal(overlayPoll.status, 200);
  const overlaySettings = (await overlayPoll.json()).settings;
  assert.equal(overlaySettings.ttsVoice, "deep-male");
  assert.equal(overlaySettings.overlayTextWidth, 620);
  assert.equal(overlaySettings.overlayTextHeight, 210);
  assert.equal(overlaySettings.overlayTextFontSize, 36);

  const spoofedSecondAlert = await call("/api/alerts", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "x-real-ip": "198.51.100.20",
      "cf-connecting-ip": "203.0.113.2",
    },
    body: JSON.stringify({ streamerSlug: profile.slug, viewerKey: "viewer-key-two", viewerName: "Tester", message: "second" }),
  });
  assert.equal(spoofedSecondAlert.status, 429);

  const oversizedAlert = await call("/api/alerts", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json", "x-real-ip": "198.51.100.21" },
    body: JSON.stringify({ streamerSlug: profile.slug, viewerKey: "viewer-key-three", message: "a".repeat(5000) }),
  });
  assert.equal(oversizedAlert.status, 413);

  const database = new DatabaseSync(databasePath);
  const now = Date.now();
  database.prepare(`INSERT INTO streamers (id, owner_user_id, slug, display_name, overlay_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run("other-streamer", "other-owner", "other-streamer", "Other", "other-overlay-token", now, now);
  database.close();
  const crossTenantAlert = await call("/api/alerts", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json", "x-real-ip": "198.51.100.22" },
    body: JSON.stringify({ streamerSlug: "other-streamer", viewerKey: "viewer-key-four", memeId: uploadedAsset.id }),
  });
  assert.equal(crossTenantAlert.status, 404);

  const signoutGet = await call("/api/auth/signout");
  assert.equal(signoutGet.status, 405);

  delete process.env.ADMIN_LOCAL_ONLY;
  const remoteAdminLogin = await call("/api/auth/login", {
    method: "POST",
    headers: { origin: "http://localhost", "x-real-ip": "198.51.100.30" },
    body: new URLSearchParams({ login: "security-admin", password: "security-test-credential-42" }),
  });
  assert.equal(remoteAdminLogin.status, 403);

  const remoteLoginPage = await call("/login", {
    headers: { accept: "text/html", "x-real-ip": "198.51.100.30" },
  });
  assert.equal(remoteLoginPage.status, 200);
  const remoteLoginHtml = await remoteLoginPage.text();
  assert.doesNotMatch(remoteLoginHtml, /name="password"/);
  assert.doesNotMatch(remoteLoginHtml, /SSH-туннель|\.env|Открыть демо без входа/);

  const tunneledAdminLogin = await call("/api/auth/login", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:18080", "sec-fetch-site": "cross-site", "x-real-ip": "127.0.0.1" },
    body: new URLSearchParams({ login: "security-admin", password: "security-test-credential-42" }),
  });
  assert.equal(tunneledAdminLogin.status, 303);

  process.env.APP_URL = "http://public.example";
  const configuredOriginThroughTunnel = await call("/api/auth/login", {
    method: "POST",
    headers: { origin: "http://public.example", "sec-fetch-site": "cross-site", "x-real-ip": "127.0.0.1" },
    body: new URLSearchParams({ login: "security-admin", password: "security-test-credential-42" }),
  });
  assert.equal(configuredOriginThroughTunnel.status, 303);
  process.env.APP_URL = "http://localhost";

  process.env.ADMIN_LOCAL_ONLY = "false";

  const caddy = await readFile(resolve("Caddyfile"), "utf8");
  assert.match(caddy, /Content-Security-Policy/);
  assert.match(caddy, /max_size 256KB/);
  assert.match(caddy, /:8081[\s\S]*header_up X-Real-IP 127\.0\.0\.1/);
  const compose = await readFile(resolve("docker-compose.yml"), "utf8");
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:\s*\r?\n\s*- ALL/);
  assert.match(compose, /127\.0\.0\.1:8081:8081/);
  const notificationSound = await readFile(resolve("public/meme-notification.mp3"));
  assert.ok(notificationSound.byteLength > 1000);
  assert.ok(notificationSound.subarray(0, 3).toString("ascii") === "ID3" || notificationSound[0] === 0xff);
});
