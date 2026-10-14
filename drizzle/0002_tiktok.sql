CREATE TABLE `tracking_context` (
	`order_id` text PRIMARY KEY NOT NULL,
	`context` text NOT NULL,
	`created_at` integer NOT NULL,
	`checked_at` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tracking_context_pending` ON `tracking_context` (`completed`,`checked_at`);--> statement-breakpoint
CREATE TABLE `tracking_events` (
	`id` text PRIMARY KEY NOT NULL,
	`pixel_id` text NOT NULL,
	`store_slug` text NOT NULL,
	`event` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`delivered_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `tracking_events_pending` ON `tracking_events` (`delivered_at`,`next_at`,`lease_until`);--> statement-breakpoint
CREATE TABLE `tracking_pixels` (
	`pixel_id` text NOT NULL,
	`store_slug` text NOT NULL,
	`access_token` text NOT NULL,
	`label` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`store_slug`, `pixel_id`)
);
