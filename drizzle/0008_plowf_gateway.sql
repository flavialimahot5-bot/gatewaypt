CREATE TABLE `gateway_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`external_reference` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`next_at` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gateway_events_due_idx` ON `gateway_events` (`processed_at`,`next_at`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `gateway` text DEFAULT 'pagpixhub' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `gateway_connection` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `gateway_sent_at` integer;