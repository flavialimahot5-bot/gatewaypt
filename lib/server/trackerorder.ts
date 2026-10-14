import { z } from "zod";
import { audit, db, env, now, setting } from "./core";
import { ApiError, hash, seal, unseal } from "./security";
import { normalizeBrazilPhone } from "../buyer-fields";

const endpoint = "https://api.trackerorders.online/functions/v1/create-order";
const Config = z.object({ token: z.string().min(20).max(4000), webhook_key: z.string().regex(/^[a-zA-Z0-9_-]{16,200}$/) });
const codeSchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
async function configuration() {
  const value = await setting("trackerorder_config");
  return value ? Config.parse(JSON.parse(unseal(value, env.APP_ENCRYPTION_KEY || ""))) : null;
}
export async function trackerOrderEnabled() {
  return Number(await setting("trackerorder_enabled_since")) > 0;
}
export async function trackerOrderOverview() {
  const [configured, enabled, jobs] = await Promise.all([
    setting("trackerorder_config"), trackerOrderEnabled(),
    db().prepare("SELECT transaction_id,order_id,state,attempts,tracking_code,pending_credits,last_status,last_error,created_at FROM trackerorder_jobs ORDER BY created_at DESC LIMIT 20").all(),
  ]);
  return { configured: !!configured, enabled, jobs: jobs.results };
}
export async function saveTrackerOrder(input: unknown, actor: string) {
  const body = z.object({ enabled: z.boolean(), token: z.string().trim().max(4000).optional(), webhook_key: z.string().trim().max(200).optional() }).strict().parse(input);
  const old = await configuration();
  const config = Config.safeParse({ token: body.token || old?.token, webhook_key: body.webhook_key || old?.webhook_key });
  if (!config.success) throw new ApiError(422, "trackerorder_config_required", "Informe o Bearer e a Webhook Key do projeto no TrackerOrder.");
  const connection = hash(config.data.webhook_key);
  const previousConnection = await setting("trackerorder_connection");
  const previousSince = Number(await setting("trackerorder_enabled_since"));
  const since = body.enabled ? (connection === previousConnection && previousSince > 0 ? previousSince : now()) : 0;
  const values: [string, string][] = [
    ["trackerorder_config", seal(JSON.stringify(config.data), env.APP_ENCRYPTION_KEY || "")],
    ["trackerorder_connection", connection], ["trackerorder_enabled_since", String(since)],
  ];
  await db().batch(values.map(([id, value]) => db().prepare("INSERT INTO settings(id,value,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(id, value, now())));
  await audit(actor, body.enabled ? "trackerorder.enabled" : "trackerorder.disabled", "trackerorder");
  return trackerOrderOverview();
}

// Included in the same database batch as PAID. No network call can delay confirmation.
// Only product orders paid after activation are eligible; no historical backfill.
export function trackerOrderEnqueue(transactionId: string) {
  return db().prepare(`INSERT OR IGNORE INTO trackerorder_jobs(transaction_id,order_id,connection_id,next_at,created_at)
    SELECT t.id,o.id,c.value,?,? FROM transactions t
    JOIN product_orders o ON o.id=t.idempotency_key AND t.key_id='product:'||o.product_id
    JOIN settings s ON s.id='trackerorder_enabled_since' AND CAST(s.value AS INTEGER)>0
    JOIN settings c ON c.id='trackerorder_connection'
    WHERE t.id=? AND t.status='PAID' AND t.provider_id IS NOT NULL AND t.paid_at>=CAST(s.value AS INTEGER)`)
    .bind(now(), now(), transactionId);
}

export function trackerOrderPayload(order: { id: string; buyer: string; snapshot: string; amount: number }, webhookKey: string) {
  const buyer = z.object({ name: z.string().trim().min(3).max(120), email: z.string().email().max(254), phone: z.string().optional() })
    .parse(JSON.parse(unseal(order.buyer, env.APP_ENCRYPTION_KEY || "")));
  const product = z.object({ name: z.string().min(1).max(150), amount: z.number().int().nonnegative(), quantity: z.number().int().min(1).max(99).default(1), shipping: z.number().int().nonnegative() }).parse(JSON.parse(order.snapshot));
  if (product.amount * product.quantity + product.shipping !== order.amount) throw new Error("order_amount_mismatch");
  const phone = normalizeBrazilPhone(buyer.phone || "");
  const items = [{ name: product.name, qty: product.quantity, price: product.amount / 100 }];
  if (product.shipping) items.push({ name: "Frete", qty: 1, price: product.shipping / 100 });
  return {
    webhook_key: webhookKey, customer_name: buyer.name, customer_email: buyer.email,
    ...(/^\d{10,11}$/.test(phone) ? { customer_phone: "+55" + phone } : {}),
    order_items: JSON.stringify(items), total_value: order.amount / 100,
    external_order_id: order.id, email_flow_enabled: true,
  };
}

export async function dispatchTrackerOrders(limit = 3) {
  if (!await trackerOrderEnabled()) return;
  const config = await configuration();
  if (!config) return;
  const connection = hash(config.webhook_key);
  // A worker lost after POST may have created the remote order. Never replay it blindly.
  await db().prepare("UPDATE trackerorder_jobs SET state='REVIEW',last_error='delivery_uncertain' WHERE state='SENDING' AND started_at<?").bind(now() - 120000).run();
  const jobs = await db().prepare("SELECT transaction_id FROM trackerorder_jobs WHERE state='PENDING' AND next_at<=? ORDER BY next_at LIMIT ?").bind(now(), Math.min(5, Math.max(1, limit))).all<{ transaction_id: string }>();
  await Promise.all(jobs.results.map(async ({ transaction_id }) => {
    const job = await db().prepare(`UPDATE trackerorder_jobs SET state='SENDING',started_at=?,attempts=attempts+1
      WHERE transaction_id=? AND state='PENDING' AND next_at<=?
      AND EXISTS(SELECT 1 FROM settings WHERE id='trackerorder_enabled_since' AND CAST(value AS INTEGER)>0)
      RETURNING *`).bind(now(), transaction_id, now()).first<any>();
    if (!job) return;
    const finish = (state: string, reason: string, status: number | null = null, delay = 0) => db().prepare("UPDATE trackerorder_jobs SET state=?,last_error=?,last_status=?,next_at=? WHERE transaction_id=? AND state='SENDING'").bind(state, reason, status, now() + delay, transaction_id).run();
    if (job.connection_id !== connection || await setting("trackerorder_connection") !== connection) {
      await finish("REVIEW", "project_changed"); return;
    }
    const order = await db().prepare("SELECT o.id,o.buyer,o.snapshot,t.amount,t.status FROM product_orders o JOIN transactions t ON t.idempotency_key=o.id AND t.key_id='product:'||o.product_id WHERE t.id=?").bind(transaction_id).first<any>();
    if (!order || order.status !== "PAID") { await finish("CANCELLED", "not_paid"); return; }
    let payload;
    try { payload = trackerOrderPayload(order, config.webhook_key); }
    catch { await finish("FAILED", "customer_data_invalid"); return; }
    // Check again immediately before the external side effect.
    if (!await trackerOrderEnabled()) { await finish("PENDING", "paused"); return; }
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(10000),
      });
    } catch { await finish("REVIEW", "delivery_uncertain"); return; }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429 && job.attempts < 5) {
        await finish("PENDING", "rate_limited", 429, Math.min(3600000, 60000 * 2 ** (job.attempts - 1))); return;
      }
      const rejected = [400, 401, 403, 422, 429].includes(response.status);
      await finish(rejected ? "FAILED" : "REVIEW", rejected ? "request_rejected" : "delivery_uncertain", response.status); return;
    }
    let data: any;
    try { data = await response.json(); } catch { await finish("REVIEW", "invalid_response", response.status); return; }
    const code = codeSchema.safeParse(data?.tracking_code);
    if (!code.success || data.success === false || data.error) { await finish("REVIEW", "invalid_response", response.status); return; }
    await db().batch([
      db().prepare("UPDATE trackerorder_jobs SET state='SENT',tracking_code=?,pending_credits=?,completed_at=?,last_status=?,last_error=NULL WHERE transaction_id=? AND state IN ('SENDING','REVIEW')")
        .bind(code.data, data.pending_credits === true ? 1 : 0, now(), response.status, transaction_id),
      db().prepare("UPDATE transactions SET trackerorder_code=? WHERE id=?").bind(code.data, transaction_id),
    ]);
  }));
}
export async function trackerOrderBackground() {
  try { await dispatchTrackerOrders(); }
  catch { console.error("TrackerOrder delivery unavailable; queue retained"); }
}
