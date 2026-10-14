import { isIP } from "node:net";
import { z } from "zod";
import { db, env, now, rateLimit, audit } from "./core";
import { ApiError, assertOrigin, hash, readJson, seal, unseal } from "./security";

// This checkout operates in Brazil. Never accept store, event or price from a visitor.
export const TRACKING_STORE = "gateway";
export const trackingInput = z.object({
  visit: z.string().uuid(),
  ttclid: z.string().regex(/^[A-Za-z0-9_.~-]{1,500}$/).optional(),
  ttp: z.string().regex(/^[A-Za-z0-9_.~-]{1,250}$/).optional(),
}).strict();
type Attribution = z.infer<typeof trackingInput>;
type Context = {
  user: Record<string, string>;
  page: { url: string };
  pixels: string[];
  product: string;
  quantity?: number;
  pixOptimization?: boolean;
  purchaseOnPix?: boolean;
};
const key = () => env.APP_ENCRYPTION_KEY || "";
export async function saveTrackingPixel(input: unknown, actor: string) {
  const data = z.object({
    pixel_id: z.string().regex(/^[A-Z0-9]{16,32}$/),
    access_token: z.string().trim().min(16).max(500).optional(),
    label: z.string().trim().min(1).max(80),
    is_active: z.boolean(),
  }).strict().parse(input);
  const old = await db().prepare("SELECT access_token FROM tracking_pixels WHERE store_slug=? AND pixel_id=?")
    .bind(TRACKING_STORE, data.pixel_id).first<{access_token: string}>();
  if (!old && !data.access_token) throw new ApiError(422, "token_required", "Informe o token deste pixel.");
  const token = data.access_token ? seal(data.access_token, key()) : old!.access_token;
  await db().prepare("INSERT INTO tracking_pixels(pixel_id,store_slug,access_token,label,is_active,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(store_slug,pixel_id) DO UPDATE SET access_token=excluded.access_token,label=excluded.label,is_active=excluded.is_active")
    .bind(data.pixel_id, TRACKING_STORE, token, data.label, data.is_active ? 1 : 0, now()).run();
  await audit(actor, "tracking.pixel.updated", data.pixel_id);
}
export async function trackingOverview() {
  const pixels = await db().prepare("SELECT pixel_id,label,is_active,created_at FROM tracking_pixels WHERE store_slug=? ORDER BY created_at")
    .bind(TRACKING_STORE).all();
  const events = await db().prepare("SELECT pixel_id,event,COUNT(*) AS total,SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,SUM(CASE WHEN delivered_at IS NULL AND payload IS NOT NULL AND attempts<12 THEN 1 ELSE 0 END) AS pending FROM tracking_events WHERE store_slug=? GROUP BY pixel_id,event")
    .bind(TRACKING_STORE).all();
  const failures = await db().prepare("SELECT pixel_id,event,last_error,attempts,created_at FROM tracking_events WHERE store_slug=? AND delivered_at IS NULL AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 10")
    .bind(TRACKING_STORE).all();
  return { pixels: pixels.results, events: events.results, failures: failures.results, test_mode: !!env.TIKTOK_TEST_EVENT_CODE };
}
export async function getActivePixels() {
  return (await db().prepare(
    "SELECT pixel_id FROM tracking_pixels WHERE store_slug=? AND is_active=1",
  ).bind(TRACKING_STORE).all<{pixel_id: string}>()).results.map(p => p.pixel_id);
}
function requestUser(request: Request, input: Attribution) {
  const user: Record<string, string> = { external_id: hash(input.visit) };
  if (input.ttclid) user.ttclid = input.ttclid;
  if (input.ttp) user.ttp = input.ttp;
  const agent = request.headers.get("user-agent")?.slice(0, 500);
  if (agent) user.user_agent = agent;
  // Vercel overwrites this header. Do not trust visitor-supplied forwarded IPs elsewhere.
  const ip = env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() : undefined;
  if (ip && isIP(ip)) user.ip = ip;
  return user;
}
export function matchingUser(customer: {email?: string; phone?: string}) {
  const user: Record<string, string> = {};
  if (customer.email) user.email = hash(customer.email.trim().toLowerCase());
  let phone = customer.phone?.replace(/\D/g, "") || "";
  if (/^\d{10,11}$/.test(phone)) phone = "55" + phone;
  if (/^55\d{10,11}$/.test(phone)) user.phone = hash("+" + phone);
  return user;
}
async function queueEvent(event: "InitiateCheckout" | "PixGenerated" | "AddPaymentInfo" | "Purchase", identity: string,
  context: Context, amount: number, timestamp: number, extra: Record<string, unknown> = {}) {
  for (const pixel of context.pixels) {
    const id = hash(`${TRACKING_STORE}:${pixel}:${event}:${identity}`);
    const data = {
      event, event_id: id, event_time: Math.floor(timestamp / 1000),
      user: context.user, page: context.page,
      properties: { currency: "BRL", value: amount / 100, content_type: "product",
        contents: [{ content_id: context.product, quantity: context.quantity ?? 1 }], ...extra },
    };
    await db().prepare(
      "INSERT OR IGNORE INTO tracking_events(id,pixel_id,store_slug,event,payload,created_at,next_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM tracking_pixels WHERE pixel_id=? AND store_slug=? AND is_active=1)",
    ).bind(id, pixel, TRACKING_STORE, event, seal(JSON.stringify(data), key()), now(), now(), pixel, TRACKING_STORE).run();
  }
}
export async function startCheckoutTracking(request: Request) {
  assertOrigin(request, env.APP_ORIGIN || "");
  const body = z.object({ product_id: z.string().regex(/^prd_[A-Za-z0-9_-]{43}$/), tracking: trackingInput }).strict()
    .parse(await readJson(request, 2500));
  await rateLimit("tracking:global", 300);
  await rateLimit("tracking:visit:" + body.tracking.visit, 10);
  const product = await db().prepare("SELECT id,amount FROM products WHERE id=? AND active=1")
    .bind(body.product_id).first<{id: string; amount: number}>();
  if (!product) throw new ApiError(404, "not_found", "Produto indisponível.");
  const context: Context = {
    pixels: await getActivePixels(), product: product.id,
    user: requestUser(request, body.tracking),
    page: { url: `${env.APP_ORIGIN}/comprar/${product.id}` },
  };
  await queueEvent("InitiateCheckout", product.id + ":" + body.tracking.visit, context, product.amount, now());
}
export async function rememberOrderTracking(request: Request, orderId: string, product: string,
  input: Attribution, buyer: {email: string; phone: string}, quantity = 1) {
  const context: Context = {
    pixels: await getActivePixels(), product, quantity, pixOptimization: true, purchaseOnPix: true,
    user: { ...requestUser(request, input), ...matchingUser(buyer) },
    page: { url: `${env.APP_ORIGIN}/comprar/${product}` },
  };
  if (!context.pixels.length) return;
  await db().prepare("INSERT OR IGNORE INTO tracking_context(order_id,context,created_at) VALUES (?,?,?)")
    .bind(orderId, seal(JSON.stringify(context), key()), now()).run();
}
export async function trackTransaction(tx: any) {
  if (!tx || !String(tx.key_id).startsWith("product:")) return;
  const row = await db().prepare("SELECT context,created_at FROM tracking_context WHERE order_id=? AND completed=0")
    .bind(tx.idempotency_key).first<{context: string; created_at: number}>();
  if (!row) return; // Never backfill pre-integration orders or dashboard/API charges.
  const context: Context = JSON.parse(unseal(row.context, key()));
  if (tx.provider_id && tx.copy_paste) {
    // Merchant-selected conversion: one Purchase per generated Pix, never a second on settlement.
    // Versioned attribution preserves the original behavior for pre-change orders.
    if (context.purchaseOnPix)
      await queueEvent("Purchase", tx.id, context, tx.amount, tx.created_at, { order_id: tx.id, conversion_stage: "pix_generated" });
    await queueEvent("PixGenerated", tx.id, context, tx.amount, tx.created_at, { order_id: tx.id });
    // Standard optimization signal for completing the Pix payment-information step.
    // Opt in only newly attributed orders; do not relabel historical Pix events.
    if (context.pixOptimization)
      await queueEvent("AddPaymentInfo", tx.id, context, tx.amount, tx.created_at, { order_id: tx.id });
  }
  if (tx.provider_id && tx.status === "PAID" && tx.paid_at && !context.purchaseOnPix)
    await queueEvent("Purchase", tx.id, context, tx.amount, tx.paid_at, { order_id: tx.id });
  // Once all Pix conversions are durably queued, settlement has no additional
  // event to generate for these orders. Delivery retries live in tracking_events.
  const completed = !!(context.purchaseOnPix && tx.provider_id && tx.copy_paste) ||
    ["PAID", "FAILED", "EXPIRED", "REFUNDED", "CHARGEBACK"].includes(tx.status);
  await db().prepare("UPDATE tracking_context SET checked_at=?,completed=? WHERE order_id=?")
    .bind(now(), completed ? 1 : 0, tx.idempotency_key).run();
}
export async function safeTrackTransaction(tx: any) {
  try { await trackTransaction(tx); }
  catch { console.error("TikTok queue unavailable; payment preserved, reconciliation will retry"); }
}
export async function reconcileTracking() {
  const rows = await db().prepare(
    "SELECT t.* FROM tracking_context c JOIN transactions t ON t.idempotency_key=c.order_id AND t.key_id LIKE 'product:%' WHERE c.completed=0 ORDER BY c.checked_at LIMIT 30",
  ).all<any>();
  for (const tx of rows.results) await safeTrackTransaction(tx);
  // Keep deduplication IDs, but discard expired pending payloads and old attribution.
  await db().prepare("DELETE FROM tracking_context WHERE created_at<? AND completed=1")
    .bind(now() - 30 * 86400000).run();
  await db().prepare("UPDATE tracking_events SET payload=NULL,last_error='expired' WHERE delivered_at IS NULL AND created_at<? AND payload IS NOT NULL")
    .bind(now() - 7 * 86400000).run();
}
export async function dispatchTracking(limit = 5) {
  const rows = await db().prepare(
    "SELECT e.*,p.access_token FROM tracking_events e JOIN tracking_pixels p ON p.pixel_id=e.pixel_id AND p.store_slug=e.store_slug WHERE e.store_slug=? AND p.is_active=1 AND e.delivered_at IS NULL AND e.payload IS NOT NULL AND e.attempts<12 AND e.next_at<=? AND e.lease_until<? ORDER BY e.next_at LIMIT ?",
  ).bind(TRACKING_STORE, now(), now(), Math.min(20, limit)).all<any>();
  let sent = 0;
  // Independent deliveries in parallel keep the response's background work bounded.
  await Promise.all(rows.results.map(async row => {
    const lease = now() + 30000;
    const claimed = await db().prepare(
      "UPDATE tracking_events SET lease_until=?,attempts=attempts+1 WHERE id=? AND lease_until<? AND next_at<=? AND delivered_at IS NULL AND payload IS NOT NULL AND attempts<12 RETURNING id",
    ).bind(lease, row.id, now(), now()).first();
    if (!claimed) return;
    let failure = "network";
    try {
      const payload = {
        event_source: "web", event_source_id: row.pixel_id,
        data: [JSON.parse(unseal(row.payload, key()))],
        ...(env.TIKTOK_TEST_EVENT_CODE ? { test_event_code: env.TIKTOK_TEST_EVENT_CODE } : {}),
      };
      const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { "Content-Type": "application/json", "Access-Token": unseal(row.access_token, key()) },
        body: JSON.stringify(payload),
      });
      failure = "http_" + response.status;
      if (response.ok) {
        const result = await response.json();
        failure = typeof result.code === "number" ? "api_" + result.code : "invalid_response";
        if (result.code === 0) {
          await db().prepare("UPDATE tracking_events SET delivered_at=?,payload=NULL,last_error=NULL,lease_until=0 WHERE id=? AND lease_until=?")
            .bind(now(), row.id, lease).run();
          sent++;
          return;
        }
      }
    } catch { /* No secrets, matching identifiers or provider response bodies in logs. */ }
    await db().prepare("UPDATE tracking_events SET last_error=?,next_at=?,lease_until=0 WHERE id=? AND lease_until=?")
      .bind(failure, now() + Math.min(3600000, 30000 * 2 ** row.attempts), row.id, lease).run();
  }));
  return { sent };
}
export async function trackingBackground() {
  try { await reconcileTracking(); await dispatchTracking(); }
  catch { console.error("TikTok background delivery unavailable"); }
}
