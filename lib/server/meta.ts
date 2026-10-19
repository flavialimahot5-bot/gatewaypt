import { isIP } from "node:net";
import { db, env, now } from "./core";
import { hash, seal, unseal } from "./security";

// Isolated from TikTok by store and context namespace; credentials are per database.
const STORE = "meta";
const key = () => env.APP_ENCRYPTION_KEY || "";
export async function rememberMetaOrder(request: Request, order: {id: string; product_id: string; method: string; created_at: number},
  buyer: {email: string; phone?: string}, quantity: number,
  attribution?: {visit: string; fbc?: string; fbp?: string}) {
  if (order.method !== "mbway") return;
  const pixels = (await db().prepare("SELECT pixel_id FROM tracking_pixels WHERE store_slug=? AND is_active=1 AND created_at<=?")
    .bind(STORE, order.created_at).all<{pixel_id: string}>()).results.map(p => p.pixel_id);
  if (!pixels.length) return;
  const user: Record<string, unknown> = { em: [hash(buyer.email.trim().toLowerCase())] };
  let phone = (buyer.phone || "").replace(/\D/g, "");
  if (phone.startsWith("00351")) phone = phone.slice(2);
  if (/^9\d{8}$/.test(phone)) phone = "351" + phone;
  if (/^3519\d{8}$/.test(phone)) user.ph = [hash(phone)];
  if (attribution?.visit) user.external_id = [hash(attribution.visit)];
  if (attribution?.fbc) user.fbc = attribution.fbc;
  if (attribution?.fbp) user.fbp = attribution.fbp;
  const agent = request.headers.get("user-agent")?.slice(0, 500);
  if (agent) user.client_user_agent = agent;
  const ip = env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() : undefined;
  if (ip && isIP(ip)) user.client_ip_address = ip;
  await db().prepare("INSERT OR IGNORE INTO tracking_context(order_id,context,created_at) VALUES (?,?,?)")
    .bind("meta:" + order.id, seal(JSON.stringify({pixels, user, quantity,
      product: order.product_id, url: `${env.APP_ORIGIN}/comprar/${order.product_id}`}), key()), now()).run();
}

export async function queueMetaOrder(id: string) {
  const row = await db().prepare(`SELECT c.context,o.* FROM tracking_context c JOIN pt_orders o ON c.order_id='meta:'||o.id
    WHERE o.id=? AND c.completed=0 AND o.method='mbway' AND o.provider_id IS NOT NULL
    AND o.status IN ('pending','awaiting_payment','paid')`).bind(id).first<any>();
  if (!row) return;
  const context = JSON.parse(unseal(row.context, key()));
  for (const pixel of context.pixels) {
    const eventId = hash(`meta:${pixel}:mbway_generated:${id}`);
    const event = { event_name: "Purchase", event_id: eventId,
      event_time: Math.floor(row.updated_at / 1000), action_source: "website", event_source_url: context.url,
      user_data: context.user, custom_data: { currency: "EUR", value: row.amount / 100,
        order_id: id, content_type: "product", content_ids: [context.product],
        contents: [{id: context.product, quantity: context.quantity}], num_items: context.quantity,
        conversion_stage: "mbway_generated" } };
    await db().prepare(`INSERT OR IGNORE INTO tracking_events(id,pixel_id,store_slug,event,payload,created_at,next_at)
      SELECT ?,?,'meta','Purchase',?,?,? WHERE EXISTS
      (SELECT 1 FROM tracking_pixels WHERE store_slug='meta' AND pixel_id=? AND is_active=1)`)
      .bind(eventId,pixel,seal(JSON.stringify(event),key()),now(),now(),pixel).run();
  }
  await db().prepare("UPDATE tracking_context SET completed=1,checked_at=? WHERE order_id=?")
    .bind(now(),"meta:"+id).run();
}

export async function dispatchMeta(limit = 5) {
  const rows = await db().prepare(`SELECT e.*,p.access_token FROM tracking_events e JOIN tracking_pixels p
    ON p.pixel_id=e.pixel_id AND p.store_slug=e.store_slug WHERE e.store_slug='meta' AND p.is_active=1
    AND e.delivered_at IS NULL AND e.payload IS NOT NULL AND e.attempts<12 AND e.next_at<=? AND e.lease_until<?
    ORDER BY e.next_at LIMIT ?`).bind(now(),now(),Math.min(20,limit)).all<any>();
  let sent = 0;
  await Promise.all(rows.results.map(async row => {
    const lease = now()+30000;
    const claimed = await db().prepare(`UPDATE tracking_events SET lease_until=?,attempts=attempts+1
      WHERE id=? AND lease_until<? AND next_at<=? AND delivered_at IS NULL AND payload IS NOT NULL AND attempts<12 RETURNING id`)
      .bind(lease,row.id,now(),now()).first();
    if (!claimed) return;
    let failure = "network";
    try {
      const data = JSON.parse(unseal(row.payload,key()));
      if (data.event_time < Math.floor(now()/1000)-7*86400) {
        await db().prepare("UPDATE tracking_events SET payload=NULL,last_error='expired',lease_until=0 WHERE id=? AND lease_until=?")
          .bind(row.id,lease).run();
        return;
      }
      const response = await fetch(`https://graph.facebook.com/v26.0/${encodeURIComponent(row.pixel_id)}/events`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: {"Content-Type":"application/json", Authorization: "Bearer "+unseal(row.access_token,key())},
        body: JSON.stringify({data:[data], ...(env.META_TEST_EVENT_CODE ? {test_event_code:env.META_TEST_EVENT_CODE} : {})}),
      });
      failure = "http_"+response.status;
      if (response.ok) {
        const result = await response.json();
        if (result.events_received === 1 && !result.error) {
          await db().prepare("UPDATE tracking_events SET delivered_at=?,payload=NULL,last_error=NULL,lease_until=0 WHERE id=? AND lease_until=?")
            .bind(now(),row.id,lease).run();
          sent++; return;
        }
        failure = "invalid_response";
      }
    } catch { /* Never log tokens, customer data or upstream response bodies. */ }
    await db().prepare("UPDATE tracking_events SET last_error=?,next_at=?,lease_until=0 WHERE id=? AND lease_until=?")
      .bind(failure,now()+Math.min(3600000,30000*2**row.attempts),row.id,lease).run();
  }));
  return {sent};
}

export async function metaBackground() {
  try {
    const rows = await db().prepare(`SELECT o.id FROM tracking_context c JOIN pt_orders o ON c.order_id='meta:'||o.id
      WHERE c.completed=0 AND o.provider_id IS NOT NULL ORDER BY c.checked_at LIMIT 30`).all<{id:string}>();
    for (const row of rows.results) {
      await queueMetaOrder(row.id);
      await db().prepare(`UPDATE tracking_context SET checked_at=?,completed=CASE WHEN EXISTS
        (SELECT 1 FROM pt_orders WHERE id=? AND status IN ('failed','expired','refunded')) THEN 1 ELSE completed END WHERE order_id=?`)
        .bind(now(),row.id,"meta:"+row.id).run();
    }
    await dispatchMeta();
  } catch { console.error("Meta delivery unavailable; payment preserved"); }
}
