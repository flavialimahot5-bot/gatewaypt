CREATE TABLE `push_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`last_status` integer
);
--> statement-breakpoint
CREATE INDEX `push_deliveries_pending` ON `push_deliveries` (`sent_at`,`next_at`,`lease_until`);--> statement-breakpoint
CREATE TABLE `push_events` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`event` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`credential_version` text NOT NULL,
	`subscription` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
