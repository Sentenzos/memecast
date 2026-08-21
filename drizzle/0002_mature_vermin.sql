PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`streamer_id` text NOT NULL,
	`meme_id` text,
	`message` text,
	`viewer_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`streamer_id`) REFERENCES `streamers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_alerts`("id", "streamer_id", "meme_id", "message", "viewer_key", "created_at") SELECT "id", "streamer_id", "meme_id", NULL, "viewer_key", "created_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_alerts_streamer_created` ON `alerts` (`streamer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_alerts_streamer_viewer_created` ON `alerts` (`streamer_id`,`viewer_key`,`created_at`);--> statement-breakpoint
ALTER TABLE `meme_assets` ADD `media_type` text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE `meme_assets` ADD `mime_type` text;--> statement-breakpoint
ALTER TABLE `meme_assets` ADD `storage_key` text;--> statement-breakpoint
ALTER TABLE `meme_assets` ADD `size_bytes` integer;
