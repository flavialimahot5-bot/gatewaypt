import { sendVoucherEmails } from '@/lib/server/portugal';
import { pushBackground } from '@/lib/server/push';
export const runtime='nodejs';
export const maxDuration=120;
export async function GET(request:Request){
 if(!process.env.CRON_SECRET || request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:'Unauthorized'},{status:401});
 await Promise.all([sendVoucherEmails(),pushBackground()]);return Response.json({ok:true});
}
