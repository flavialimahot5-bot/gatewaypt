CREATE TABLE `checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`order_id` text
);
--> statement-breakpoint
CREATE INDEX `checkout_sessions_created` ON `checkout_sessions` (`created_at`);--> statement-breakpoint
CREATE INDEX `checkout_sessions_live` ON `checkout_sessions` (`last_seen`);