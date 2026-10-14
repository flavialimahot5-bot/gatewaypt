CREATE TABLE trackerorder_jobs (
  transaction_id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  connection_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  tracking_code TEXT,
  pending_credits INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX trackerorder_jobs_due ON trackerorder_jobs(state,next_at);
--> statement-breakpoint
CREATE INDEX trackerorder_jobs_created ON trackerorder_jobs(created_at);
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN trackerorder_code TEXT;
