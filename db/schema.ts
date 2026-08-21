import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const streamers = sqliteTable("streamers", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  slug: text("slug").notNull(),
  twitchUserId: text("twitch_user_id"),
  twitchLogin: text("twitch_login"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(30),
  mediaDisplaySeconds: integer("media_display_seconds").notNull().default(5),
  textDisplaySeconds: integer("text_display_seconds").notNull().default(5),
  overlayPosition: text("overlay_position").notNull().default("bottom-right"),
  overlayMediaWidth: integer("overlay_media_width").notNull().default(360),
  overlayMediaHeight: integer("overlay_media_height").notNull().default(300),
  overlayAnimation: text("overlay_animation").notNull().default("pop"),
  overlayToken: text("overlay_token").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_streamers_owner_user_id").on(table.ownerUserId),
  uniqueIndex("idx_streamers_slug").on(table.slug),
  uniqueIndex("idx_streamers_overlay_token").on(table.overlayToken),
]);

export const memeAssets = sqliteTable("meme_assets", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  providerId: text("provider_id").notNull(),
  title: text("title").notNull(),
  previewUrl: text("preview_url"),
  mediaUrl: text("media_url").notNull(),
  mediaType: text("media_type").notNull().default("video"),
  sourceType: text("source_type").notNull().default("upload"),
  sourceUrl: text("source_url"),
  tags: text("tags"),
  mimeType: text("mime_type"),
  storageKey: text("storage_key"),
  sizeBytes: integer("size_bytes"),
  width: integer("width"),
  height: integer("height"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_meme_assets_provider_id").on(table.provider, table.providerId),
]);

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  streamerId: text("streamer_id").notNull().references(() => streamers.id, { onDelete: "cascade" }),
  memeId: text("meme_id"),
  message: text("message"),
  viewerName: text("viewer_name"),
  viewerKey: text("viewer_key").notNull(),
  viewerIp: text("viewer_ip"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
}, (table) => [
  index("idx_alerts_streamer_created").on(table.streamerId, table.createdAt),
  index("idx_alerts_streamer_viewer_created").on(table.streamerId, table.viewerKey, table.createdAt),
]);

export const blockedViewers = sqliteTable("blocked_viewers", {
  id: text("id").primaryKey(),
  streamerId: text("streamer_id").notNull().references(() => streamers.id, { onDelete: "cascade" }),
  ipAddress: text("ip_address").notNull(),
  viewerName: text("viewer_name"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_blocked_viewers_streamer_ip").on(table.streamerId, table.ipAddress),
]);
