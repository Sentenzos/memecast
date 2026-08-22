import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(workerUrl.href);
  const request = new Request(`http://localhost${path}`, { headers: { accept: "text/html" } });
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
});
