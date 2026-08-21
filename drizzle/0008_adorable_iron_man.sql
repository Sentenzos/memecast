CREATE TABLE `blocked_viewers` (
	`id` text PRIMARY KEY NOT NULL,
	`streamer_id` text NOT NULL,
	`ip_address` text NOT NULL,
	`viewer_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`streamer_id`) REFERENCES `streamers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_blocked_viewers_streamer_ip` ON `blocked_viewers` (`streamer_id`,`ip_address`);--> statement-breakpoint
ALTER TABLE `alerts` ADD `viewer_ip` text;--> statement-breakpoint
ALTER TABLE `alerts` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `alerts` ADD `completed_at` integer;