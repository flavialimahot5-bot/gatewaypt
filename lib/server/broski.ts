import { z } from "zod";
import { audit, db, env, now, putSetting, setting } from "./core";
import { ApiError, hash, seal, unseal, verify } from "./security";

const configKey = "broski_notifications";
type Configuration = { enabled: boolean; secret: string };
async function configuration(): Promise<Configuration | null> {
  const value = await setting(configKey);
  return value ? JSON.parse(unseal(value, env.APP_ENCRYPTION_KEY || "")) : null;
}
export async function broskiOverview() {
  const config = await configuration();
  return {
    configured: !!config?.secret,
    enabled: config?.enabled === true,
    webhook_url: (env.APP_ORIGIN || "").replace(/\/$/, "") + "/api/webhooks/broski",
  };
}
export async function saveBroskiNotifications(input: unknown, actor: string) {
  const data = z.object({
    enabled: z.boolean(),
    webhook_secret: z.string().trim().max(500).optional(),
  }).strict().parse(input);
  const previous = await configuration();
  const secret = data.webhook_secret || previous?.secret || "";
  if (secret && !/^whbroski_[A-Za-z0-9_-]{16,490}$/.test(secret))
    throw new ApiError(422, "invalid_secret", "Cole o segredo whbroski_ fornecido pela Broski.");
  if (data.enabled && !secret)
    throw new ApiError(422, "missing_secret", "Cadastre o webhook na Broski e salve o segredo para ativar.");
  await putSetting(configKey, seal(JSON.stringify({ enabled: data.enabled, secret }), env.APP_ENCRYPTION_KEY || ""));
  await audit(actor, "broski.notifications.configure", "broski");
  return broskiOverview();
}

// This integration is notification-only: it never creates a BRL transaction,
// changes the checkout gateway, or sends advertising conversion events.
export async function receiveBroskiWebhook(raw: string, signature: string | null) {
  const config = await configuration();
  if (!config?.secret || !verify(raw, signature, config.secret))
    throw new ApiError(401, "invalid_signature", "Assinatura inválida.");
  if (!config.enabled) return false;
  const event = z.object({ id: z.string().min(1).max(200), type: z.string().max(100), data: z.unknown().optional() }).parse(JSON.parse(raw));
  if (event.type !== "order.paid") return false;
  const object = z.object({ object: z.unknown().optional() }).passthrough().parse(event.data).object;
  const order = z.object({
    id: z.string().min(1).max(200), object: z.literal("order"), status: z.string(),
    livemode: z.boolean(), currency: z.string(),
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.enum(["mbway", "multibanco"]),
  }).parse(object);
  if (order.status !== "paid" || !order.livemode || order.currency !== "EUR") return false;
  // Deduplicate by order, even if Broski retries with a different event ID.
  const id = "broski:paid:" + hash(order.id);
  await db().prepare("INSERT OR IGNORE INTO push_events(id,transaction_id,event,created_at,external_source,external_amount,external_currency,external_method) VALUES (?,?,'PAID',?,'broski',?,'EUR',?)")
    .bind(id, id, now(), order.amount, order.method).run();
  return true;
}
