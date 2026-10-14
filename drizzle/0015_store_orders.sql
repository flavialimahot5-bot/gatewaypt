CREATE TABLE store_orders (
 id TEXT PRIMARY KEY, key_id TEXT NOT NULL, session_hash TEXT NOT NULL,
 attempt TEXT NOT NULL, request_hash TEXT NOT NULL, snapshot TEXT NOT NULL,
 buyer TEXT NOT NULL, charge_body TEXT NOT NULL, amount INTEGER NOT NULL,
 transaction_id TEXT UNIQUE, created_at INTEGER NOT NULL, paid_at INTEGER,
 UNIQUE(key_id,session_hash,attempt)
);
--> statement-breakpoint
CREATE INDEX store_orders_pending ON store_orders(paid_at,created_at);
--> statement-breakpoint
CREATE TABLE store_webhook_events (
 key_id TEXT NOT NULL, event_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 order_id TEXT NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY(key_id,event_id)
);
--> statement-breakpoint
CREATE TABLE store_effects (
 order_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING',
 created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER,
 result TEXT, PRIMARY KEY(order_id,kind)
);
