CREATE TABLE `recovery_jobs` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`template` text NOT NULL,
	`config_version` text NOT NULL,
	`status` text DEFAULT 'WAITING' NOT NULL,
	`reason` text,
	`due_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recovery_due_idx` ON `recovery_jobs` (`status`,`due_at`);--> statement-breakpoint
ALTER TABLE `products` ADD `recovery_template` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `pix_generated_at` integer;