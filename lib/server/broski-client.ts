import { z } from 'zod';
import { ApiError } from './security';

export function normalizePtPhone(value: string) {
  let phone = value.replace(/[\s()-]/g, '');
  if (phone.startsWith('00351')) phone = '+' + phone.slice(2);
  if (/^9\d{8}$/.test(phone)) phone = '+351' + phone;
  if (!/^\+3519[1236]\d{7}$/.test(phone)) throw new ApiError(422, 'invalid_phone', 'Indique um telemóvel português válido.');
  return phone;
}
export const BroskiOrder = z.object({
  id: z.string().min(1), amount: z.number().int().positive(), currency: z.literal('EUR'),
  method: z.enum(['mbway', 'multibanco']), external_reference: z.string(),
  status: z.enum(['pending', 'awaiting_payment', 'paid', 'failed', 'expired', 'refunded']),
  livemode: z.boolean(), amount_refunded: z.number().int().nonnegative().optional(),
  multibanco: z.object({ entity: z.string(), reference: z.string(), amount: z.number().int(), expires_at: z.string().datetime() }).optional(),
});
export class BroskiError extends ApiError {
  constructor(status: number, code: string, message: string, public retryAfter = 0) { super(status, code, message); }
}
export async function broskiRequest(path: string, token: string, body?: unknown, key?: string) {
  let response: Response;
  try {
    response = await fetch('https://api.broski.pt/v1' + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new BroskiError(503, 'provider_uncertain', 'Não foi possível confirmar a resposta. Tente novamente para consultar a mesma tentativa.'); }
  let data: any;
  try { data = await response.json(); } catch { throw new BroskiError(502, 'provider_uncertain', 'Resposta inválida do processador. Consulte a mesma tentativa.'); }
  if (!response.ok) throw new BroskiError(response.status, data.error?.code || 'provider_error', response.status === 401 ? 'A ligação à Broski precisa de ser configurada.' : data.error?.message || 'Não foi possível processar o pagamento.', Number(data.error?.retry_after_seconds || response.headers.get('Retry-After') || 0));
  return data;
}
