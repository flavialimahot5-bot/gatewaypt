CREATE TABLE utmify_orders (
  order_id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  attribution TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_status TEXT,
  attempts_status TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL DEFAULT 0,
  refunded_at INTEGER,
  delivered_at INTEGER,
  last_error TEXT
);
--> statement-breakpoint
CREATE INDEX utmify_pending ON utmify_orders(next_at,lease_until,checked_at);
