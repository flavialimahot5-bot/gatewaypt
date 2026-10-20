import { isIP } from "node:net";
import { z } from "zod";
import { audit, db, env, now, setting, putSetting } from "./core";
import { ApiError, hash, seal, unseal } from "./security";

const endpoint = "https://api.utmify.com.br/api-credentials/orders";
const crypt = () => env.APP_ENCRYPTION_KEY || "";
export const utmFields = ["src", "sck", "utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"] as const;
export const utmInput = z.object(Object.fromEntries(utmFields.map(k => [k, z.string().max(500).nullable().optional()]))).strict();
// The supplied API specification does not list MB WAY. Never silently report it as Pix.
const methods = z.enum(["mbway", "pix", "credit_card", "paypal", "boleto", "free_price"]);
type Configuration = { token: string; enabled: boolean; since: number; method: z.infer<typeof methods>; validated?: string };
async function config(): Promise<Configuration | null> {
  const value = await setting("utmify_config");
  return value ? JSON.parse(unseal(value, crypt())) : null;
}
export async function utmifyOverview() {
  const c = await config();
  const jobs = await db().prepare(`SELECT order_id,sent_status,attempts,last_error,delivered_at,created_at
    FROM utmify_orders ORDER BY created_at DESC LIMIT 20`).all();
  return { configured: !!c?.token, enabled: !!c?.enabled, method: c?.method || "mbway",
    validated: !!c && c.validated === hash(c.token+":"+c.method), jobs: jobs.results };
}
export async function saveUtmify(input: unknown, actor: string) {
  const body = z.object({token:z.string().trim().min(16).max(4000).optional(), enabled:z.boolean(), method:methods}).strict().parse(input);
  const old = await config();
  const token = body.token || old?.token;
  if (!token) throw new ApiError(422,"utmify_token_required","Informe o token da UTMify.");
  const validated = old?.validated === hash(token+":"+body.method) ? old.validated : undefined;
  if (body.enabled && !validated) throw new ApiError(422,"utmify_test_required","Salve o token com a integração pausada e clique em Validar conexão antes de ativar.");
  await putSetting("utmify_config",seal(JSON.stringify({token,enabled:body.enabled,method:body.method,validated,
    since: old?.token === token && (!body.enabled || old.enabled) ? old.since : now()}),crypt()));
  await audit(actor,"utmify.configured","utmify");
  return utmifyOverview();
}
const utc = (value:number) => new Date(value).toISOString().slice(0,19).replace("T"," ");
export function utmifyState(status:string) {
  return ({pending:"waiting_payment",awaiting_payment:"waiting_payment",paid:"paid",failed:"refused",expired:"refused",refunded:"refunded"} as Record<string,string>)[status];
}
export async function rememberUtmifyOrder(request:Request, order:{id:string;method:string;created_at:number}, tracking?:unknown) {
  const c = await config();
  if (!c?.enabled || order.method !== "mbway" || order.created_at<c.since) return;
  const params = utmInput.parse(tracking || {});
  const candidate = env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() : undefined;
  const ip = candidate && isIP(candidate) ? candidate : undefined;
  await db().prepare(`INSERT OR IGNORE INTO utmify_orders(order_id,connection_id,attribution,payment_method,created_at)
    VALUES (?,?,?,?,?)`).bind(order.id,hash(c.token),seal(JSON.stringify({params,ip}),crypt()),c.method,now()).run();
}
export function utmifyPayload(row:any) {
  const buyer = JSON.parse(unseal(row.buyer,crypt()));
  const snapshot = JSON.parse(row.snapshot);
  const attribution = JSON.parse(unseal(row.attribution,crypt()));
  const quantity = snapshot.quantity || 1;
  if (snapshot.amount * quantity + snapshot.shipping !== row.amount) throw new Error("amount_mismatch");
  let phone = (buyer.phone || "").replace(/\D/g,"");
  if (phone.startsWith("00351")) phone=phone.slice(2);
  if (/^9\d{8}$/.test(phone)) phone="351"+phone;
  return {
    orderId:row.order_id, platform:"GotiPayPortugal", paymentMethod:row.payment_method,
    status:utmifyState(row.status), createdAt:utc(row.order_created_at),
    approvedDate:row.paid_at ? utc(row.paid_at) : null,
    refundedAt:row.status === "refunded" ? utc(row.refunded_at || row.updated_at) : null,
    customer:{name:buyer.name,email:buyer.email,phone:phone || null,document:null,country:"PT",...(attribution.ip?{ip:attribution.ip}:{})},
    products:[{id:row.product_id,name:snapshot.name,planId:null,planName:null,quantity,priceInCents:snapshot.amount}],
    trackingParameters:Object.fromEntries(utmFields.map(k=>[k,attribution.params[k] || null])),
    // Broski does not return fees in this integration; report gross as allowed by the API documentation.
    commission:{totalPriceInCents:row.amount,gatewayFeeInCents:0,userCommissionInCents:row.amount,currency:"EUR"},
    isTest:false,
  };
}
async function send(token:string,payload:unknown):Promise<string|null> {
  try {
    const response=await fetch(endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
      headers:{"Content-Type":"application/json","x-api-token":token},body:JSON.stringify(payload)});
    const text=await response.text();
    let result:any;
    try { result=text ? JSON.parse(text) : null; } catch { return "invalid_response"; }
    // Restrict diagnostics to known fields; never expose response bodies containing customers or tokens.
    if (!response.ok || result?.error || result?.success === false) {
      const serialized=JSON.stringify(result || {});
      if (serialized.includes("paymentMethod")) return "payment_method_rejected";
      if (response.status===401 || response.status===403 || serialized.includes("API_CREDENTIAL_NOT_FOUND")) return "token_rejected";
      return "http_"+response.status;
    }
    return null;
  } catch { return "network"; }
}
export async function testUtmify(actor:string) {
  const c=await config();
  if (!c) throw new ApiError(422,"utmify_token_required","Salve o token primeiro.");
  const error=await send(c.token,{orderId:"test_"+hash(String(now())).slice(0,24),platform:"GotiPayPortugal",paymentMethod:c.method,
    status:"waiting_payment",createdAt:utc(now()),approvedDate:null,refundedAt:null,
    customer:{name:"Teste de integração",email:"integracao@example.com",phone:null,document:null,country:"PT"},
    products:[{id:"test",name:"Validação sem venda",planId:null,planName:null,quantity:1,priceInCents:100}],
    trackingParameters:Object.fromEntries(utmFields.map(k=>[k,null])),
    commission:{totalPriceInCents:100,gatewayFeeInCents:0,userCommissionInCents:100,currency:"EUR"},isTest:true});
  if (error) throw new ApiError(422,"utmify_validation_failed",error==="payment_method_rejected"
    ? "A UTMify recusou o método MB WAY/método selecionado. Confirme com o suporte qual classificação utilizar."
    : error==="token_rejected" ? "A UTMify recusou o token. Confira a credencial de API." : "A validação da UTMify falhou ("+error+").");
  // Do not overwrite a token changed while the validation was in flight.
  const current=await config();
  if (!current || current.token!==c.token || current.method!==c.method) throw new ApiError(409,"config_changed","A configuração mudou. Repita a validação.");
  await putSetting("utmify_config",seal(JSON.stringify({...current,validated:hash(c.token+":"+c.method)}),crypt()));
  await audit(actor,"utmify.validated","utmify");
  return utmifyOverview();
}
const rowQuery=`SELECT j.*,o.status,o.product_id,o.amount,o.created_at AS order_created_at,o.updated_at,
  p.buyer,p.snapshot,t.paid_at FROM utmify_orders j JOIN pt_orders o ON o.id=j.order_id
  JOIN product_orders p ON p.id=o.id LEFT JOIN transactions t ON t.id=o.id`;
export async function dispatchUtmify() {
  const c=await config();
  if (!c?.enabled || c.validated!==hash(c.token+":"+c.method)) return {sent:0};
  const rows=await db().prepare(`${rowQuery} WHERE j.connection_id=? AND o.provider_id IS NOT NULL
    AND o.status IN ('pending','awaiting_payment','paid','failed','expired','refunded')
    AND COALESCE(j.sent_status,'')<>CASE o.status WHEN 'pending' THEN 'waiting_payment' WHEN 'awaiting_payment' THEN 'waiting_payment'
      WHEN 'failed' THEN 'refused' WHEN 'expired' THEN 'refused' ELSE o.status END
    AND (j.next_at<=? OR COALESCE(j.attempts_status,'')<>CASE o.status WHEN 'pending' THEN 'waiting_payment' WHEN 'awaiting_payment' THEN 'waiting_payment'
      WHEN 'failed' THEN 'refused' WHEN 'expired' THEN 'refused' ELSE o.status END)
    AND (j.attempts<12 OR COALESCE(j.attempts_status,'')<>CASE o.status WHEN 'pending' THEN 'waiting_payment' WHEN 'awaiting_payment' THEN 'waiting_payment'
      WHEN 'failed' THEN 'refused' WHEN 'expired' THEN 'refused' ELSE o.status END)
    AND j.lease_until<? ORDER BY j.checked_at LIMIT 3`).bind(hash(c.token),now(),now()).all<any>();
  let sent=0;
  for (const candidate of rows.results) {
    const lease=now()+60000;
    const claim=await db().prepare("UPDATE utmify_orders SET lease_until=?,checked_at=? WHERE order_id=? AND lease_until<? RETURNING order_id")
      .bind(lease,now(),candidate.order_id,now()).first();
    if (!claim) continue;
    const row=await db().prepare(rowQuery+" WHERE j.order_id=?").bind(candidate.order_id).first<any>();
    const state=utmifyState(row.status);
    const attempts=row.attempts_status===state?row.attempts:0;
    const finish=(error:string|null,delivered=false)=>db().prepare(`UPDATE utmify_orders SET lease_until=0,last_error=?,attempts_status=?,attempts=?,
      next_at=?,sent_status=CASE WHEN ? THEN ? ELSE sent_status END,delivered_at=CASE WHEN ? THEN ? ELSE delivered_at END
      WHERE order_id=? AND lease_until=?`).bind(error,state,attempts+1,delivered?0:now()+Math.min(3600000,30000*2**Math.min(attempts,7)),delivered?1:0,state,delivered?1:0,now(),row.order_id,lease).run();
    if (row.sent_status===state) { await finish(null,true);continue; }
    if (now()-row.order_created_at>(state==="refunded"?45:7)*86400000) { await finish("outside_api_window");continue; }
    if (attempts>=12) { await finish("attempts_exhausted");continue; }
    const current=await config();
    if (!current?.enabled || hash(current.token)!==row.connection_id) { await finish("configuration_changed");continue; }
    let payload;
    try { payload=utmifyPayload(row); } catch { await finish("invalid_order_data");continue; }
    if (state==="refunded" && !row.refunded_at) await db().prepare("UPDATE utmify_orders SET refunded_at=? WHERE order_id=?").bind(row.updated_at,row.order_id).run();
    const error=await send(c.token,payload);
    await finish(error,!error);
    if (!error) sent++;
  }
  return {sent};
}
export async function utmifyBackground() {
  try { await dispatchUtmify(); } catch { console.error("UTMify unavailable; payments preserved"); }
}
