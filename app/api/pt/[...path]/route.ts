import { after } from 'next/server';
import { admin, json, route } from '@/lib/server/core';
import { ptCreate, ptStatus, ptWebhook, ptOverview, ptConfigure, ptRefund, sendVoucherEmails, ptProviderOrders, ptProviderOrder } from '@/lib/server/portugal';
import { BroskiError } from '@/lib/server/broski-client';
import { ApiError } from '@/lib/server/security';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request) {
  return route(async()=> {
    try {
      const path=new URL(request.url).pathname.replace('/api/pt/','');
      if(path==='webhook' && request.method==='POST') { await ptWebhook(request); return json({received:true}); }
      if(path.startsWith('products/') && request.method==='POST') {
        const result=await ptCreate(request,path.slice(9));
        after(sendVoucherEmails); return json(result);
      }
      if(path.startsWith('orders/') && request.method==='GET') return json(await ptStatus(path.slice(7)));
      const user=await admin(request);
      if(path==='provider-orders' && request.method==='GET') return json(await ptProviderOrders(new URL(request.url).searchParams));
      if(path.startsWith('provider-orders/') && request.method==='GET') return json(await ptProviderOrder(path.slice(16)));
      if(path==='admin' && request.method==='GET') return json(await ptOverview());
      if(path==='admin' && request.method==='POST') return json(await ptConfigure(request,user.email));
      if(path.startsWith('refunds/') && request.method==='POST') return json(await ptRefund(request,path.slice(8),user.email));
      throw new ApiError(404,'not_found','Endpoint não encontrado.');
    } catch(e) {
      if(e instanceof BroskiError) return json({error:{code:e.code,message:e.message,retry_after_seconds:e.retryAfter}},e.status,e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});
      throw e;
    }
  });
}
export {handle as GET,handle as POST};
