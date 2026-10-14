CREATE TABLE pt_orders (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 payload TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'creating', provider_id TEXT UNIQUE,
 voucher TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 lease_until INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, email_sent INTEGER NOT NULL DEFAULT 0, fallback_at INTEGER NOT NULL DEFAULT 0,
 refunded INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE pt_events (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, received_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE pt_refunds (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, request_hash TEXT NOT NULL, payload TEXT NOT NULL, response TEXT);
