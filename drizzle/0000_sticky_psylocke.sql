CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`callback` text,
	`webhook_secret` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`delivered_at` integer,
	`last_status` integer
);
--> statement-breakpoint
CREATE INDEX `idx_deliveries_due` ON `deliveries` (`delivered_at`,`next_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_limits_expires` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`provider_id` text,
	`external_reference` text NOT NULL,
	`amount` integer NOT NULL,
	`fee` integer DEFAULT 0 NOT NULL,
	`net` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`pix_status` text,
	`copy_paste` text,
	`expires_at` text,
	`checkout_hash` text NOT NULL,
	`checkout_token` text NOT NULL,
	`description` text NOT NULL,
	`customer` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`paid_at` integer,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_provider_id_unique` ON `transactions` (`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_checkout_hash_unique` ON `transactions` (`checkout_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transactions_idempotency` ON `transactions` (`key_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_transactions_key_created` ON `transactions` (`key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_transactions_paid` ON `transactions` (`paid_at`);