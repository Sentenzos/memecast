CREATE TABLE `meme_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`title` text NOT NULL,
	`preview_url` text,
	`media_url` text NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_meme_assets_provider_id` ON `meme_assets` (`provider`,`provider_id`);