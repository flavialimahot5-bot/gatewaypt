import { createHmac } from "node:crypto";
import { z } from "zod";
import { db, env, now, setting, putSetting, audit } from "./core";
import { ApiError, equal, hash, randomToken, seal, unseal } from "./security";
import { decodePlowfProfile, plowfProfile, plowfProfileSummary, validatePlowfBuyer } from "./plowf-profile";
import { bravoConnection, bravoOverview, bravoRequest } from "./bravopay";

const connectionId = /^gw_[A-Za-z0-9_-]{43}$/;
export type PlowfConnection = { token: string; webhook: string; created_at: number };
class PlowfValidationError extends ApiError {
  constructor(message: string, readonly requiresCustomerName: boolean) { super(502, "plowf_http_422", message); }
}
export async function plowfRequiresBuyerName(id: string | null, snapshot?: string | null) {
  return !!id && ((snapshot === undefined ? await plowfProfile(id) : decodePlowfProfile(snapshot)).mode === "marketplace" || await setting("plowf_requires_customer_name:" + id) === "true");
}
export async function plowfConnection(id: string): Promise<PlowfConnection> {
  if (!connectionId.test(id)) throw new ApiError(404, "not_found", "Conexão não encontrada.");
  const value = await setting("plowf_connection:" + id);
  if (!value) throw new ApiError(503, "plowf_missing", "Configure a Plowf na aba Gateways.");
  return JSON.parse(unseal(value, env.APP_ENCRYPTION_KEY || ""));
}
export async function plowfRequest(connection: PlowfConnection, path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch("https://app.plowf.com/api/v1" + path, {
      method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store",
    });
  } catch { throw new ApiError(503, "plowf_unavailable", "A Plowf não confirmou a resposta. Consulte a mesma cobrança; não gere outra tentativa."); }
  if (!response.ok) {
    let validation = "A Plowf recusou os dados da cobrança. Confira o tipo da conta e os campos exigidos na Plowf.";
    if (response.status === 422) {
      // Only expose known field labels, never upstream messages that may echo buyer data or secrets.
      const payload = await response.json().catch(() => null);
      const labels: Record<string, string> = { value: "valor", type: "tipo de pagamento", products: "itens do pedido", customer: "dados do comprador", "customer.name": "nome do comprador", "customer.document": "CPF/CNPJ do comprador", "customer.email": "e-mail do comprador", "customer.phone": "telefone do comprador", final_beneficiary: "beneficiário final" };
      const fields = payload?.errors && typeof payload.errors === "object" ? Object.keys(payload.errors) : [];
      const invalid = [...new Set(fields.map(field => Object.hasOwn(labels, field) ? labels[field] : field.startsWith("products.") ? labels.products : field.startsWith("final_beneficiary.") ? labels.final_beneficiary : undefined).filter(Boolean))];
      if (invalid.length) validation = `A Plowf recusou os seguintes campos: ${invalid.join(", ")}. Confira os dados e as exigências desta conta na Plowf.`;
      throw new PlowfValidationError(validation, fields.includes("customer.name"));
    }
    throw new ApiError(502, "plowf_http_" + response.status,
      response.status === 401 || response.status === 403 ? "A Plowf recusou o token ou suas permissões." : `A Plowf respondeu com erro ${response.status}. Consulte a cobrança antes de repetir.`);
  }
  try { return (await response.json()).data; }
  catch { throw new ApiError(502, "plowf_response", "Resposta inválida da Plowf. Consulte a mesma cobrança antes de repetir."); }
}
export function plowfWebhookUrl(id: string) { return `${env.APP_ORIGIN}/api/webhooks/plowf/${id}`; }
export async function savePlowf(input: unknown, actor: string) {
  const optionalSecret = (min: number, max: number) => z.preprocess(value => typeof value === "string" && !value.trim() ? undefined : value, z.string().trim().min(min).max(max).optional());
  const body = z.object({ token: optionalSecret(10, 8000), webhook_secret: optionalSecret(16, 500) }).strict().parse(input);
  const current = await setting("plowf_connection");
  const old = current ? await plowfConnection(current) : null;
  const config = { token: body.token || old?.token || "", webhook: body.webhook_secret || old?.webhook || "", created_at: now() };
  if (!config.token || !config.webhook) throw new ApiError(422, "gateway_missing", "Informe o token da API e o segredo do webhook na primeira configuração.");
  if (old && old.token === config.token && old.webhook === config.webhook) return { saved: true, webhook_url: plowfWebhookUrl(current!) };
  const providers = await plowfRequest(config, "/providers");
  if (!Array.isArray(providers)) throw new ApiError(502, "plowf_response", "Não foi possível validar a resposta da Plowf.");
  // Immutable credentials per connection keep existing charges bound to their original account.
  const id = randomToken("gw_");
  await putSetting("plowf_connection:" + id, seal(JSON.stringify(config), env.APP_ENCRYPTION_KEY || ""));
  await putSetting("plowf_connection", id);
  await audit(actor, "gateway.configured", "plowf");
  return { saved: true, webhook_url: plowfWebhookUrl(id) };
}
export async function activateGateway(input: unknown, actor: string) {
  const body = z.object({ gateway: z.enum(["pagpixhub", "plowf", "bravopay", "none"]), expected_gateway: z.enum(["pagpixhub", "plowf", "bravopay"]).optional() }).strict().parse(input);
  if (body.gateway === "none") {
    if (!body.expected_gateway) throw new ApiError(422, "gateway_required", "Informe qual gateway deve ser desativado.");
    // A stale browser tab must not turn off a different gateway activated elsewhere.
    await db().prepare("INSERT OR IGNORE INTO settings(id,value,updated_at) VALUES ('active_gateway','pagpixhub',?)").bind(now()).run();
    const updated = await db().prepare("UPDATE settings SET value='none',updated_at=? WHERE id='active_gateway' AND value=? RETURNING id").bind(now(), body.expected_gateway).first();
    if (!updated) throw new ApiError(409, "gateway_changed", "O gateway ativo mudou. Atualize a tela antes de desativar.");
    await audit(actor, "gateway.deactivated", body.expected_gateway);
    return { active: "none" };
  }
  let selectedConnection: string | null = null;
  if (body.gateway === "pagpixhub") {
    if (!await setting("provider_token") || !await setting("provider_webhook")) throw new ApiError(422, "gateway_missing", "Configure a chave e o webhook da PagPixHub.");
  } else if (body.gateway === "bravopay") {
    const id = await setting("bravopay_connection");
    if (!id) throw new ApiError(422, "gateway_missing", "Configure a BravoPay primeiro.");
    const connection = await bravoConnection(id);
    if (!connection.webhook) throw new ApiError(422, "webhook_required", "Cadastre o webhook na BravoPay e salve aqui o segredo fornecido por ela antes de ativar.");
    const account = await bravoRequest(connection, "/me");
    if (!account?.id) throw new ApiError(502, "bravopay_response", "Não foi possível validar a conta BravoPay.");
    selectedConnection = id;
  } else {
    const id = await setting("plowf_connection");
    if (!id) throw new ApiError(422, "gateway_missing", "Configure a Plowf primeiro.");
    const connection = await plowfConnection(id);
    const hooks = await plowfRequest(connection, "/webhooks?url=" + encodeURIComponent(plowfWebhookUrl(id)) + "&per_page=100");
    if (!Array.isArray(hooks) || !hooks.some(h => h.url === plowfWebhookUrl(id) && h.status === "ACTIVE" && h.token === connection.webhook && (!h.events?.length || h.events.includes("PAYMENT")))) {
      throw new ApiError(422, "webhook_required", "Cadastre na Plowf a URL e o token secreto desta conexão, com o evento PAYMENT ativo, antes de ativar.");
    }
    selectedConnection = id;
  }
  const settings = [["active_gateway", body.gateway], ...(selectedConnection ? [[body.gateway + "_active_connection", selectedConnection]] : [])];
  await db().batch(settings.map(([id, value]) => db().prepare("INSERT INTO settings(id,value,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(id, value, now())));
  await audit(actor, "gateway.activated", body.gateway);
  return { active: body.gateway };
}
export async function gatewayOverview() {
  const current = await setting("plowf_connection"), activeConnection = await setting("plowf_active_connection");
  const previous = await db().prepare("SELECT gateway_connection AS id,COUNT(*) AS total,SUM(CASE WHEN status IN ('CREATING','PENDING') THEN 1 ELSE 0 END) AS pending FROM transactions WHERE gateway='plowf' GROUP BY gateway_connection").all<any>();
  return {
    active: await setting("active_gateway") || "pagpixhub", origin: env.APP_ORIGIN,
    bravopay: await bravoOverview(),
    pagpixhub: { configured: !!await setting("provider_token"), webhook_configured: !!await setting("provider_webhook"), webhook_url: `${env.APP_ORIGIN}/api/webhooks/pagpixhub` },
    plowf: { configured: !!current, sales_profile: await plowfProfileSummary(current), current, active_connection: activeConnection, webhook_url: current ? plowfWebhookUrl(current) : null, previous: previous.results.map(r => ({ ...r, webhook_url: plowfWebhookUrl(r.id) })) },
  };
}
export function plowfCents(value: unknown): number {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new ApiError(502, "plowf_amount", "Valor inválido retornado pela Plowf.");
  const [units, decimals = ""] = text.split(".");
  const cents = Number(units) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new ApiError(502, "plowf_amount", "Valor inválido retornado pela Plowf.");
  return cents;
}
export function normalizePlowf(raw: unknown, tx: any) {
  const p = z.object({ uuid: z.string().uuid(), external_ref: z.string(), value: z.union([z.string(), z.number()]), fees: z.union([z.string(), z.number()]).optional(), currency: z.literal("BRL"), type: z.literal("PIX"), status: z.enum(["UNDEFINED","PENDING","PROCESSING","PAID","FAILED","CANCELLED","EXPIRED","REFUNDED","PARTIALLY_REFUNDED"]), payment: z.object({ value: z.union([z.string(), z.number()]).optional(), payload: z.string().nullable().optional(), expires_at: z.string().nullable().optional() }).nullable().optional(), history: z.array(z.object({ status: z.string(), created_at: z.string() })).optional() }).passthrough().parse(raw);
  if (p.external_ref !== tx.id || plowfCents(p.value) !== tx.amount) throw new ApiError(409, "provider_mismatch", "A cobrança Plowf não corresponde ao pedido.");
  if (p.payment?.value !== undefined && plowfCents(p.payment.value) !== tx.amount) throw new ApiError(409, "provider_mismatch", "O valor do Pix Plowf não corresponde ao pedido.");
  const amount = plowfCents(p.value), fee = p.fees === undefined ? undefined : plowfCents(p.fees);
  const status = ({ UNDEFINED:"PENDING", PROCESSING:"PENDING", CANCELLED:"FAILED", PARTIALLY_REFUNDED:"REFUNDED" } as Record<string,string>)[p.status] || p.status;
  const paid = p.history?.find(h => h.status === "PAID")?.created_at;
  if (p.payment?.expires_at && !Number.isFinite(Date.parse(p.payment.expires_at))) throw new ApiError(502, "plowf_expiry", "Prazo inválido retornado pela Plowf.");
  return { id: "plowf:" + p.uuid, external_reference: tx.id, amount_cents: amount, ...(fee === undefined ? {} : { fee_cents: fee, net_cents: amount - fee }), status, pix_status: p.status.toLowerCase(), pix: { copy_paste: p.payment?.payload || null, expires_at: p.payment?.expires_at || null }, ...(paid ? { paid_at: paid } : {}) };
}
export async function readPlowf(tx: any, uuid?: string) {
  const id = z.string().uuid().parse(uuid || tx.provider_id?.replace(/^plowf:/, ""));
  return normalizePlowf(await plowfRequest(await plowfConnection(tx.gateway_connection), "/payments/" + id), tx);
}
async function plowfOrderProducts(tx: any) {
  if (!tx.key_id.startsWith("product:")) return undefined;
  const order = await db().prepare("SELECT product_id,snapshot FROM product_orders WHERE id=? AND product_id=?")
    .bind(tx.external_reference, tx.key_id.slice("product:".length)).first<{ product_id: string; snapshot: string }>();
  // Use the sold price, not a catalog price that the seller may have edited since ordering.
  let snapshot;
  try { snapshot = order && JSON.parse(order.snapshot); } catch { /* Reject a malformed snapshot before sending. */ }
  const parsed = z.object({ name: z.string().trim().min(2).max(150), amount: z.number().int().positive().safe(), quantity: z.number().int().min(1).max(99).default(1), shipping: z.number().int().nonnegative().safe(), shipping_method: z.enum(["flex", "full"]).optional() }).safeParse(snapshot);
  if (!order || !parsed.success || parsed.data.amount * parsed.data.quantity + parsed.data.shipping !== tx.amount) {
    throw new ApiError(409, "plowf_order_mismatch", "Os itens do pedido não correspondem ao valor da cobrança.");
  }
  const item = parsed.data;
  // Stable SKU references let Plowf reuse the catalog instead of creating a product per purchase.
  return [
    { external_ref: order.product_id, name: item.name, price: item.amount / 100, quantity: item.quantity },
    ...(item.shipping ? [{ external_ref: `shipping:${order.product_id}:${item.shipping_method || "standard"}`, name: "Frete" + (item.shipping_method ? ` ${item.shipping_method === "full" ? "Full" : "Flex"}` : ""), price: item.shipping / 100, quantity: 1 }] : []),
  ];
}
export async function createPlowf(tx: any, customer: any) {
  const connection = await plowfConnection(tx.gateway_connection);
  const profile = decodePlowfProfile(tx.plowf_profile);
  validatePlowfBuyer(profile, customer, tx.key_id);
  const products = await plowfOrderProducts(tx);
  // The public API does not document an idempotent create operation. Reserve one outbound attempt.
  const claimed = await db().prepare("UPDATE transactions SET gateway_sent_at=? WHERE id=? AND gateway='plowf' AND gateway_sent_at IS NULL RETURNING id").bind(now(), tx.id).first();
  if (!claimed) return null;
  const buyer = { ...(customer.name ? { name: customer.name } : {}), ...(customer.cpf ? { document: customer.cpf.replace(/\D/g, "") } : {}), ...(customer.email ? { email: customer.email } : {}), ...(customer.phone ? { phone: customer.phone } : {}) };
  try {
    const raw = await plowfRequest(connection, "/payments", { value: tx.amount / 100, type: "PIX", external_ref: tx.id, ...(profile.mode === "marketplace" ? { final_beneficiary: profile.beneficiary } : {}), ...(products ? { products } : {}), ...(Object.keys(buyer).length ? { customer: buyer } : {}) });
    return normalizePlowf(raw, tx);
  } catch (error) {
    // A documented validation/auth rejection did not create a charge; keep the failed attempt visible.
    if (error instanceof ApiError && /^plowf_http_(400|401|403|422)$/.test(error.code)) await db().prepare("UPDATE transactions SET status='FAILED',updated_at=? WHERE id=? AND status='CREATING' AND provider_id IS NULL").bind(now(), tx.id).run();
    if (error instanceof PlowfValidationError && error.requiresCustomerName) await putSetting("plowf_requires_customer_name:" + tx.gateway_connection, "true");
    throw error;
  }
}
export async function findPlowf(tx: any) {
  const rows = await plowfRequest(await plowfConnection(tx.gateway_connection), "/payments?per_page=100");
  if (!Array.isArray(rows)) throw new ApiError(502, "plowf_response", "Resposta inválida da Plowf.");
  const matches = rows.filter(p => p.external_ref === tx.id);
  if (matches.length > 1) throw new ApiError(409, "plowf_ambiguous", "Mais de uma cobrança Plowf usa esta referência. Confira na Plowf.");
  return matches.length ? readPlowf(tx, matches[0].uuid) : null;
}
export async function receivePlowfWebhook(connectionId: string, raw: string, signature: string | null) {
  const connection = await plowfConnection(connectionId);
  if (!signature || !equal(createHmac("sha256", connection.webhook).update(raw).digest("hex"), signature)) throw new ApiError(401, "invalid_signature", "Assinatura inválida.");
  const event = z.object({ event: z.string(), data: z.object({ uuid: z.string().uuid(), external_ref: z.string().max(150).nullable().optional() }).passthrough() }).parse(JSON.parse(raw));
  if (event.event !== "PAYMENT") return;
  const id = "plowf:" + hash(connectionId + ":" + raw);
  await db().prepare("INSERT OR IGNORE INTO gateway_events(id,connection_id,provider_id,external_reference,received_at,next_at) VALUES (?,?,?,?,?,?)")
    .bind(id, connectionId, event.data.uuid, event.data.external_ref || "", now(), now()).run();
  return id;
}
