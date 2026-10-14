import { z } from "zod";
import { db, env, now, rateLimit } from "./core";
import { ApiError, assertOrigin, hash, readJson } from "./security";

export async function checkoutPresence(request: Request) {
  assertOrigin(request, env.APP_ORIGIN || "");
  const input = z.object({ product_id: z.string().max(100), visit: z.string().uuid(), stage: z.number().int().min(0).max(3) }).strict().parse(await readJson(request, 1000));
  await rateLimit("presence-global", 3000);
  const id = hash(input.product_id + ":" + input.visit);
  await rateLimit("presence:" + id, 12);
  const product = await db().prepare("SELECT id FROM products WHERE id=? AND active=1").bind(input.product_id).first();
  if (!product) throw new ApiError(404, "not_found", "Produto indisponível.");
  const time = now();
  await db().prepare(`INSERT INTO checkout_sessions(id,product_id,stage,created_at,last_seen) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET stage=MAX(checkout_sessions.stage,excluded.stage),last_seen=MAX(checkout_sessions.last_seen,excluded.last_seen)`)
    .bind(id, input.product_id, input.stage, time, time).run();
}

// Called only after a valid order is persisted. Browsers cannot assert Pix or PAID.
export async function linkCheckoutVisit(product: string, visit: string, order: string) {
  const time = now();
  await db().prepare(`INSERT INTO checkout_sessions(id,product_id,stage,created_at,last_seen,order_id) VALUES (?,?,3,?,?,?)
    ON CONFLICT(id) DO UPDATE SET stage=3,order_id=COALESCE(checkout_sessions.order_id,excluded.order_id),last_seen=MAX(checkout_sessions.last_seen,excluded.last_seen)`)
    .bind(hash(product + ":" + visit), product, time, time, order).run();
}

function midnight(day: string) {
 const noon=new Date(day+'T12:00:00Z');
 const offset=new Intl.DateTimeFormat('en',{timeZone:'Europe/Lisbon',timeZoneName:'shortOffset'}).formatToParts(noon).find(p=>p.type==='timeZoneName')?.value==='GMT+1'?3600000:0;
 return Date.parse(day+'T00:00:00Z')-offset;
}
export function analyticsRange(params:URLSearchParams,time=now()) {
 const today=new Date(time).toLocaleDateString('en-CA',{timeZone:'Europe/Lisbon'}),period=params.get('period')||'today';
 const shift=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 let first=today,last=shift(today,1);
 if(period==='yesterday'){first=shift(today,-1);last=today;}
 else if(period==='week')first=shift(today,-6);
 else if(period==='month')first=today.slice(0,8)+'01';
 else if(period==='year')first=today.slice(0,4)+'-01-01';
 else if(period==='custom'){first=params.get('date')||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(first)||!Number.isFinite(Date.parse(first))||new Date(first).toISOString().slice(0,10)!==first)throw new ApiError(422,'invalid_date','Data inválida.');last=shift(first,1);}
 else if(period!=='today')throw new ApiError(422,'invalid_period','Período inválido.');
 return {start:midnight(first),end:midnight(last)};
}

const sessionJoin = `FROM checkout_sessions s LEFT JOIN products p ON p.id=s.product_id
  LEFT JOIN transactions t ON t.idempotency_key=s.order_id AND t.key_id='product:'||s.product_id`;
// Final financial states come exclusively from the validated provider integration.
const generated = "t.provider_id IS NOT NULL";
const paid = "t.status='PAID' AND t.paid_at IS NOT NULL";
export async function analyticsOverview(params: URLSearchParams) {
  const { start, end } = analyticsRange(params), time = now();
  const [sales, received, funnel, live, visitors, recent] = await Promise.all([
    db().prepare(`SELECT COUNT(*) orders,COALESCE(SUM(amount),0) total,
      COALESCE(SUM(CASE WHEN provider_id IS NOT NULL THEN 1 ELSE 0 END),0) generated,
      COALESCE(SUM(CASE WHEN provider_id IS NOT NULL AND status='PAID' THEN 1 ELSE 0 END),0) converted,
      COALESCE(SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END),0) pending
      FROM transactions WHERE created_at>=? AND created_at<?`).bind(start,end).first(),
    db().prepare(`SELECT COUNT(*) count,COALESCE(SUM(amount),0) amount,COALESCE(SUM(fee),0) fees,COALESCE(SUM(CASE WHEN gateway='plowf' THEN 1 ELSE 0 END),0) estimated_net,COALESCE(SUM(CASE WHEN fee IS NULL OR gateway='broski' THEN 1 ELSE 0 END),0) missing_fees
      FROM transactions WHERE status='PAID' AND paid_at>=? AND paid_at<?`).bind(start,end).first(),
    db().prepare(`SELECT COUNT(*) arrivals,COALESCE(SUM(s.stage>=1),0) filling,COALESCE(SUM(s.stage>=2 AND COALESCE(p.product_type,'physical')='physical'),0) shipping,
      COALESCE(SUM(s.stage>=3),0) payment,COALESCE(SUM(CASE WHEN ${generated} THEN 1 ELSE 0 END),0) pix,
      COALESCE(SUM(CASE WHEN ${paid} THEN 1 ELSE 0 END),0) paid,
      COALESCE(SUM(CASE WHEN s.last_seen<? AND s.order_id IS NULL THEN 1 ELSE 0 END),0) abandoned
      ${sessionJoin} WHERE s.created_at>=? AND s.created_at<?`).bind(time-600000,start,end).first(),
    db().prepare(`SELECT CASE WHEN ${paid} THEN 5 WHEN ${generated} THEN 4 ELSE s.stage END stage,COUNT(*) count
      ${sessionJoin} WHERE s.last_seen>=? GROUP BY 1`).bind(time-90000).all(),
    db().prepare(`SELECT s.id,p.name product,s.last_seen,t.status,CASE WHEN ${paid} THEN 5 WHEN ${generated} THEN 4 ELSE s.stage END stage
      ${sessionJoin} WHERE s.last_seen>=? ORDER BY s.last_seen DESC LIMIT 30`).bind(time-600000).all(),
    db().prepare(`SELECT id,description,amount,status,created_at,paid_at FROM transactions WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 8`).bind(start,end).all(),
  ]);
  return { sales, received, funnel, live: live.results, visitors: visitors.results, recent: recent.results, updated_at: time, start, end };
}
