import { z } from 'zod';
import catalog from './store-catalog.json';
import { db, env, now } from './core';
import { ApiError, hash, randomToken, seal, unseal, verify } from './security';
import { createCharge, refreshCheckout, serialize, ChargeInput } from './payments';
import { validCpf, normalizeBrazilPhone } from '../buyer-fields';

const text=z.string().trim().min(1).max(180);
const Input=z.object({
 attempt:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
 items:z.array(z.object({id:z.number().int(),qty:z.number().int().min(1).max(99),variant:z.string().max(300).default('')}).strict()).min(1).max(50),
 customer:z.object({name:z.string().trim().min(3).max(120),email:z.string().email().max(254),cpf:z.string().regex(/^\d{11}$/).refine(validCpf),phone:z.string().max(30).transform(normalizeBrazilPhone).refine(s=>/^\d{10,11}$/.test(s))}).strict(),
 address:z.object({cep:z.string().regex(/^\d{8}$/),street:text,number:text,neighborhood:text,city:text,state:z.string().regex(/^[A-Z]{2}$/),complement:z.string().max(180).default('')}).strict(),
 utm:ChargeInput.shape.utm,
 shipping:z.literal('free').default('free'),coupon:z.literal('').default(''),
}).strict();
export function storeAccess(keyId:string,session:string){
 if(env.STORE_ORDERS_ENABLED!=='true'||keyId!==env.STORE_API_KEY_ID)throw new ApiError(403,'store_disabled','Integração da loja não habilitada.');
 if(!/^[a-f0-9]{64}$/.test(session))throw new ApiError(401,'session_required','Sessão inválida.');
}
export function priceStoreOrder(input:unknown){
 const data=Input.parse(input);
 const seen=new Set<string>();
 const items=data.items.map(i=>{
  const p=catalog.find(p=>p.id===i.id);
  if(!p?.enabled)throw new ApiError(422,'product_unavailable','Produto indisponível para pagamento.');
  const variant=i.variant||'Padrão único';
  const variants=p.variants as unknown as Record<string,number>;
  if(!Object.hasOwn(variants,variant))throw new ApiError(422,'invalid_variant','Selecione uma variação válida.');
  const identity=i.id+':'+variant;
  if(seen.has(identity))throw new ApiError(422,'duplicate_item','Agrupe as quantidades do mesmo item.');
  seen.add(identity);
  return {id:i.id,name:p.name,variant,qty:i.qty,unit_cents:variants[variant]};
 }).sort((a,b)=>a.id-b.id||a.variant.localeCompare(b.variant));
 const amount=items.reduce((s,i)=>s+i.unit_cents*i.qty,0);
 if(!Number.isSafeInteger(amount)||amount<500||amount>100000000)throw new ApiError(422,'invalid_amount','Valor fora dos limites.');
 return {data,items,amount};
}
function decode(value:string){return JSON.parse(unseal(value,env.APP_ENCRYPTION_KEY||''));}
async function transaction(order:any){
 return db().prepare('SELECT * FROM transactions WHERE key_id=? AND idempotency_key=? AND external_reference=? AND amount=?').bind(order.key_id,'store:'+order.id,order.id,order.amount).first<any>();
}
export async function settleStoreOrder(order:any){
 // A durable unique ledger is the stock/fulfillment/notification handoff. No fake stock quantities.
 const statements=[db().prepare(`UPDATE store_orders SET transaction_id=(SELECT id FROM transactions WHERE key_id=store_orders.key_id AND idempotency_key='store:'||store_orders.id),paid_at=COALESCE(paid_at,?) WHERE id=? AND EXISTS(SELECT 1 FROM transactions t WHERE t.key_id=store_orders.key_id AND t.idempotency_key='store:'||store_orders.id AND t.external_reference=store_orders.id AND t.amount=store_orders.amount AND t.status='PAID')`).bind(now(),order.id)];
 for(const kind of ['stock','fulfillment','notification'])statements.push(db().prepare(`INSERT OR IGNORE INTO store_effects(order_id,kind,created_at) SELECT id,?,? FROM store_orders WHERE id=? AND paid_at IS NOT NULL`).bind(kind,now(),order.id));
 statements.push(db().prepare(`INSERT OR IGNORE INTO store_effects(order_id,kind,state,result,created_at) SELECT id,'trackerorder',CASE WHEN ?=1 AND (SELECT value FROM settings WHERE id='trackerorder_connection') IS NOT NULL THEN 'PENDING' ELSE 'DISABLED' END,(SELECT value FROM settings WHERE id='trackerorder_connection'),? FROM store_orders WHERE id=? AND paid_at IS NOT NULL`).bind(env.STORE_TRACKERORDER_ENABLED==='true'?1:0,now(),order.id));
 await db().batch(statements);
}
async function present(order:any,refresh=true){
 let tx=await transaction(order);
 if(tx&&refresh)tx=await refreshCheckout(tx);
 if(tx){await db().prepare('UPDATE store_orders SET transaction_id=? WHERE id=? AND (transaction_id IS NULL OR transaction_id=?)').bind(tx.id,order.id,tx.id).run();await settleStoreOrder(order);}
 const snapshot=JSON.parse(order.snapshot);
 return {order_id:order.id,amount_cents:order.amount,items:snapshot.items,shipping_cents:0,discount_cents:0,
  transaction:tx?serialize(tx):null,status:tx?.status||'CREATING',pix:tx?serialize(tx).pix:{copy_paste:null,expires_at:null}};
}
export async function createStoreOrder(keyId:string,session:string,input:unknown){
 storeAccess(keyId,session);
 const parsed=Input.parse(input);
 const fingerprint=hash(JSON.stringify(parsed));
 const prior=await db().prepare('SELECT * FROM store_orders WHERE key_id=? AND session_hash=? AND attempt=?').bind(keyId,session,parsed.attempt).first<any>();
 if(prior){
  if(prior.request_hash!==fingerprint)throw new ApiError(409,'attempt_conflict','A tentativa já possui outro pedido.');
  const tx=await transaction(prior);
  if(!tx||(!tx.provider_id&&tx.status==='CREATING')){try{await createCharge(keyId,decode(prior.charge_body),'store:'+prior.id);}catch(e){if(!await transaction(prior))throw e;}}
  return present(prior,false);
 }
 const {data,items,amount}=priceStoreOrder(parsed);
 const id=randomToken('ord_');
 const charge={amount_cents:amount,description:'Pedido Brinox Store',external_reference:id,customer:data.customer,expires_in:3600,...(data.utm?{utm:data.utm}:{})};
 await db().prepare('INSERT OR IGNORE INTO store_orders(id,key_id,session_hash,attempt,request_hash,snapshot,buyer,charge_body,amount,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,keyId,session,data.attempt,fingerprint,JSON.stringify({items,shipping_cents:0,discount_cents:0}),seal(JSON.stringify({customer:data.customer,address:data.address,utm:data.utm}),env.APP_ENCRYPTION_KEY||''),seal(JSON.stringify(charge),env.APP_ENCRYPTION_KEY||''),amount,now()).run();
 const order=await db().prepare('SELECT * FROM store_orders WHERE key_id=? AND session_hash=? AND attempt=?').bind(keyId,session,data.attempt).first<any>();
 if(!order||order.request_hash!==fingerprint)throw new ApiError(409,'attempt_conflict','A tentativa já possui outro pedido.');
 // Persisted exact body survives crashes, connection errors and later catalog changes.
 const existing=await transaction(order);
 if(!existing||(!existing.provider_id&&existing.status==='CREATING')){
  try{await createCharge(keyId,decode(order.charge_body),'store:'+order.id);}
  catch(error){if(!await transaction(order))throw error;}
 }
 return present(order,false);
}
export async function getStoreOrder(keyId:string,session:string,id:string){
 storeAccess(keyId,session);
 const order=await db().prepare('SELECT * FROM store_orders WHERE id=? AND key_id=? AND session_hash=?').bind(id,keyId,session).first<any>();
 if(!order)throw new ApiError(404,'not_found','Pedido não encontrado.');
 return present(order);
}
export async function receiveStoreEvent(key:any,raw:string,signature:string){
 if(env.STORE_ORDERS_ENABLED!=='true'||key.id!==env.STORE_API_KEY_ID)throw new ApiError(403,'store_disabled','Integração indisponível.');
 if(!key.webhook_secret||!verify(raw,signature,unseal(key.webhook_secret,env.APP_ENCRYPTION_KEY||'')))throw new ApiError(401,'invalid_signature','Assinatura inválida.');
 const e=z.object({id:text,type:z.enum(['transaction.created','transaction.paid','transaction.expired','transaction.failed','transaction.refunded','transaction.chargeback']),created:z.number().int(),data:z.object({id:text,external_reference:text,amount_cents:z.number().int(),status:z.enum(['CREATING','PENDING','PAID','EXPIRED','FAILED','REFUNDED','CHARGEBACK'])}).passthrough()}).parse(JSON.parse(raw));
 const expected:Record<string,string[]>={'transaction.created':['CREATING','PENDING'],'transaction.paid':['PAID'],'transaction.expired':['EXPIRED'],'transaction.failed':['FAILED'],'transaction.refunded':['REFUNDED'],'transaction.chargeback':['CHARGEBACK']};
 if(!expected[e.type].includes(e.data.status))throw new ApiError(422,'event_mismatch','Evento divergente.');
 const order=await db().prepare('SELECT * FROM store_orders WHERE id=? AND key_id=? AND amount=?').bind(e.data.external_reference,key.id,e.data.amount_cents).first<any>();
 const tx=order&&await transaction(order);
 if(!tx||tx.id!==e.data.id)throw new ApiError(409,'order_mismatch','Transação divergente.');
 const previous=await db().prepare('SELECT payload_hash FROM store_webhook_events WHERE key_id=? AND event_id=?').bind(key.id,e.id).first<any>();
 if(previous&&previous.payload_hash!==hash(raw))throw new ApiError(409,'event_conflict','Evento divergente.');
 await db().prepare('INSERT OR IGNORE INTO store_webhook_events(key_id,event_id,payload_hash,order_id,received_at) VALUES(?,?,?,?,?)').bind(key.id,e.id,hash(raw),order.id,now()).run();
 // Only the canonical, provider-confirmed gateway transaction can settle an order.
 await settleStoreOrder(order);
 return {received:true};
}
export async function settleStoreOrders(){
 if(env.STORE_ORDERS_ENABLED!=='true')return;
 const rows=await db().prepare(`SELECT o.* FROM store_orders o JOIN transactions t ON t.key_id=o.key_id AND t.idempotency_key='store:'||o.id WHERE o.paid_at IS NULL AND t.status='PAID' LIMIT 25`).all<any>();
 for(const order of rows.results)await settleStoreOrder(order);
}

export async function dispatchStoreTracker(){
 if(env.STORE_ORDERS_ENABLED!=='true'||env.STORE_TRACKERORDER_ENABLED!=='true')return;
 const setting=await db().prepare("SELECT value FROM settings WHERE id='trackerorder_config'").first<any>();
 if(!setting)return;
 const config=decode(setting.value);
 if(!config.token||!config.webhook_key)return;
 await db().prepare("UPDATE store_effects SET state='REVIEW' WHERE kind='trackerorder' AND state='SENDING' AND started_at<?").bind(now()-120000).run();
 const jobs=await db().prepare("SELECT order_id,result FROM store_effects WHERE kind='trackerorder' AND state='PENDING' LIMIT 3").all<any>();
 for(const job of jobs.results){
  const claim=await db().prepare("UPDATE store_effects SET state='SENDING',started_at=? WHERE order_id=? AND kind='trackerorder' AND state='PENDING' RETURNING order_id").bind(now(),job.order_id).first();
  if(!claim)continue;
  if(job.result!==hash(config.webhook_key)){await db().prepare("UPDATE store_effects SET state='REVIEW' WHERE order_id=? AND kind='trackerorder'").bind(job.order_id).run();continue;}
  const order=await db().prepare('SELECT * FROM store_orders WHERE id=? AND paid_at IS NOT NULL').bind(job.order_id).first<any>();
  const tx=order&&await transaction(order);
  if(!tx||tx.status!=='PAID'){await db().prepare("UPDATE store_effects SET state='CANCELLED' WHERE order_id=? AND kind='trackerorder'").bind(job.order_id).run();continue;}
  try{
   const {customer}=decode(order.buyer);const snapshot=JSON.parse(order.snapshot);
   const response=await fetch('https://api.trackerorders.online/functions/v1/create-order',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token},body:JSON.stringify({webhook_key:config.webhook_key,external_order_id:order.id,customer_name:customer.name,customer_email:customer.email,customer_phone:'+55'+customer.phone,order_items:JSON.stringify(snapshot.items.map((i:any)=>({name:i.name+' · '+i.variant,qty:i.qty,price:i.unit_cents/100}))),total_value:order.amount/100,email_flow_enabled:true}),redirect:'error',signal:AbortSignal.timeout(10000)});
   const data=await response.json();
   if(!response.ok||data.error||data.success===false||!z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).safeParse(data.tracking_code).success)throw Error('uncertain');
   await db().prepare("UPDATE store_effects SET state='SENT',completed_at=?,result=? WHERE order_id=? AND kind='trackerorder'").bind(now(),data.tracking_code,order.id).run();
  }catch{await db().prepare("UPDATE store_effects SET state='REVIEW' WHERE order_id=? AND kind='trackerorder'").bind(job.order_id).run();}
 }
}

export async function adminStoreOrders(id?:string){
 if(env.STORE_ORDERS_ENABLED!=='true')return {orders:[]};
 if(!id)return {orders:(await db().prepare('SELECT id,amount,transaction_id,created_at,paid_at FROM store_orders ORDER BY created_at DESC LIMIT 100').all()).results};
 const order=await db().prepare('SELECT * FROM store_orders WHERE id=?').bind(id).first<any>();
 if(!order)throw new ApiError(404,'not_found','Pedido não encontrado.');
 return {id:order.id,amount_cents:order.amount,created_at:order.created_at,paid_at:order.paid_at,transaction_id:order.transaction_id,...JSON.parse(order.snapshot),...decode(order.buyer),effects:(await db().prepare('SELECT kind,state,result FROM store_effects WHERE order_id=?').bind(id).all()).results};
}
