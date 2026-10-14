CREATE TABLE `product_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`snapshot` text NOT NULL,
	`buyer` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_product_orders_product` ON `product_orders` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`image` text NOT NULL,
	`shipping` integer DEFAULT 0 NOT NULL,
	`delivery_days` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "products_amount_min" CHECK("products"."amount" >= 500),
	CONSTRAINT "products_shipping_min" CHECK("products"."shipping" >= 0)
);
