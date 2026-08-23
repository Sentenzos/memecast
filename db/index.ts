import { demoStreamer } from "../app/memes";
import type { TtsVoicePreset } from "../app/tts";
import { getLocalDatabase } from "./local-d1";

export type StreamerRecord = {
  id: string;
  owner_user_id: string;
  slug: string;
  twitch_user_id: string | null;
  twitch_login: string | null;
  display_name: string;
  avatar_url: string | null;
  cooldown_seconds: number;
  media_display_seconds: number;
  text_display_seconds: number;
  overlay_position: OverlayPosition;
  overlay_media_width: number;
  overlay_media_height: number;
  overlay_text_width: number;
  overlay_text_height: number;
  overlay_text_font_size: number;
  overlay_animation: OverlayAnimation;
  tts_voice: TtsVoicePreset;
  overlay_token: string;
  created_at: number;
  updated_at: number;
};

export type OverlayPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"
  | "center";

export type OverlayAnimation = "pop" | "slide" | "zoom" | "bounce" | "glitch";

export type MemeAssetRecord = {
  id: string;
  provider: string;
  provider_id: string;
  title: string;
  preview_url: string | null;
  media_url: string;
  media_type: "video" | "audio" | "image";
  source_type: "upload" | "gif" | "sticker" | "clip";
  source_url: string | null;
  tags: string | null;
  mime_type: string | null;
  storage_key: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  created_at: number;
  updated_at: number;
};

export function getD1() {
  return getLocalDatabase();
}

async function columnExists(table: string, column: string) {
  const rows = await getD1().prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.results.some((row) => row.name === column);
}

async function nullableColumn(table: string, column: string) {
  const rows = await getD1().prepare(`PRAGMA table_info(${table})`).all<{ name: string; notnull: number }>();
  const found = rows.results.find((row) => row.name === column);
  return found ? found.notnull === 0 : false;
}

async function ensureAlertShape() {
  if (!await nullableColumn("alerts", "meme_id")) {
    await getD1().batch([
      getD1().prepare(`CREATE TABLE IF NOT EXISTS alerts_next (
        id TEXT PRIMARY KEY,
        streamer_id TEXT NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
        meme_id TEXT,
        message TEXT,
        viewer_name TEXT,
        viewer_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`),
      getD1().prepare(`INSERT OR IGNORE INTO alerts_next
        (id, streamer_id, meme_id, message, viewer_name, viewer_key, created_at)
        SELECT id, streamer_id, meme_id, NULL, NULL, viewer_key, created_at FROM alerts`),
      getD1().prepare("DROP TABLE alerts"),
      getD1().prepare("ALTER TABLE alerts_next RENAME TO alerts"),
    ]);
  } else if (!await columnExists("alerts", "message")) {
    await getD1().prepare("ALTER TABLE alerts ADD COLUMN message TEXT").run();
  }
  if (!await columnExists("alerts", "viewer_name")) {
    await getD1().prepare("ALTER TABLE alerts ADD COLUMN viewer_name TEXT").run();
  }
  const additions = [
    ["viewer_ip", "ALTER TABLE alerts ADD COLUMN viewer_ip TEXT"],
    ["started_at", "ALTER TABLE alerts ADD COLUMN started_at INTEGER"],
    ["completed_at", "ALTER TABLE alerts ADD COLUMN completed_at INTEGER"],
  ] as const;
  for (const [column, statement] of additions) {
    if (!await columnExists("alerts", column)) {
      await getD1().prepare(statement).run();
    }
  }
}

async function ensureAssetShape() {
  const additions = [
    ["media_type", "ALTER TABLE meme_assets ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video'"],
    ["source_type", "ALTER TABLE meme_assets ADD COLUMN source_type TEXT NOT NULL DEFAULT 'upload'"],
    ["source_url", "ALTER TABLE meme_assets ADD COLUMN source_url TEXT"],
    ["tags", "ALTER TABLE meme_assets ADD COLUMN tags TEXT"],
    ["mime_type", "ALTER TABLE meme_assets ADD COLUMN mime_type TEXT"],
    ["storage_key", "ALTER TABLE meme_assets ADD COLUMN storage_key TEXT"],
    ["size_bytes", "ALTER TABLE meme_assets ADD COLUMN size_bytes INTEGER"],
  ] as const;
  for (const [column, statement] of additions) {
    if (!await columnExists("meme_assets", column)) {
      await getD1().prepare(statement).run();
    }
  }
}

async function ensureStreamerShape() {
  const additions = [
    ["media_display_seconds", "ALTER TABLE streamers ADD COLUMN media_display_seconds INTEGER NOT NULL DEFAULT 5"],
    ["text_display_seconds", "ALTER TABLE streamers ADD COLUMN text_display_seconds INTEGER NOT NULL DEFAULT 5"],
    ["overlay_position", "ALTER TABLE streamers ADD COLUMN overlay_position TEXT NOT NULL DEFAULT 'bottom-right'"],
    ["overlay_media_width", "ALTER TABLE streamers ADD COLUMN overlay_media_width INTEGER NOT NULL DEFAULT 360"],
    ["overlay_media_height", "ALTER TABLE streamers ADD COLUMN overlay_media_height INTEGER NOT NULL DEFAULT 300"],
    ["overlay_text_width", "ALTER TABLE streamers ADD COLUMN overlay_text_width INTEGER NOT NULL DEFAULT 480"],
    ["overlay_text_height", "ALTER TABLE streamers ADD COLUMN overlay_text_height INTEGER NOT NULL DEFAULT 160"],
    ["overlay_text_font_size", "ALTER TABLE streamers ADD COLUMN overlay_text_font_size INTEGER NOT NULL DEFAULT 28"],
    ["overlay_animation", "ALTER TABLE streamers ADD COLUMN overlay_animation TEXT NOT NULL DEFAULT 'pop'"],
    ["tts_voice", "ALTER TABLE streamers ADD COLUMN tts_voice TEXT NOT NULL DEFAULT 'system'"],
  ] as const;
  for (const [column, statement] of additions) {
    if (!await columnExists("streamers", column)) {
      await getD1().prepare(statement).run();
    }
  }
}

async function ensureAlertIndexes() {
  await getD1().batch([
    getD1().prepare("CREATE INDEX IF NOT EXISTS idx_alerts_streamer_created ON alerts(streamer_id, created_at)"),
    getD1().prepare("CREATE INDEX IF NOT EXISTS idx_alerts_streamer_viewer_created ON alerts(streamer_id, viewer_key, created_at)"),
  ]);
}

export async function ensureDatabase() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS streamers (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      twitch_user_id TEXT,
      twitch_login TEXT,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      cooldown_seconds INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_seconds BETWEEN 5 AND 3600),
      media_display_seconds INTEGER NOT NULL DEFAULT 5,
      text_display_seconds INTEGER NOT NULL DEFAULT 5,
      overlay_position TEXT NOT NULL DEFAULT 'bottom-right',
      overlay_media_width INTEGER NOT NULL DEFAULT 360,
      overlay_media_height INTEGER NOT NULL DEFAULT 300,
      overlay_text_width INTEGER NOT NULL DEFAULT 480,
      overlay_text_height INTEGER NOT NULL DEFAULT 160,
      overlay_text_font_size INTEGER NOT NULL DEFAULT 28,
      overlay_animation TEXT NOT NULL DEFAULT 'pop',
      tts_voice TEXT NOT NULL DEFAULT 'system',
      overlay_token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      streamer_id TEXT NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
      meme_id TEXT,
      message TEXT,
      viewer_name TEXT,
      viewer_key TEXT NOT NULL,
      viewer_ip TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS blocked_viewers (
      id TEXT PRIMARY KEY,
      streamer_id TEXT NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
      ip_address TEXT NOT NULL,
      viewer_name TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(streamer_id, ip_address)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS meme_assets (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      title TEXT NOT NULL,
      preview_url TEXT,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'video',
      source_type TEXT NOT NULL DEFAULT 'upload',
      source_url TEXT,
      tags TEXT,
      mime_type TEXT,
      storage_key TEXT,
      size_bytes INTEGER,
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(provider, provider_id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_alerts_streamer_created ON alerts(streamer_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_alerts_streamer_viewer_created ON alerts(streamer_id, viewer_key, created_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_viewers_streamer_ip ON blocked_viewers(streamer_id, ip_address)"),
  ]);
  await ensureStreamerShape();
  await ensureAlertShape();
  await ensureAssetShape();
  await ensureAlertIndexes();

  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO streamers
    (id, owner_user_id, slug, twitch_user_id, twitch_login, display_name, avatar_url, cooldown_seconds, media_display_seconds, text_display_seconds, overlay_position, overlay_media_width, overlay_media_height, overlay_text_width, overlay_text_height, overlay_text_font_size, overlay_animation, tts_voice, overlay_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "demo-streamer",
      "demo-owner",
      demoStreamer.slug,
      null,
      null,
      demoStreamer.displayName,
      demoStreamer.avatarUrl,
      demoStreamer.cooldownSeconds,
      demoStreamer.mediaDisplaySeconds,
      demoStreamer.textDisplaySeconds,
      demoStreamer.overlayPosition,
      demoStreamer.overlayMediaWidth,
      demoStreamer.overlayMediaHeight,
      demoStreamer.overlayTextWidth,
      demoStreamer.overlayTextHeight,
      demoStreamer.overlayTextFontSize,
      demoStreamer.overlayAnimation,
      demoStreamer.ttsVoice,
      demoStreamer.overlayToken,
      now,
      now,
    ).run();
  await db.prepare(`UPDATE streamers SET overlay_token = ?, updated_at = ?
    WHERE id = 'demo-streamer' AND overlay_token = 'demo-overlay-pixel-anya'`).bind(demoStreamer.overlayToken, now).run();
}

export function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `streamer-${crypto.randomUUID().slice(0, 6)}`;
}

export async function getStreamerBySlug(slug: string) {
  await ensureDatabase();
  return getD1().prepare("SELECT * FROM streamers WHERE slug = ? LIMIT 1")
    .bind(slug).first<StreamerRecord>();
}

export async function getStreamerByToken(token: string) {
  await ensureDatabase();
  return getD1().prepare("SELECT * FROM streamers WHERE overlay_token = ? LIMIT 1")
    .bind(token).first<StreamerRecord>();
}

export async function getStreamerByOwner(ownerUserId: string) {
  await ensureDatabase();
  return getD1().prepare("SELECT * FROM streamers WHERE owner_user_id = ? LIMIT 1")
    .bind(ownerUserId).first<StreamerRecord>();
}

export async function getDemoStreamer() {
  return ensureStreamerForOwner("demo-owner", demoStreamer.displayName);
}

export async function ensureStreamerForOwner(ownerUserId: string, displayName: string) {
  await ensureDatabase();
  const existing = await getStreamerByOwner(ownerUserId);
  if (existing) return existing;

  const now = Date.now();
  const id = crypto.randomUUID();
  const slug = `${normalizeSlug(displayName)}-${id.slice(0, 5)}`;
  await getD1().prepare(`INSERT INTO streamers
    (id, owner_user_id, slug, display_name, cooldown_seconds, media_display_seconds, text_display_seconds, overlay_position, overlay_media_width, overlay_media_height, overlay_text_width, overlay_text_height, overlay_text_font_size, overlay_animation, tts_voice, overlay_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, 30, 5, 5, 'bottom-right', 360, 300, 480, 160, 28, 'pop', 'system', ?, ?, ?)`)
    .bind(id, ownerUserId, slug, displayName, crypto.randomUUID(), now, now).run();
  return getStreamerByOwner(ownerUserId) as Promise<StreamerRecord>;
}

export async function updateStreamerSettings(ownerUserId: string, input: { displayName: string; slug: string; cooldownSeconds: number; mediaDisplaySeconds: number; textDisplaySeconds: number; overlayPosition: OverlayPosition; overlayMediaWidth: number; overlayMediaHeight: number; overlayTextWidth: number; overlayTextHeight: number; overlayTextFontSize: number; overlayAnimation: OverlayAnimation; ttsVoice: TtsVoicePreset }) {
  const streamer = await ensureStreamerForOwner(ownerUserId, input.displayName);
  await getD1().prepare(`UPDATE streamers
    SET display_name = ?, slug = ?, cooldown_seconds = ?, media_display_seconds = ?, text_display_seconds = ?, overlay_position = ?, overlay_media_width = ?, overlay_media_height = ?, overlay_text_width = ?, overlay_text_height = ?, overlay_text_font_size = ?, overlay_animation = ?, tts_voice = ?, updated_at = ?
    WHERE id = ?`)
    .bind(input.displayName, normalizeSlug(input.slug), input.cooldownSeconds, input.mediaDisplaySeconds, input.textDisplaySeconds, input.overlayPosition, input.overlayMediaWidth, input.overlayMediaHeight, input.overlayTextWidth, input.overlayTextHeight, input.overlayTextFontSize, input.overlayAnimation, input.ttsVoice, Date.now(), streamer.id).run();
  return getStreamerByOwner(ownerUserId);
}
