import { createHmac } from "node:crypto";
import { z } from "zod";
import { db, env, now, setting, putSetting, audit } from "./core";
import { ApiError, equal, hash, randomToken, seal, unseal } from "./security";

type BravoConnection = { token: string; webhook: string; created_at: number };
const remoteId = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/);
export function bravoWebhookUrl(id: string) { return `${env.APP_ORIGIN}/api/webhooks/bravopay/${id}`; }
export async function bravoConnection(id: string): Promise<BravoConnection> {
  if (!/^gw_[A-Za-z0-9_-]{43}$/.test(id)) throw new ApiError(404, "not_found", "Conexão não encontrada.");
  const value = await setting("bravopay_connection:" + id);
  if (!value) throw new ApiError(503, "bravopay_missing", "Configure a BravoPay na aba Gateways.");
  return JSON.parse(unseal(value, env.APP_ENCRYPTION_KEY || ""));
}
export async function bravoRequest(connection: BravoConnection, path: string, body?: unknown, idempotency?: string) {
  let response: Response;
  try {
    response = await fetch("https://bravopay.club/api/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json", Accept: "application/json", ...(idempotency ? { "Idempotency-Key": idempotency } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store",
    });
  } catch { throw new ApiError(503, "bravopay_unavailable", "A BravoPay não confirmou a resposta. Consulte a mesma cobrança antes de repetir."); }
  // Upstream errors can contain credentials or buyer data. Never relay their body.
  if (!response.ok) throw new ApiError(502, "bravopay_http_" + response.status,
    [401, 403].includes(response.status) ? "A BravoPay recusou o token ou suas permissões." : `A BravoPay respondeu com erro ${response.status}. Consulte a cobrança antes de repetir.`);
  try { return await response.json(); }
  catch { throw new ApiError(502, "bravopay_response", "Resposta inválida da BravoPay."); }
}
export async function saveBravo(input: unknown, actor: string) {
  const optionalSecret = (min: number, max: number) => z.preprocess(v => typeof v === "string" && !v.trim() ? undefined : v, z.string().trim().min(min).max(max).optional());
  const body = z.object({ token: optionalSecret(10, 8000), webhook_secret: optionalSecret(16, 500) }).strict().parse(input);
  const current = await setting("bravopay_connection");
  const old = current ? await bravoConnection(current) : null;
  const token = body.token || old?.token || "";
  if (!token) throw new ApiError(422, "gateway_missing", "Informe o token da API BravoPay.");
  const tokenChanged = !!old && old.token !== token;
  const config = { token, webhook: body.webhook_secret || (tokenChanged ? "" : old?.webhook) || "", created_at: now() };
  if (old && old.token === token && old.webhook === config.webhook) return { saved: true, webhook_url: bravoWebhookUrl(current!) };
  const account = await bravoRequest(config, "/me");
  if (!account || typeof account.id !== "string" || !account.id) throw new ApiError(502, "bravopay_response", "Não foi possível validar a conta BravoPay.");
  const used = current && (await setting("bravopay_active_connection") === current || await db().prepare("SELECT id FROM transactions WHERE gateway='bravopay' AND gateway_connection=? LIMIT 1").bind(current).first());
  // The draft URL stays stable while the merchant copies the provider-generated secret.
  // Once activated/used, credentials are immutable for outstanding payments.
  const id = current && !tokenChanged && !used ? current : randomToken("gw_");
  await putSetting("bravopay_connection:" + id, seal(JSON.stringify(config), env.APP_ENCRYPTION_KEY || ""));
  await putSetting("bravopay_connection", id);
  await audit(actor, "gateway.configured", "bravopay");
  return { saved: true, webhook_url: bravoWebhookUrl(id) };
}
export async function bravoOverview() {
  const current = await setting("bravopay_connection");
  const config = current ? await bravoConnection(current) : null;
  const previous = await db().prepare("SELECT gateway_connection AS id,COUNT(*) AS total,SUM(CASE WHEN status IN ('CREATING','PENDING') THEN 1 ELSE 0 END) AS pending FROM transactions WHERE gateway='bravopay' GROUP BY gateway_connection").all<any>();
  return { configured: !!config, webhook_configured: !!config?.webhook, current, active_connection: await setting("bravopay_active_connection"), webhook_url: current ? bravoWebhookUrl(current) : null, previous: previous.results.map(c => ({ ...c, webhook_url: bravoWebhookUrl(c.id) })) };
}
export function normalizeBravo(raw: unknown, tx: any) {
  const p = z.object({
    id: remoteId, status: z.enum(["PENDING", "PAID", "EXPIRED", "FAILED", "REFUNDED", "CHARGEBACK"]),
    amount_cents: z.number().int().nonnegative().safe(), currency: z.literal("BRL"), method: z.literal("PIX"),
    fee_cents: z.number().int().nonnegative().safe().optional(), net_cents: z.number().int().safe().optional(),
    external_reference: z.string().nullable().optional(), paid_at: z.string().nullable().optional(),
    pix: z.object({ copy_paste: z.string().nullable().optional(), expires_at: z.string().nullable().optional() }).nullable().optional(),
  }).parse(raw);
  if (p.amount_cents !== tx.amount || (p.external_reference != null && p.external_reference !== tx.id) || (tx.provider_id && tx.provider_id !== "bravopay:" + p.id)) throw new ApiError(409, "provider_mismatch", "A cobrança BravoPay não corresponde ao pedido.");
  if ((p.pix?.expires_at && !Number.isFinite(Date.parse(p.pix.expires_at))) || (p.paid_at && !Number.isFinite(Date.parse(p.paid_at)))) throw new ApiError(502, "bravopay_response", "Data inválida retornada pela BravoPay.");
  return { ...p, id: "bravopay:" + p.id, pix: p.pix || undefined };
}
export async function readBravo(tx: any, requestedId?: string) {
  const id = remoteId.parse(requestedId || tx.provider_id?.replace(/^bravopay:/, ""));
  const raw = await bravoRequest(await bravoConnection(tx.gateway_connection), "/transactions/" + encodeURIComponent(id));
  if (raw?.id !== id || (!tx.provider_id && raw?.external_reference !== tx.id)) throw new ApiError(409, "provider_mismatch", "Referência BravoPay divergente.");
  return normalizeBravo(raw, tx);
}
export async function findBravo(tx: any) {
  const result = await bravoRequest(await bravoConnection(tx.gateway_connection), "/transactions?external_reference=" + encodeURIComponent(tx.id) + "&limit=2");
  if (!Array.isArray(result?.data)) throw new ApiError(502, "bravopay_response", "Resposta inválida da BravoPay.");
  if (result.data.length > 1 || result.has_more) throw new ApiError(409, "bravopay_ambiguous", "Mais de uma cobrança BravoPay usa esta referência. Confira na BravoPay.");
  if (!result.data.length) return null;
  if (result.data[0].external_reference !== tx.id) throw new ApiError(409, "provider_mismatch", "Referência BravoPay divergente.");
  return readBravo(tx, result.data[0].id);
}
export async function createBravo(tx: any, data: any) {
  if (tx.amount > 50000000) throw new ApiError(422, "bravopay_amount", "O valor excede o limite por cobrança da BravoPay.");
  const connection = await bravoConnection(tx.gateway_connection);
  if (!connection.webhook) throw new ApiError(503, "gateway_missing", "Configure o webhook da BravoPay antes de gerar cobranças.");
  await db().prepare("UPDATE transactions SET gateway_sent_at=COALESCE(gateway_sent_at,?) WHERE id=? AND gateway='bravopay'").bind(now(), tx.id).run();
  return normalizeBravo(await bravoRequest(connection, "/transactions", { ...data, method: "pix", external_reference: tx.id }, tx.id), tx);
}
export async function receiveBravoWebhook(connectionId: string, raw: string, signature: string | null) {
  const connection = await bravoConnection(connectionId);
  const parts = signature?.match(/^t=(\d+),v1=([a-fA-F0-9]{64})$/);
  if (!connection.webhook || !parts || Math.abs(Math.floor(now() / 1000) - Number(parts[1])) > 300 || !equal(createHmac("sha256", connection.webhook).update(parts[1] + "." + raw).digest("hex"), parts[2].toLowerCase())) throw new ApiError(401, "invalid_signature", "Assinatura inválida.");
  const envelope = z.object({ id: remoteId, type: z.string(), data: z.unknown() }).parse(JSON.parse(raw));
  if (!["transaction.created", "transaction.paid", "transaction.refunded", "transaction.chargeback", "transaction.expired", "transaction.failed"].includes(envelope.type)) return;
  const data = z.object({ id: remoteId, external_reference: z.string().max(120).nullable().optional() }).parse(envelope.data);
  const id = "bravopay:" + hash(connectionId + ":" + envelope.id);
  await db().prepare("INSERT OR IGNORE INTO gateway_events(id,connection_id,provider_id,external_reference,received_at,next_at) VALUES (?,?,?,?,?,?)").bind(id, connectionId, data.id, data.external_reference || "", now(), now()).run();
  return id;
}
