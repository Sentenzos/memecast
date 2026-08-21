ALTER TABLE `streamers` ADD `media_display_seconds` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `streamers` ADD `text_display_seconds` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `streamers` ADD `overlay_position` text DEFAULT 'bottom-right' NOT NULL;