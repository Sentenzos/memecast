CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`streamer_id` text NOT NULL,
	`meme_id` text NOT NULL,
	`viewer_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`streamer_id`) REFERENCES `streamers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_streamer_created` ON `alerts` (`streamer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_alerts_streamer_viewer_created` ON `alerts` (`streamer_id`,`viewer_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `streamers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`slug` text NOT NULL,
	`twitch_user_id` text,
	`twitch_login` text,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`cooldown_seconds` integer DEFAULT 30 NOT NULL,
	`overlay_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_streamers_owner_user_id` ON `streamers` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_streamers_slug` ON `streamers` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_streamers_overlay_token` ON `streamers` (`overlay_token`);