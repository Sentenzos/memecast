"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useState } from "react";
import type { MemeDefinition } from "../memes";

type Profile = {
  displayName: string;
  slug: string;
  cooldownSeconds: number;
  mediaDisplaySeconds: number;
  textDisplaySeconds: number;
  overlayPosition: "bottom-right" | "bottom-left" | "top-right" | "top-left" | "center";
  overlayMediaWidth: number;
  overlayMediaHeight: number;
  overlayAnimation: "pop" | "slide" | "zoom" | "bounce" | "glitch";
  overlayToken: string;
};

type HistoryItem = {
  id: string;
  memeId: string | null;
  message: string | null;
  viewerName: string;
  ipAddress: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  tags: string[];
  sourceType: string | null;
  mediaType: string | null;
  previewUrl: string | null;
};

type BlockedViewer = { id: string; ipAddress: string; viewerName: string | null; createdAt: number };

type ModerationData = { history: HistoryItem[]; blocked: BlockedViewer[] };

function isValidGiphyUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "giphy.com" ||
      url.hostname.endsWith(".giphy.com") ||
      url.hostname === "giphy.media" ||
      url.hostname.endsWith(".giphy.media")
    );
  } catch {
    return false;
  }
}

export function DashboardClient({ initialProfile, login, demoMode = false, publicOrigin = "" }: { initialProfile: Profile; login: string; demoMode?: boolean; publicOrigin?: string }) {
  const [profile, setProfile] = useState(initialProfile);
  const [origin, setOrigin] = useState(publicOrigin);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState<MemeDefinition[]>([]);
  const [sourceMode, setSourceMode] = useState<"file" | "giphy">("file");
  const [mediaTags, setMediaTags] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDimensions, setUploadDimensions] = useState<{ width: number | null; height: number | null }>({ width: null, height: null });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const [giphyUrl, setGiphyUrl] = useState("");
  const [giphyType, setGiphyType] = useState<"gif" | "sticker">("gif");
  const [addingGiphy, setAddingGiphy] = useState(false);
  const [previewingAssetId, setPreviewingAssetId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [blockedViewers, setBlockedViewers] = useState<BlockedViewer[]>([]);
  const [moderationLoading, setModerationLoading] = useState(true);
  const [moderationAction, setModerationAction] = useState<string | null>(null);
  useEffect(() => {
    if (publicOrigin) return;
    const frame = window.requestAnimationFrame(() => setOrigin(window.location.origin));
    return () => window.cancelAnimationFrame(frame);
  }, [publicOrigin]);

  useEffect(() => {
    let cancelled = false;
    async function loadAssets() {
      try {
        const response = await fetch(`/api/admin/media${demoMode ? "?demo=1" : ""}`, { cache: "no-store" });
        const result = await response.json() as { assets?: MemeDefinition[] };
        if (!cancelled) setAssets(result.assets ?? []);
      } catch {
        if (!cancelled) setAssets([]);
      }
    }
    void loadAssets();
    return () => { cancelled = true; };
  }, [demoMode]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await fetchModeration(demoMode);
        if (!cancelled) {
          setHistory(result.history);
          setBlockedViewers(result.blocked);
        }
      } catch {
        // The dashboard remains usable if the history endpoint is temporarily unavailable.
      } finally {
        if (!cancelled) setModerationLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 7000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [demoMode]);

  const overlayUrl = `${origin}/overlay/${profile.overlayToken}`;

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setStatus(`${label} скопирована`);
    window.setTimeout(() => setStatus(""), 2200);
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch(demoMode ? "/api/demo-profile" : "/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const result = await response.json() as { profile?: Profile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error ?? "Не получилось сохранить");
      setProfile(result.profile);
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel("memecast-settings");
        channel.postMessage({
          slug: result.profile.slug,
          cooldownSeconds: result.profile.cooldownSeconds,
          mediaDisplaySeconds: result.profile.mediaDisplaySeconds,
          textDisplaySeconds: result.profile.textDisplaySeconds,
          overlayPosition: result.profile.overlayPosition,
          overlayMediaWidth: result.profile.overlayMediaWidth,
          overlayMediaHeight: result.profile.overlayMediaHeight,
          overlayAnimation: result.profile.overlayAnimation,
        });
        channel.close();
      }
      setStatus(demoMode ? "Настройки сохранены и применены к демо-странице" : "Настройки сохранены");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не получилось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function uploadMedia() {
    if (!uploadFile) {
      setStatus("Выбери файл для загрузки");
      return;
    }
    if (!mediaTags.trim()) {
      setStatus("Добавь хотя бы один тег");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setUploadPhase("Готовим превью…");
    setStatus("");
    const form = new FormData();
    form.set("tags", mediaTags);
    if (uploadDimensions.width && uploadDimensions.height) {
      form.set("width", String(uploadDimensions.width));
      form.set("height", String(uploadDimensions.height));
    }
    form.set("file", uploadFile);
    const poster = await createMediaPoster(uploadFile).catch(() => null);
    if (poster) form.set("poster", poster, "poster.png");

    const request = new XMLHttpRequest();
    request.open("POST", `/api/admin/media-upload${demoMode ? "?demo=1" : ""}`);
    request.timeout = 120000;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      setUploadProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))));
    };
    request.upload.onload = () => {
      setUploadProgress(99);
      setUploadPhase("Файл отправлен, сохраняем в библиотеку…");
    };
    request.onload = () => {
      let result: { asset?: MemeDefinition; error?: string } = {};
      try {
        result = JSON.parse(request.responseText || "{}") as { asset?: MemeDefinition; error?: string };
      } catch {
        result = { error: request.responseText || undefined };
      }
      if (request.status < 200 || request.status >= 300 || !result.asset) {
        setStatus(result.error ?? `Не получилось загрузить файл (${request.status})`);
        setUploading(false);
        setUploadProgress(0);
        setUploadPhase("");
        return;
      }
      setUploadProgress(100);
      setUploadPhase("Готово");
      setAssets((current) => [result.asset as MemeDefinition, ...current]);
      setMediaTags("");
      setUploadFile(null);
      setUploadDimensions({ width: null, height: null });
      setStatus("Файл добавлен в библиотеку");
      const input = document.getElementById("media-file") as HTMLInputElement | null;
      if (input) input.value = "";
      setUploading(false);
      window.setTimeout(() => {
        setUploadProgress(0);
        setUploadPhase("");
      }, 800);
    };
    request.onerror = () => {
      setStatus("Не получилось загрузить файл");
      setUploading(false);
      setUploadProgress(0);
      setUploadPhase("");
    };
    request.ontimeout = () => {
      setStatus("Загрузка заняла слишком много времени. Попробуй файл поменьше или перезапусти сервер.");
      setUploading(false);
      setUploadProgress(0);
      setUploadPhase("");
    };
    request.onabort = () => {
      setStatus("Загрузка отменена");
      setUploading(false);
      setUploadProgress(0);
      setUploadPhase("");
    };
    request.send(form);
  }

  async function addGiphy() {
    const cleanUrl = giphyUrl.trim();
    const cleanTags = mediaTags.trim();
    if (!isValidGiphyUrl(cleanUrl)) {
      setStatus("Вставь корректную ссылку с сайта GIPHY");
      return;
    }
    if (!cleanTags) {
      setStatus("Добавь хотя бы один тег");
      return;
    }
    setAddingGiphy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/admin/media${demoMode ? "?demo=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: cleanUrl, sourceType: giphyType, tags: cleanTags }),
      });
      const result = await response.json() as { asset?: MemeDefinition; error?: string; existing?: boolean };
      if (!response.ok || !result.asset) throw new Error(result.error ?? "Не получилось добавить GIPHY");
      setAssets((current) => [result.asset as MemeDefinition, ...current.filter((asset) => asset.id !== result.asset?.id)]);
      setGiphyUrl("");
      setMediaTags("");
      setStatus(result.existing ? "Этот GIPHY уже был в библиотеке — теги обновлены" : "GIPHY добавлен в библиотеку");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не получилось добавить GIPHY");
    } finally {
      setAddingGiphy(false);
    }
  }

  function selectSource(mode: "file" | "giphy") {
    setSourceMode(mode);
    setStatus("");
    setUploadFile(null);
    setUploadDimensions({ width: null, height: null });
    setUploadProgress(0);
    setUploadPhase("");
    setMediaTags("");
    if (mode === "file") setGiphyUrl("");
  }

  async function handleFileChange(file: File | null) {
    setUploadFile(file);
    setUploadDimensions({ width: null, height: null });
    setUploadProgress(0);
    setUploadPhase("");
    setStatus("");
    if (!file) return;
    const dimensions = await readMediaDimensions(file).catch(() => ({ width: null, height: null }));
    setUploadDimensions(dimensions);
  }

  function handleGiphyUrlChange(value: string) {
    setGiphyUrl(value);
    try {
      const url = new URL(value.trim());
      if (url.pathname.includes("/stickers/")) setGiphyType("sticker");
      if (url.pathname.includes("/gifs/")) setGiphyType("gif");
    } catch {
      // Validation runs when the administrator clicks the add button.
    }
  }

  async function deleteAsset(id: string) {
    setStatus("");
    try {
      const response = await fetch(`/api/admin/media${demoMode ? "?demo=1&" : "?"}id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не получилось удалить");
      setAssets((current) => current.filter((asset) => asset.id !== id));
      setStatus("Медиа удалено из библиотеки");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не получилось удалить");
    }
  }

  async function blockViewer(item: HistoryItem) {
    if (!item.ipAddress) return;
    setModerationAction(item.id);
    setStatus("");
    try {
      await updateModeration(demoMode, { action: "block", ipAddress: item.ipAddress, viewerName: item.viewerName });
      const result = await fetchModeration(demoMode);
      setHistory(result.history);
      setBlockedViewers(result.blocked);
      setStatus(`${item.viewerName} заблокирован по IP`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не получилось заблокировать IP");
    } finally {
      setModerationAction(null);
    }
  }

  async function unblockViewer(item: BlockedViewer) {
    setModerationAction(item.id);
    setStatus("");
    try {
      await updateModeration(demoMode, { action: "unblock", id: item.id });
      setBlockedViewers((current) => current.filter((viewer) => viewer.id !== item.id));
      setStatus(`${item.viewerName || item.ipAddress} разблокирован`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не получилось разблокировать IP");
    } finally {
      setModerationAction(null);
    }
  }

  async function refreshModeration() {
    setModerationLoading(true);
    try {
      const result = await fetchModeration(demoMode);
      setHistory(result.history);
      setBlockedViewers(result.blocked);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не получилось обновить историю");
    } finally {
      setModerationLoading(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <a className="brand dashboard-brand" href="/"><span className="brand-mark">M</span><span>MEMECAST</span></a>
        <nav aria-label="Разделы кабинета">
          <a className="nav-active" href="#links"><span>⌁</span> Обзор</a>
          <a href="#links"><span>↗</span> OBS</a>
          <a href="#library"><span>▣</span> Библиотека</a>
          <a href="#history"><span>☷</span> История</a>
          <a href="#settings"><span>◉</span> Настройки</a>
        </nav>
        <div className="account-chip"><span>{login.slice(0, 1).toUpperCase()}</span><div><strong>{profile.displayName}</strong><small>{login}</small></div></div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-topline">
          <div><p className="section-kicker">КАБИНЕТ СТРИМЕРА</p><h1>Привет, {profile.displayName}!</h1></div>
          <a className="secondary-button" href="/">На главную</a>
        </header>

        {demoMode ? <div className="dashboard-alert">Демо-режим: можно проверить интерфейс, ссылки и настройку таймаута без авторизации.</div> : null}
        {status ? <div className="dashboard-alert dashboard-alert-ok" role="status">{status}</div> : null}

        <section className="dashboard-grid dashboard-grid-single" id="links">
          <article className="dashboard-panel panel-obs">
            <div className="panel-label"><span>01</span> ДЛЯ OBS</div>
            <h2>Browser Source</h2><p>Добавь эту ссылку как источник «Браузер» размером 1920×1080.</p>
            <div className="url-box url-box-dark"><code>{overlayUrl || "Загрузка адреса…"}</code><button onClick={() => void copy(overlayUrl, "OBS-ссылка")} disabled={!origin} type="button">Копировать</button></div>
            <small className="secret-note">Не показывай эту ссылку зрителям — она управляет оверлеем.</small>
          </article>
        </section>

        <section className="library-panel" id="library">
          <div className="library-panel-copy">
            <p className="section-kicker">БИБЛИОТЕКА МЕМОВ</p>
            <h2>Свои медиа и GIPHY</h2>
            <p>Сначала выбери источник: свой файл или ссылку GIPHY. Названия не нужны: добавь хотя бы один тег, и поиск будет ориентироваться по тегам.</p>
          </div>
          <div className="library-forms">
            <div className="upload-box">
              <h3>1. Источник</h3>
              <div className="source-switch" role="tablist" aria-label="Источник медиа">
                <button className={sourceMode === "file" ? "source-active" : ""} onClick={() => selectSource("file")} type="button">Файл</button>
                <button className={sourceMode === "giphy" ? "source-active" : ""} onClick={() => selectSource("giphy")} type="button">GIPHY</button>
              </div>
              {sourceMode === "file" ? (
                <label>Файл<input id="media-file" type="file" accept="video/mp4,video/webm,video/ogg,audio/mpeg,audio/mp3,audio/wav,audio/ogg,image/gif,image/png,image/jpeg" onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)} /></label>
              ) : (
                <label>Ссылка GIPHY<input disabled={addingGiphy} value={giphyUrl} onChange={(event) => handleGiphyUrlChange(event.target.value)} placeholder="https://giphy.com/gifs/..." /></label>
              )}
            </div>
            <div className="upload-box">
              <h3>2. Тип и описание</h3>
              {sourceMode === "giphy" ? (
                <label>Тип<select disabled={addingGiphy} value={giphyType} onChange={(event) => setGiphyType(event.target.value as "gif" | "sticker")}><option value="gif">GIF</option><option value="sticker">Sticker</option></select></label>
              ) : <div className="derived-type">Тип определится по файлу</div>}
              <label>Теги<input disabled={addingGiphy || (sourceMode === "file" && !uploadFile)} value={mediaTags} onChange={(event) => setMediaTags(event.target.value.slice(0, 160))} placeholder="rage, laugh, victory" /><small>Минимум один тег обязателен.</small></label>
              {sourceMode === "file" ? (
                <button className="primary-button" disabled={uploading || !uploadFile} onClick={() => void uploadMedia()} type="button">{uploading ? "Загружаем…" : "Добавить в библиотеку"}</button>
              ) : (
                <button className="primary-button" disabled={addingGiphy || !giphyUrl.trim() || !mediaTags.trim()} onClick={() => void addGiphy()} type="button">{addingGiphy ? "Добавляем GIPHY…" : "Добавить в библиотеку"}</button>
              )}
              {sourceMode === "file" && (uploading || uploadProgress > 0) ? (
                <div className="upload-progress" role="progressbar" aria-label="Загрузка файла" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
                  <div><span style={{ width: `${uploadProgress}%` }} /></div>
                  <small>{uploadProgress}%</small>
                  {uploadPhase ? <em>{uploadPhase}</em> : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="asset-strip">
            <div className="asset-grid">
              {assets.length ? assets.map((asset) => (
                <article
                  className="asset-card"
                  key={asset.id}
                  onMouseEnter={() => setPreviewingAssetId(asset.id)}
                  onMouseLeave={() => setPreviewingAssetId((current) => current === asset.id ? null : current)}
                >
                  <div className={`asset-preview tone-${asset.tone}`}>
                    {asset.mediaUrl && asset.mediaType === "image" ? <img src={previewingAssetId === asset.id ? asset.mediaUrl : asset.previewUrl ?? asset.mediaUrl} alt="" /> : null}
                    {asset.mediaUrl && asset.mediaType === "video" && previewingAssetId === asset.id ? <video src={asset.mediaUrl} muted autoPlay loop playsInline preload="metadata" /> : null}
                    {asset.mediaUrl && asset.mediaType === "video" && previewingAssetId !== asset.id && asset.previewUrl ? <img src={asset.previewUrl} alt="" /> : null}
                    {asset.mediaUrl && asset.mediaType === "video" && previewingAssetId !== asset.id && !asset.previewUrl ? <span>🎬</span> : null}
                    {asset.mediaType === "audio" ? <span>🔊</span> : null}
                  </div>
                  <strong>{asset.tags?.length ? asset.tags.map((tag) => `#${tag}`).join(" ") : "Без тегов"}</strong>
                  <small>{asset.subtitle}</small>
                  <button onClick={() => void deleteAsset(asset.id)} type="button">Удалить</button>
                </article>
              )) : <div className="empty-library">Пока пусто</div>}
            </div>
          </div>
        </section>

        <section className="moderation-panel" id="history">
          <div className="moderation-heading">
            <div>
              <p className="section-kicker">МОДЕРАЦИЯ</p>
              <h2>История отправок</h2>
              <p>Последние 100 отправок. Блокировка действует по IP и никак не сообщает зрителю о блоке.</p>
            </div>
            <button className="secondary-button" disabled={moderationLoading} onClick={() => void refreshModeration()} type="button">
              {moderationLoading ? "Обновляем…" : "Обновить"}
            </button>
          </div>
          <div className="moderation-layout">
            <div className="history-list">
              {moderationLoading && !history.length ? <div className="moderation-empty">Загружаем историю…</div> : null}
              {!moderationLoading && !history.length ? <div className="moderation-empty">Отправок пока не было</div> : null}
              {history.map((item) => {
                const isBlocked = Boolean(item.ipAddress && blockedViewers.some((viewer) => viewer.ipAddress === item.ipAddress));
                return (
                  <article className="history-row" key={item.id}>
                    <div className="history-preview">
                      {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span aria-hidden="true">{item.memeId ? "🎬" : "💬"}</span>}
                    </div>
                    <div className="history-copy">
                      <div className="history-title">
                        <strong>{item.viewerName}</strong>
                        <span className={`history-state history-state-${historyState(item)}`}>{historyStateLabel(item)}</span>
                      </div>
                      <p>{historyKind(item)}{item.tags.length ? ` · ${item.tags.map((tag) => `#${tag}`).join(" ")}` : ""}</p>
                      {item.message ? <blockquote>{item.message}</blockquote> : null}
                      <small>{formatDashboardDate(item.createdAt)} · IP: {item.ipAddress || "нет данных"}</small>
                    </div>
                    <button
                      className="danger-button"
                      disabled={!item.ipAddress || isBlocked || moderationAction === item.id}
                      onClick={() => void blockViewer(item)}
                      type="button"
                    >
                      {isBlocked ? "Заблокирован" : moderationAction === item.id ? "Блокируем…" : "Блокировать IP"}
                    </button>
                  </article>
                );
              })}
            </div>
            <aside className="blocked-panel">
              <div><p className="section-kicker">ЧЁРНЫЙ СПИСОК</p><h3>Заблокированные</h3><span>{blockedViewers.length}</span></div>
              {blockedViewers.length ? blockedViewers.map((viewer) => (
                <article className="blocked-row" key={viewer.id}>
                  <div><strong>{viewer.viewerName || "Без имени"}</strong><small>{viewer.ipAddress}</small><time>{formatDashboardDate(viewer.createdAt)}</time></div>
                  <button disabled={moderationAction === viewer.id} onClick={() => void unblockViewer(viewer)} type="button">
                    {moderationAction === viewer.id ? "…" : "Разблокировать"}
                  </button>
                </article>
              )) : <div className="moderation-empty">Список пуст</div>}
            </aside>
          </div>
        </section>

        <section className="settings-panel" id="settings">
          <div><p className="section-kicker">ЗАЩИТА ОТ СПАМА</p><h2>Настройки канала</h2><p>Один зритель не сможет отправлять мемы чаще заданного интервала.</p></div>
          <div className="settings-fields">
            <label>Ник на странице<input value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value.slice(0, 40) })} /></label>
            <label>Таймаут между мемами<div className="range-row"><input type="range" min="5" max="300" step="5" value={profile.cooldownSeconds} onChange={(e) => setProfile({ ...profile, cooldownSeconds: Number(e.target.value) })} /><strong>{profile.cooldownSeconds} сек.</strong></div></label>
            <label>Медиа в OBS<div className="range-row"><input type="range" min="1" max="30" step="1" value={profile.mediaDisplaySeconds} onChange={(e) => setProfile({ ...profile, mediaDisplaySeconds: Number(e.target.value) })} /><strong>{profile.mediaDisplaySeconds} сек.</strong></div></label>
            <label>Текст в OBS<div className="range-row"><input type="range" min="1" max="30" step="1" value={profile.textDisplaySeconds} onChange={(e) => setProfile({ ...profile, textDisplaySeconds: Number(e.target.value) })} /><strong>{profile.textDisplaySeconds} сек.</strong></div></label>
            <label>Ширина медиа в OBS<div className="range-row"><input type="range" min="120" max="900" step="10" value={profile.overlayMediaWidth} onChange={(e) => setProfile({ ...profile, overlayMediaWidth: Number(e.target.value) })} /><strong>{profile.overlayMediaWidth}px</strong></div></label>
            <label>Высота медиа в OBS<div className="range-row"><input type="range" min="120" max="700" step="10" value={profile.overlayMediaHeight} onChange={(e) => setProfile({ ...profile, overlayMediaHeight: Number(e.target.value) })} /><strong>{profile.overlayMediaHeight}px</strong></div></label>
            <label>Позиция мемов в OBS<div className="position-grid" role="radiogroup" aria-label="Позиция мемов в OBS">
              {[
                ["top-left", "↖"],
                ["top-right", "↗"],
                ["center", "•"],
                ["bottom-left", "↙"],
                ["bottom-right", "↘"],
              ].map(([value, label]) => (
                <button
                  aria-checked={profile.overlayPosition === value}
                  className={profile.overlayPosition === value ? "position-active" : ""}
                  key={value}
                  onClick={() => setProfile({ ...profile, overlayPosition: value as Profile["overlayPosition"] })}
                  role="radio"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div></label>
            <div className="settings-control">
              <span>Анимация появления мема</span>
              <div className="animation-grid" role="radiogroup" aria-label="Анимация появления мема">
                {[
                  ["pop", "Поп"],
                  ["slide", "Слайд"],
                  ["zoom", "Зум"],
                  ["bounce", "Прыжок"],
                  ["glitch", "Глитч"],
                ].map(([value, label]) => (
                  <button
                    aria-checked={profile.overlayAnimation === value}
                    className={profile.overlayAnimation === value ? "animation-active" : ""}
                    key={value}
                    onClick={() => setProfile({ ...profile, overlayAnimation: value as Profile["overlayAnimation"] })}
                    role="radio"
                    type="button"
                  >
                    <i className={`animation-swatch animation-swatch-${value}`} aria-hidden="true">M</i>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <button className="primary-button" disabled={saving} onClick={() => void save()} type="button">{saving ? "Сохраняем…" : "Сохранить настройки"}</button>
          </div>
        </section>
      </div>
    </main>
  );
}

async function fetchModeration(demoMode: boolean): Promise<ModerationData> {
  const response = await fetch(`/api/admin/moderation${demoMode ? "?demo=1" : ""}`, { cache: "no-store" });
  const result = await response.json() as Partial<ModerationData> & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не получилось загрузить историю");
  return { history: result.history ?? [], blocked: result.blocked ?? [] };
}

async function updateModeration(demoMode: boolean, payload: { action: "block"; ipAddress: string; viewerName: string } | { action: "unblock"; id: string }) {
  const response = await fetch(`/api/admin/moderation${demoMode ? "?demo=1" : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не получилось изменить блокировку");
}

function historyKind(item: HistoryItem) {
  if (item.memeId && item.message) return "Мем + сообщение";
  if (item.memeId) return "Мем";
  return "Только сообщение";
}

function historyState(item: HistoryItem) {
  if (item.completedAt) return "done";
  if (item.startedAt) return "live";
  return "queued";
}

function historyStateLabel(item: HistoryItem) {
  if (item.completedAt) return "Завершён";
  if (item.startedAt) return "В эфире";
  return "В очереди";
}

function formatDashboardDate(value: number) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function readMediaDimensions(file: File) {
  if (file.type.startsWith("image/")) {
    return new Promise<{ width: number | null; height: number | null }>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image dimensions unavailable"));
      };
      image.src = url;
    });
  }
  if (file.type.startsWith("video/")) {
    return new Promise<{ width: number | null; height: number | null }>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({ width: video.videoWidth || null, height: video.videoHeight || null });
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Video dimensions unavailable"));
      };
      video.src = url;
    });
  }
  return Promise.resolve({ width: null, height: null });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.82));
}

function drawPoster(source: CanvasImageSource, width: number, height: number) {
  const maxSide = 520;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas);
}

function createMediaPoster(file: File) {
  if (file.type.startsWith("image/")) {
    return new Promise<Blob | null>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const poster = drawPoster(image, image.naturalWidth || 1, image.naturalHeight || 1);
        URL.revokeObjectURL(url);
        poster.then(resolve, reject);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image poster unavailable"));
      };
      image.src = url;
    });
  }
  if (file.type.startsWith("video/")) {
    return new Promise<Blob | null>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.onloadeddata = () => {
        const poster = drawPoster(video, video.videoWidth || 1, video.videoHeight || 1);
        URL.revokeObjectURL(url);
        poster.then(resolve, reject);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Video poster unavailable"));
      };
      video.src = url;
      video.load();
    });
  }
  return Promise.resolve(null);
}
