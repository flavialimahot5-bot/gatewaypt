ALTER TABLE `push_events` ADD `fanout_at` integer;--> statement-breakpoint
CREATE INDEX `push_events_unprepared` ON `push_events` (`created_at`) WHERE "push_events"."fanout_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_product_orders_created` ON `product_orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `tracking_context_cleanup` ON `tracking_context` (`completed`,`created_at`);--> statement-breakpoint
CREATE INDEX `tracking_events_expiry` ON `tracking_events` (`created_at`) WHERE "tracking_events"."delivered_at" IS NULL AND "tracking_events"."payload" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_transactions_order_lookup` ON `transactions` (`idempotency_key`,`key_id`);--> statement-breakpoint
CREATE INDEX `idx_transactions_created` ON `transactions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_transactions_pending_updated` ON `transactions` (`updated_at`) WHERE "transactions"."status" IN ('PENDING','CREATING');