import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.startsWith('0010')).sort())
  db.exec(readFileSync('drizzle/' + file, 'utf8'));
const tracking = "SELECT t.id FROM tracking_context c JOIN transactions t ON t.idempotency_key=c.order_id AND t.key_id LIKE 'product:%' WHERE c.completed=0 ORDER BY c.checked_at LIMIT 30";
const dashboard = 'SELECT id FROM transactions WHERE created_at>=100 AND created_at<200 ORDER BY created_at DESC LIMIT 100';
const plan = sql => db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => r.detail).join('\n');
assert.match(plan(tracking), /SCAN t/);
assert.match(plan(dashboard), /SCAN transactions/);
db.exec(readFileSync('drizzle/0010_read_efficiency.sql', 'utf8'));
assert.match(plan(tracking), /SEARCH t USING (?:COVERING )?INDEX idx_transactions_order_lookup/);
assert.doesNotMatch(plan(tracking), /SCAN t/);
assert.match(plan(dashboard), /SEARCH transactions USING (?:COVERING )?INDEX idx_transactions_created/);
assert.match(plan('SELECT id FROM push_events WHERE fanout_at IS NULL AND created_at>=100'), /INDEX push_events_unprepared/);
console.log('Tracking: full transaction scan replaced by order index lookup.');
console.log('Dashboard: full history scan replaced by date range index.');
console.log('Push: only unprepared events are searched by indexed date.');
db.close();
