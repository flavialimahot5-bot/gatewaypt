import { trackingInput, rememberOrderTracking, safeTrackTransaction } from './tiktok';
import { z } from 'zod';
import { db, env, now, setting, putSetting, audit, rateLimit } from './core';
import { ApiError, seal, unseal, hash, verify, readJson, assertOrigin } from './security';
import { findProduct } from './products';
import { linkCheckoutVisit } from './analytics';
import { BroskiOrder, BroskiError, broskiRequest, normalizePtPhone } from './broski-client';

const crypt = () => env.APP_ENCRYPTION_KEY || '';
async function config() {
  const saved = await setting('portugal_broski');
  return saved ? JSON.parse(unseal(saved, crypt())) : { token: env.BROSKI_API_KEY || '', secret: env.BROSKI_WEBHOOK_SECRET || '' };
}
export async function ptOverview() {
  const c = await config();
  return { configured: !!c.token, webhook_configured: !!c.secret, enabled: env.PUBLIC_API_ENABLED === 'true', email_configured: !!(env.RESEND_API_KEY && env.MAIL_FROM), webhook_url: `${env.APP_ORIGIN || ''}/api/pt/webhook`, orders: (await db().prepare('SELECT id,product_id,amount,method,status,provider_id,created_at,refunded,email_sent FROM pt_orders ORDER BY created_at DESC LIMIT 100').all()).results };
}
export async function ptConfigure(request: Request, actor: string) {
  const data = z.object({ token: z.string().regex(/^sk_live_[A-Za-z0-9_-]+$/).optional(), secret: z.string().regex(/^whbroski_[A-Za-z0-9_-]+$/).optional() }).strict().parse(await readJson(request));
  const previous = await config();
  await putSetting('portugal_broski', seal(JSON.stringify({ token: data.token || previous.token, secret: data.secret || previous.secret }), crypt()));
  await audit(actor, 'broski.configure', 'portugal');
  return ptOverview();
}
const Buyer = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(254), phone: z.string().max(30).optional(), nif: z.string().regex(/^\d{9}$/).optional(), address: z.object({ line1: z.string().trim().min(3).max(200), line2: z.string().max(200).optional(), postal_code: z.string().regex(/^\d{4}-\d{3}$/), city: z.string().trim().min(2).max(100), region: z.string().trim().max(100).optional(), country: z.literal('PT').default('PT') }).strict().optional() }).strict();
const Input = z.object({ attempt: z.string().uuid(), visit: z.string().uuid().optional(), tracking: trackingInput.optional(), quantity: z.number().int().min(1).max(100).default(1), method: z.enum(['mbway','multibanco']), customer: Buyer }).strict();
async function get(id: string) {
  if (!/^pt_[a-f0-9-]{36}$/.test(id)) throw new ApiError(404, 'not_found', 'Pedido não encontrado.');
  const order = await db().prepare('SELECT * FROM pt_orders WHERE id=?').bind(id).first<any>();
  if (!order) throw new ApiError(404, 'not_found', 'Pedido não encontrado.');
  return order;
}
export async function ptStatus(id: string) {
  await rateLimit('pt:status:'+hash(id),60);
  let o = await get(id);
  if(o.method==='mbway' && o.provider_id && o.status==='pending' && !o.fallback_at && now()-o.created_at>=60000) {
    const claim=await db().prepare('UPDATE pt_orders SET fallback_at=? WHERE id=? AND fallback_at=0').bind(now(),id).run();
    if(claim.meta.changes) try {
      await rateLimit('broski:global',100);
      const p=await broskiRequest('/orders/'+encodeURIComponent(o.provider_id),(await config()).token);
      await applyOrder(o,p,false);
      o=await get(id);
    } catch { /* One bounded reconciliation only; payment confirmation remains webhook-only. */ }
  }
  const voucher = o.voucher ? JSON.parse(o.voucher) : undefined;
  const expired = voucher && Date.parse(voucher.expires_at) <= now() && !['paid','refunded'].includes(o.status);
  const snapshot = await db().prepare('SELECT snapshot FROM product_orders WHERE id=?').bind(id).first<any>();
  const saved = snapshot ? JSON.parse(snapshot.snapshot) : null;
  return { id: o.id, status: expired ? 'expired' : o.status, method: o.method, amount: o.amount, currency: 'EUR', created_at: o.created_at, multibanco: expired ? undefined : voucher, redirect_url: o.status==='paid' ? saved?.upsell_url || null : null };
}
export async function ptCreate(request: Request, productId: string) {
  assertOrigin(request, env.APP_ORIGIN || '');
  if (env.PUBLIC_API_ENABLED !== 'true') throw new ApiError(503, 'payments_disabled', 'Os pagamentos ainda não estão disponíveis.');
  const c = await config();
  if (!c.token || !c.secret) throw new ApiError(503, 'not_configured', 'Configure a Broski e o webhook.');
  const input = Input.parse(await readJson(request));
  const id = 'pt_' + input.attempt;
  await rateLimit('pt:create:' + (request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'), 15);
  const fingerprint = hash(JSON.stringify({ productId, ...input }));
  let o = await db().prepare('SELECT * FROM pt_orders WHERE id=?').bind(id).first<any>();
  if (o && o.request_hash !== fingerprint) throw new ApiError(409, 'attempt_changed', 'Os dados desta tentativa mudaram. Inicie uma nova tentativa.');
  if (!o) {
    const p = await findProduct(productId);
    if (p.product_type !== 'digital' && !input.customer.address) throw new ApiError(422, 'address_required', 'Preencha a morada de entrega.');
    const amount = p.amount * input.quantity + (p.product_type === 'digital' ? 0 : p.shipping);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > (input.method === 'mbway' ? 500000 : 100000000) || (input.method === 'mbway' && amount < 50)) throw new ApiError(422, 'invalid_amount', 'O valor não é suportado pelo método selecionado.');
    const phone = input.method === 'mbway' ? normalizePtPhone(input.customer.phone || '') : undefined;
    const payload = { amount, method: input.method, ...(phone ? { phone } : {}), external_reference: id, description: p.name.slice(0,140), checkout_url: `${env.APP_ORIGIN}/comprar/${p.id}`, product_type: p.product_type || 'physical', customer: { ...input.customer, ...(phone ? { phone } : {}) } };
    const snapshot={name:p.name,product_type:p.product_type,amount:p.amount,quantity:input.quantity,shipping:p.product_type==='digital'?0:p.shipping,delivery_days:p.delivery_days,upsell_url:p.upsell_url || null};
    await db().batch([
      db().prepare('INSERT OR IGNORE INTO pt_orders(id,product_id,request_hash,payload,amount,method,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,p.id,fingerprint,seal(JSON.stringify(payload),crypt()),amount,input.method,now(),now()),
      db().prepare('INSERT OR IGNORE INTO product_orders(id,product_id,request_hash,snapshot,buyer,created_at) VALUES(?,?,?,?,?,?)').bind(id,p.id,fingerprint,JSON.stringify(snapshot),seal(JSON.stringify(input.customer),crypt()),now()),
    ]);
    o = await get(id);
    if (o.request_hash !== fingerprint) throw new ApiError(409, 'attempt_changed', 'Tentativa já utilizada.');
  }
  if (input.tracking) {
    try { await rememberOrderTracking(request,id,productId,input.tracking,{email:input.customer.email,phone:input.customer.phone||''},input.quantity,true); }
    catch { console.error('TikTok attribution unavailable; payment preserved'); }
  }
  if (o.provider_id) return ptStatus(id);
  if(input.visit) await linkCheckoutVisit(productId,input.visit,id);
  if (o.retry_at > now()) throw new BroskiError(429, 'retry_later', o.last_error || 'Aguarde antes de tentar novamente.', Math.ceil((o.retry_at-now())/1000));
  const lock = await db().prepare('UPDATE pt_orders SET lease_until=? WHERE id=? AND lease_until<? AND provider_id IS NULL').bind(now()+30000,id,now()).run();
  if (!lock.meta.changes) return ptStatus(id);
  try {
    await rateLimit('broski:global', 100);
    const data = await broskiRequest('/orders',c.token,JSON.parse(unseal(o.payload,crypt())),id);
    await applyOrder(o, data, false);
  } catch (e) {
    const error = e as BroskiError;
    // Keep the exact encrypted payload and idempotency key after uncertain outcomes.
    const delay = error.retryAfter || (error.status === 429 ? Math.min(300,5 * 2 ** Math.min(o.retry_count || 0,6)) : error.status >= 500 ? 5 : 0);
    await db().prepare('UPDATE pt_orders SET lease_until=0,retry_at=?,last_error=?,retry_count=retry_count+1 WHERE id=?').bind(now()+delay*1000,error.message,id).run();
    throw e;
  }
  return ptStatus(id);
}
async function applyOrder(o: any, value: unknown, webhook: boolean, eventId?: string) {
  const p = BroskiOrder.parse(value);
  if (p.amount !== o.amount || p.method !== o.method || p.external_reference !== o.id || (o.provider_id && o.provider_id !== p.id)) throw new ApiError(409,'provider_mismatch','O pagamento não corresponde ao pedido.');
  if (p.multibanco && p.multibanco.amount !== o.amount) throw new ApiError(409,'voucher_mismatch','Valor da referência inválido.');
  if (!p.livemode) throw new ApiError(422,'test_order','Pagamento de teste não pode confirmar uma venda.');
  const status = webhook ? p.status : (p.status === 'paid' || p.status === 'refunded' ? 'pending' : p.status);
  const timestamp = now();
  const writes = [db().prepare(`UPDATE pt_orders SET provider_id=?,status=CASE WHEN status='refunded' THEN status WHEN status='paid' AND ?<>'refunded' THEN status WHEN status IN ('failed','expired') AND ? NOT IN ('paid','refunded') THEN status ELSE ? END,voucher=COALESCE(?,voucher),refunded=MAX(refunded,?),updated_at=?,lease_until=0 WHERE id=?`).bind(p.id,status,status,status,p.multibanco ? JSON.stringify(p.multibanco):null,p.amount_refunded || 0,timestamp,o.id)];
  if (eventId) writes.push(db().prepare('INSERT OR IGNORE INTO pt_events(id,order_id,received_at) VALUES(?,?,?)').bind(eventId,o.id,timestamp));
  const payload = JSON.parse(unseal(o.payload,crypt()));
  // Keep the original dashboard and sales history backed by the same transaction model.
  writes.push(db().prepare(`INSERT OR IGNORE INTO transactions(id,key_id,idempotency_key,request_hash,provider_id,gateway,external_reference,amount,fee,net,status,checkout_hash,checkout_token,description,customer,created_at,updated_at,lease_until) VALUES(?,?,?,?,?,'broski',?,?,0,0,'PENDING',?,?,?,?,?,?,0)`).bind(o.id,'product:'+o.product_id,o.id,o.request_hash,p.id,o.id,o.amount,hash(o.id),seal(o.id,crypt()),payload.description,seal(JSON.stringify(payload.customer),crypt()),o.created_at,timestamp));
  writes.push(db().prepare(`UPDATE transactions SET status=(SELECT CASE status WHEN 'awaiting_payment' THEN 'PENDING' ELSE upper(status) END FROM pt_orders WHERE id=?),paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END,updated_at=? WHERE id=?`).bind(o.id,status,timestamp,timestamp,o.id));
  // Commit notifications with the payment, once per order/status, not per webhook.
  writes.push(db().prepare(`INSERT OR IGNORE INTO push_events(id,transaction_id,event,created_at,external_source,external_amount,external_currency,external_method)
    SELECT 'pt:'||lower(t.status)||':'||t.id,t.id,t.status,CASE WHEN t.status='PAID' THEN t.paid_at ELSE t.created_at END,'broski',t.amount,'EUR',?
    FROM transactions t JOIN settings s ON s.id='push_started_at'
    WHERE t.id=? AND t.status IN ('PENDING','PAID') AND
    CASE WHEN t.status='PAID' THEN t.paid_at ELSE t.created_at END>=CAST(s.value AS INTEGER)`).bind(o.method,o.id));
  await db().batch(writes);
  try { await safeTrackTransaction(await db().prepare('SELECT * FROM transactions WHERE id=?').bind(o.id).first()); }
  catch { console.error('TikTok reconciliation deferred; payment preserved'); }
}
export async function ptWebhook(request: Request) {
  const { readBody } = await import('./security');
  const raw = await readBody(request), c = await config();
  if (!verify(raw,request.headers.get('Broski-Signature'),c.secret)) throw new ApiError(401,'invalid_signature','Assinatura inválida.');
  const event = z.object({ id:z.string().min(1).max(200), type:z.string(), data:z.unknown().optional() }).parse(JSON.parse(raw));
  if (!['order.paid','order.failed','order.expired','order.refunded'].includes(event.type)) return;
  if (await db().prepare('SELECT id FROM pt_events WHERE id=?').bind(event.id).first()) return;
  const order = BroskiOrder.parse((event.data as any)?.object);
  if (event.type !== 'order.'+order.status) throw new ApiError(422,'event_mismatch','Evento inconsistente.');
  const o = await db().prepare('SELECT * FROM pt_orders WHERE id=?').bind(order.external_reference).first<any>();
  if (!o) return; // This Broski account may also serve other applications.
  await applyOrder(o,order,true,event.id);
}
export async function ptRefund(request: Request, id: string, actor: string) {
  const data = z.object({ amount:z.number().int().positive().optional(),reason:z.string().max(500).optional() }).strict().parse(await readJson(request));
  const key = request.headers.get('Idempotency-Key') || '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new ApiError(422,'invalid_key','Indique uma chave de idempotência válida.');
  const o = await get(id), fingerprint=hash(JSON.stringify({id,...data}));
  const existing=await db().prepare('SELECT * FROM pt_refunds WHERE id=?').bind(key).first<any>();
  if(existing && existing.request_hash!==fingerprint) throw new ApiError(409,'idempotency_key_reused','Chave já utilizada.');
  if(existing?.response) return JSON.parse(existing.response);
  if(!o.provider_id || o.status!=='paid') throw new ApiError(409,'order_not_paid','Pedido não pago.');
  await db().prepare('INSERT OR IGNORE INTO pt_refunds(id,order_id,request_hash,payload) VALUES(?,?,?,?)').bind(key,id,fingerprint,JSON.stringify(data)).run();
  const reserved=await db().prepare('SELECT request_hash FROM pt_refunds WHERE id=?').bind(key).first<any>();
  if(reserved.request_hash!==fingerprint) throw new ApiError(409,'idempotency_key_reused','Chave já utilizada.');
  await rateLimit('broski:global',100);
  const result=await broskiRequest(`/orders/${encodeURIComponent(o.provider_id)}/refunds`,(await config()).token,data,key);
  await db().batch([
    db().prepare('UPDATE pt_refunds SET response=? WHERE id=?').bind(JSON.stringify(result),key),
    db().prepare("UPDATE pt_orders SET refunded=MAX(refunded,COALESCE((SELECT SUM(json_extract(response,'$.amount')) FROM pt_refunds WHERE order_id=? AND json_extract(response,'$.status')='succeeded'),0)) WHERE id=?").bind(id,id),
  ]);
  await audit(actor,'broski.refund',id);
  return result;
}
export async function ptProviderOrders(params: URLSearchParams) {
  const query=z.object({status:z.enum(['pending','awaiting_payment','paid','failed','expired','refunded']).optional(),method:z.enum(['mbway','multibanco']).optional(),starting_after:z.string().regex(/^ord_[A-Za-z0-9_-]+$/).optional()}).strict().parse(Object.fromEntries(params));
  await rateLimit('broski:global',100);
  return broskiRequest('/orders?'+new URLSearchParams(query as Record<string,string>),(await config()).token);
}
export async function ptProviderOrder(id: string) {
  if(!/^ord_[A-Za-z0-9_-]+$/.test(id))throw new ApiError(422,'invalid_id','Pedido inválido.');
  await rateLimit('broski:global',100);
  return broskiRequest('/orders/'+id,(await config()).token);
}
export async function sendVoucherEmails() {
  if(!env.RESEND_API_KEY || !env.MAIL_FROM) return;
  const rows=await db().prepare("SELECT * FROM pt_orders WHERE method='multibanco' AND voucher IS NOT NULL AND email_sent=0 AND status='awaiting_payment' LIMIT 10").all<any>();
  for(const o of rows.results) {
    const v=JSON.parse(o.voucher); if(Date.parse(v.expires_at)<=now()) continue;
    const payload=JSON.parse(unseal(o.payload,crypt()));
    const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'voucher-'+o.id},body:JSON.stringify({from:env.MAIL_FROM,to:[payload.customer.email],subject:'Dados para pagamento Multibanco',text:`Guarde estes dados para pagar a sua encomenda.\nEntidade: ${v.entity}\nReferência: ${v.reference}\nValor: ${(v.amount/100).toFixed(2)} EUR\nValidade: ${v.expires_at}\nA encomenda só será confirmada após o pagamento.`})});
    if(response.ok) await db().prepare('UPDATE pt_orders SET email_sent=1 WHERE id=?').bind(o.id).run();
  }
}
