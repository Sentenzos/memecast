"use client";

import { useEffect, useState } from "react";
import type { MemeDefinition } from "./memes";

type Props = { slug: string; cooldownSeconds: number };
type Notice = { kind: "ok" | "error"; text: string } | null;

function getViewerKey() {
  const storageKey = "memecast-viewer-key";
  const current = window.localStorage.getItem(storageKey);
  if (current) return current;
  const created = window.crypto.randomUUID();
  window.localStorage.setItem(storageKey, created);
  return created;
}

function storedViewerName() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("memecast-viewer-name") ?? "";
}

function memeLabel(meme: MemeDefinition) {
  if (meme.tags?.length) return meme.tags.map((tag) => `#${tag}`).join(" ");
  return meme.title.startsWith("custom:") ? meme.subtitle : meme.title;
}

export function MemeSender({ slug, cooldownSeconds }: Props) {
  const [libraryClips, setLibraryClips] = useState<MemeDefinition[]>([]);
  const [libraryState, setLibraryState] = useState<{ loading: boolean; configured: boolean; message?: string }>({ loading: true, configured: false });
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [configuredCooldown, setConfiguredCooldown] = useState(cooldownSeconds);
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [message, setMessage] = useState("");
  const [viewerName, setViewerName] = useState(storedViewerName);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "gif" | "sticker" | "upload">("all");
  const [measuredRatios, setMeasuredRatios] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(24);
  const [streamStatus, setStreamStatus] = useState<{ busy: boolean; viewerName?: string }>({ busy: false });
  const remaining = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000));
  const cooldownLabel = remaining > 0 ? `${remaining} сек.` : `${configuredCooldown} сек.`;
  const tabbedLibrary = libraryClips.filter((meme) => activeTab === "all" || meme.sourceType === activeTab);
  const fullCatalog = [...tabbedLibrary];
  const catalog = fullCatalog.slice(0, visibleCount);

  useEffect(() => {
    let cancelled = false;
    async function loadLibrary() {
      try {
        setLibraryState((current) => ({ ...current, loading: true }));
        const params = new URLSearchParams({
          q: "funny meme reaction",
          streamerSlug: slug,
        });
        if (search.trim()) params.set("search", search.trim());
        const response = await fetch(`/api/meme-library?${params.toString()}`, { cache: "no-store" });
        const result = await response.json() as { configured?: boolean; clips?: MemeDefinition[]; message?: string };
        if (cancelled) return;
        setLibraryClips(result.clips ?? []);
        setVisibleCount(24);
        setLibraryState({ loading: false, configured: Boolean(result.configured), message: result.message });
      } catch {
        if (!cancelled) setLibraryState({ loading: false, configured: false, message: "Каталог клипов временно недоступен" });
      }
    }
    void loadLibrary();
    return () => { cancelled = true; };
  }, [slug, search]);

  useEffect(() => {
    function onScroll() {
      const nearBottom = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 900;
      if (nearBottom) setVisibleCount((current) => Math.min(current + 24, fullCatalog.length));
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [fullCatalog.length]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("memecast-settings");
    channel.onmessage = (event: MessageEvent<{ slug?: string; cooldownSeconds?: number }>) => {
      if (event.data.slug === slug && typeof event.data.cooldownSeconds === "number") {
        setConfiguredCooldown(event.data.cooldownSeconds);
      }
    };
    return () => channel.close();
  }, [slug]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= cooldownUntil) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    let cancelled = false;
    async function loadStreamStatus() {
      try {
        const response = await fetch(`/api/stream-status?streamerSlug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const result = await response.json() as { busy?: boolean; viewerName?: string };
        if (response.ok && !cancelled) setStreamStatus({ busy: Boolean(result.busy), viewerName: result.viewerName });
      } catch {
        // A missing presence indicator must never prevent sending an alert.
      }
    }
    void loadStreamStatus();
    const timer = window.setInterval(() => void loadStreamStatus(), 1800);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [slug]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function sendAlert(input: { memeId?: string; title: string }) {
    if (remaining > 0 || sending) return;
    const cleanMessage = message.trim().replace(/\s+/g, " ");
    if (!input.memeId && !cleanMessage) {
      setNotice({ kind: "error", text: "Напиши текст или выбери мем" });
      return;
    }
    setSending(input.memeId ?? "text");
    setNotice(null);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ streamerSlug: slug, memeId: input.memeId, message: cleanMessage, viewerName, viewerKey: getViewerKey() }),
      });
      const result = await response.json() as { error?: string; retryAfter?: number; cooldownSeconds?: number; createdAt?: number; serverTime?: number };
      if (result.cooldownSeconds) setConfiguredCooldown(result.cooldownSeconds);
      if (!response.ok) {
        if (result.retryAfter) {
          const now = result.serverTime ?? clock;
          setClock(now);
          setCooldownUntil(now + result.retryAfter * 1000);
        }
        throw new Error(result.error ?? "Не получилось отправить мем");
      }
      const serverCooldown = result.cooldownSeconds ?? configuredCooldown;
      const now = result.createdAt ?? clock;
      setClock(now);
      setCooldownUntil(now + serverCooldown * 1000);
      setMessage("");
      setNotice({ kind: "ok", text: `${input.title} уже летит на стрим!` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Не получилось отправить" });
    } finally {
      setSending(null);
    }
  }

  function mediaStyle(meme: MemeDefinition) {
    if (meme.width && meme.height) return { aspectRatio: `${meme.width} / ${meme.height}` };
    const measured = measuredRatios[meme.id];
    return measured ? { aspectRatio: measured } : undefined;
  }

  function rememberRatio(meme: MemeDefinition, width: number, height: number) {
    if (!width || !height || measuredRatios[meme.id]) return;
    setMeasuredRatios((current) => ({ ...current, [meme.id]: `${width} / ${height}` }));
  }

  return (
    <section className="catalog" aria-label="Каталог мемов">
      <div className="catalog-status">
        {streamStatus.busy ? (
          <div className="stream-busy" aria-live="polite">
            <span aria-hidden="true" />
            Сейчас в эфире мем{streamStatus.viewerName ? ` от ${streamStatus.viewerName}` : ""}. Можно встать в очередь.
          </div>
        ) : null}
        <div className={`cooldown ${remaining > 0 ? "cooldown-active" : ""}`} aria-live="polite">
          <span>⏱</span>
          {remaining > 0 ? "Можно снова через:" : "Таймаут:"} <strong>{cooldownLabel}</strong>
        </div>
      </div>

      <div className="message-composer">
        <label htmlFor="viewer-name">Имя в эфире</label>
        <input
          id="viewer-name"
          maxLength={32}
          onChange={(event) => {
            const value = event.target.value.slice(0, 32);
            setViewerName(value);
            window.localStorage.setItem("memecast-viewer-name", value);
          }}
          placeholder="Как тебя назвать?"
          value={viewerName}
        />
        <label htmlFor="meme-message">Текст для озвучки <span>· необязательно</span></label>
        <div>
          <textarea
            id="meme-message"
            maxLength={220}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Напиши фразу, затем отправь её отдельно или выбери мем ниже"
            rows={3}
            value={message}
          />
          <button
            disabled={remaining > 0 || Boolean(sending) || !message.trim()}
            onClick={() => void sendAlert({ title: "Сообщение" })}
            type="button"
          >
            {sending === "text" ? "Отправляем…" : "Только текст"}
          </button>
        </div>
        <small>{message.length}/220</small>
      </div>

      {message.trim() ? (
        <div className="message-combine-hint" role="status">
          <span aria-hidden="true">＋</span>
          <p><strong>Текст прикреплён.</strong> Нажми на любой мем ниже, чтобы отправить мем и озвучку вместе. Кнопка «Только текст» отправит фразу без мема.</p>
        </div>
      ) : null}

      <div className="catalog-tools">
        <input
          aria-label="Поиск по тегам"
          onChange={(event) => {
            setSearch(event.target.value.slice(0, 50));
            setVisibleCount(24);
          }}
          placeholder="Поиск по тегам"
          value={search}
        />
        <div className="catalog-tabs" role="tablist" aria-label="Типы медиа">
          {[
            ["all", "Все"],
            ["gif", "GIF"],
            ["sticker", "Stickers"],
            ["upload", "Uploads"],
          ].map(([value, label]) => (
            <button
              aria-selected={activeTab === value}
              className={activeTab === value ? "tab-active" : ""}
              key={value}
              onClick={() => {
                setActiveTab(value as typeof activeTab);
                setVisibleCount(24);
              }}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="meme-grid">
        {catalog.map((meme, index) => (
          <button
            className={`meme-card tone-${meme.tone}`}
            disabled={remaining > 0 || Boolean(sending)}
            key={meme.id}
            onBlur={() => setPreviewing((current) => current === meme.id ? null : current)}
            onFocus={() => setPreviewing(meme.id)}
            onMouseEnter={() => setPreviewing(meme.id)}
            onMouseLeave={() => setPreviewing((current) => current === meme.id ? null : current)}
            onClick={() => void sendAlert({ memeId: meme.id, title: memeLabel(meme) })}
            type="button"
          >
            <span className="meme-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="meme-visual" aria-hidden="true" style={mediaStyle(meme)}>
              {meme.mediaUrl && meme.mediaType === "image" ? (
                <img className="meme-preview-video" src={previewing === meme.id ? meme.mediaUrl : meme.previewUrl ?? meme.mediaUrl} alt="" onLoad={(event) => rememberRatio(meme, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
              ) : meme.mediaUrl && meme.mediaType !== "audio" ? (
                previewing === meme.id ? (
                  <video className="meme-preview-video" src={meme.mediaUrl} muted autoPlay loop playsInline preload="metadata" onLoadedMetadata={(event) => rememberRatio(meme, event.currentTarget.videoWidth, event.currentTarget.videoHeight)} />
                ) : meme.previewUrl ? (
                  <img className="meme-preview-video" src={meme.previewUrl} alt="" onLoad={(event) => rememberRatio(meme, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
                ) : (
                  <span className="emoji">{sending === meme.id ? "🚀" : meme.emoji}</span>
                )
              ) : (
                <span className="emoji">{sending === meme.id ? "🚀" : meme.emoji}</span>
              )}
              <span className="sound-wave"><i /><i /><i /><i /></span>
            </span>
            <span className="meme-meta">
              <span><strong>{memeLabel(meme)}</strong><small>{meme.subtitle}</small></span>
              <span className={`send-icon ${message.trim() ? "send-icon-combined" : ""}`} aria-hidden="true">{message.trim() ? "+T" : "↗"}</span>
            </span>
          </button>
        ))}
      </div>
      {libraryState.loading ? (
        <div className="catalog-loader" role="status">
          <span aria-hidden="true" />
          <strong>Подгружаем мемы…</strong>
        </div>
      ) : null}
      {!libraryState.loading && !catalog.length ? <div className="empty-catalog">Ничего не найдено</div> : null}
      {catalog.length < fullCatalog.length ? <div className="empty-catalog">Прокрути ниже, чтобы загрузить ещё</div> : null}
      {notice ? <div className={`notice notice-${notice.kind}`} role="status">{notice.text}</div> : null}
    </section>
  );
}
