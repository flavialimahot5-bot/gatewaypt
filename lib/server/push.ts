import webpush from "web-push";
import { z } from "zod";
import { db, env, now, setting, allowedEmails } from "./core";
import { ApiError, hash, seal, unseal } from "./security";
import { credentialVersion } from "./password";
const encryption = () => env.APP_ENCRYPTION_KEY || "";

export function validatePushEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  const host = url.hostname;
  const allowed = host === "web.push.apple.com" || host.endsWith(".push.apple.com") ||
    host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com";
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !allowed)
    throw new ApiError(422, "invalid_push_endpoint", "Serviço de notificação não suportado.");
  return url.href;
}
async function vapid() {
  let stored = await setting("push_vapid");
  if (!stored) {
    const keys = webpush.generateVAPIDKeys();
    const encrypted = seal(JSON.stringify(keys), encryption());
    await db().prepare("INSERT OR IGNORE INTO settings(id,value,updated_at) VALUES ('push_vapid',?,?)")
      .bind(encrypted, now()).run();
    stored = await setting("push_vapid");
  }
  return JSON.parse(unseal(stored!, encryption())) as {publicKey: string; privateKey: string};
}
export async function pushConfiguration() {
  return { public_key: (await vapid()).publicKey };
}
export async function savePushSubscription(input: unknown, owner: string) {
  const data = z.object({ endpoint: z.string().url().max(2048), expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict(),
  }).strict().parse(input);
  data.endpoint = validatePushEndpoint(data.endpoint);
  const version = credentialVersion(owner);
  if (!version) throw new ApiError(403, "forbidden", "Conta não autorizada.");
  const id = hash(data.endpoint);
  const count = await db().prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE owner=? AND revoked_at IS NULL AND id<>?")
    .bind(owner,id).first<{n:number}>();
  if (count && count.n >= 10) throw new ApiError(422, "device_limit", "Limite de 10 aparelhos atingido.");
  // Initialize once and never replace keys: existing iPhones depend on this VAPID pair.
  await vapid();
  await db().batch([
    db().prepare("INSERT OR IGNORE INTO settings(id,value,updated_at) VALUES ('push_started_at',?,?)").bind(String(now()),now()),
    db().prepare("INSERT INTO push_subscriptions(id,owner,credential_version,subscription,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,credential_version=excluded.credential_version,subscription=excluded.subscription,created_at=CASE WHEN push_subscriptions.revoked_at IS NOT NULL OR push_subscriptions.owner<>excluded.owner THEN excluded.created_at ELSE push_subscriptions.created_at END,revoked_at=NULL")
      .bind(id,owner,version,seal(JSON.stringify(data),encryption()),now()),
  ]);
  return { enabled: true };
}
export async function revokePushSubscription(input: unknown, owner: string) {
  const {endpoint} = z.object({endpoint:z.string().url().max(2048)}).strict().parse(input);
  await db().prepare("UPDATE push_subscriptions SET revoked_at=? WHERE id=? AND owner=?")
    .bind(now(),hash(validatePushEndpoint(endpoint)),owner).run();
  return { enabled: false };
}
export async function pushSubscriptionStatus(input: unknown, owner: string) {
  const {endpoint} = z.object({endpoint:z.string().url().max(2048)}).strict().parse(input);
  const row = await db().prepare("SELECT credential_version FROM push_subscriptions WHERE id=? AND owner=? AND revoked_at IS NULL")
    .bind(hash(validatePushEndpoint(endpoint)),owner).first<{credential_version:string}>();
  return { enabled: !!row && row.credential_version === credentialVersion(owner) };
}
async function send(subscription: any, payload: object) {
  validatePushEndpoint(subscription.endpoint);
  const keys = await vapid();
  const details = webpush.generateRequestDetails(subscription, JSON.stringify(payload), {
    TTL: 3600, urgency: "high", contentEncoding: "aes128gcm",
    vapidDetails: { ...keys, subject: "mailto:" + allowedEmails()[0] },
  });
  const response = await fetch(details.endpoint, {
    method: "POST", headers: details.headers as Record<string,string>,
    body: new Uint8Array(details.body!), redirect: "error", signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  return response.status;
}
export async function testPush(input: unknown, owner: string) {
  const {endpoint} = z.object({endpoint:z.string().url().max(2048)}).strict().parse(input);
  const row = await db().prepare("SELECT subscription,credential_version FROM push_subscriptions WHERE id=? AND owner=? AND revoked_at IS NULL")
    .bind(hash(validatePushEndpoint(endpoint)),owner).first<any>();
  if (!row || row.credential_version !== credentialVersion(owner)) throw new ApiError(404,"not_found","Ative as notificações neste aparelho primeiro.");
  const status = await send(JSON.parse(unseal(row.subscription,encryption())), {
    title: "Goti Pay · Notificações ativadas", body: "Este é um aviso de teste. Nenhuma venda foi criada.", tag: "braks-test", url: "/topsdlsodo?section=Dashboard",
  });
  if (status < 200 || status >= 300) throw new ApiError(502,"push_failed","O aparelho não aceitou o aviso. Desative e ative as notificações novamente.");
  return {sent:true};
}
export function paymentPushPayload(row: { event: string; transaction_id: string; amount: number; external_source?: string | null; external_method?: string | null }) {
  const portugal = row.external_source === "broski";
  const amount = new Intl.NumberFormat(portugal ? "pt-PT" : "pt-BR", { style: "currency", currency: portugal ? "EUR" : "BRL" }).format(row.amount / 100);
  return {
    title: portugal ? "Pagamento aprovado · Portugal 🇵🇹" : row.event === "PAID" ? "Transação Paga! 🤹🏻" : "Transação Pendente!",
    body: portugal ? `Valor: ${amount} · ${row.external_method === "mbway" ? "MB WAY" : "Multibanco"} · Broski` : `Valor: ${amount}`,
    tag: "braks-" + row.transaction_id + "-" + row.event,
    url: portugal ? "/topsdlsodo?section=Gateways" : "/topsdlsodo?section=Vendas",
  };
}
export async function dispatchPush(limit = 10) {
  // Fan-out survives process termination: payment and event are committed atomically.
  const time = now(), cutoff = time - 86400000;
  // Prepare recipients only once. The atomic marker survives restarts; failed
  // sends remain in push_deliveries and keep their independent retry schedule.
  await db().batch([
    db().prepare("INSERT OR IGNORE INTO push_deliveries(id,event_id,subscription_id,next_at) SELECT e.id||':'||s.id,e.id,s.id,? FROM push_events e JOIN push_subscriptions s ON s.created_at<=e.created_at AND s.revoked_at IS NULL WHERE e.fanout_at IS NULL AND e.created_at>=?")
      .bind(time,cutoff),
    db().prepare("UPDATE push_events SET fanout_at=? WHERE fanout_at IS NULL AND created_at>=?").bind(time,cutoff),
  ]);
  const due = await db().prepare("SELECT d.*,e.event,e.transaction_id,e.created_at,e.external_source,e.external_method,s.owner,s.credential_version,s.subscription,CASE WHEN e.external_source='broski' THEN e.external_amount ELSE t.amount END AS amount,CASE WHEN e.external_source='broski' THEN 'PAID' ELSE t.status END AS status FROM push_deliveries d JOIN push_events e ON e.id=d.event_id JOIN push_subscriptions s ON s.id=d.subscription_id LEFT JOIN transactions t ON t.id=e.transaction_id WHERE (t.id IS NOT NULL OR (e.external_source='broski' AND e.external_currency='EUR' AND e.external_amount>0 AND e.event='PAID')) AND d.sent_at IS NULL AND d.attempts<8 AND d.next_at<=? AND d.lease_until<? AND s.revoked_at IS NULL AND e.created_at>=s.created_at AND e.created_at>=? ORDER BY d.next_at LIMIT ?")
    .bind(now(),now(),now()-86400000,limit).all<any>();
  let sent = 0;
  await Promise.all(due.results.map(async row => {
    const lease=now()+30000;
    const claim=await db().prepare("UPDATE push_deliveries SET lease_until=?,attempts=attempts+1 WHERE id=? AND lease_until<? AND next_at<=? AND sent_at IS NULL AND attempts<8 RETURNING id")
      .bind(lease,row.id,now(),now()).first();
    if(!claim)return;
    let status=0;
    if(!allowedEmails().includes(row.owner) || credentialVersion(row.owner)!==row.credential_version) {
      await db().prepare("UPDATE push_subscriptions SET revoked_at=? WHERE id=?").bind(now(),row.subscription_id).run();
      return;
    }
    // A delayed pending alert must never arrive after approval or expiration.
    if((row.event==='PENDING' && row.status!=='PENDING') || (row.event==='PAID' && row.status!=='PAID')) {
      await db().prepare("UPDATE push_deliveries SET attempts=8,last_status=204,lease_until=0 WHERE id=?").bind(row.id).run();
      return;
    }
    try {
      status=await send(JSON.parse(unseal(row.subscription,encryption())), paymentPushPayload(row));
    } catch { /* Endpoint and keys must not appear in logs. */ }
    const delivered=status>=200 && status<300;
    if(status===404 || status===410)await db().prepare("UPDATE push_subscriptions SET revoked_at=? WHERE id=?").bind(now(),row.subscription_id).run();
    await db().prepare("UPDATE push_deliveries SET sent_at=?,last_status=?,next_at=?,lease_until=0 WHERE id=? AND lease_until=?")
      .bind(delivered?now():null,status,now()+Math.min(3600000,30000*2**row.attempts),row.id,lease).run();
    if(delivered)sent++;
  }));
  return {sent};
}
export async function pushBackground() {
  try { await dispatchPush(); }
  catch { console.error("Push delivery unavailable; queued notifications retained"); }
}
