ALTER TABLE `meme_assets` ADD `source_type` text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `meme_assets` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `meme_assets` ADD `tags` text;