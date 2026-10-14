import { z } from "zod";
import { db, env, setting, now, audit } from "./core";
import { ApiError, seal, unseal } from "./security";
import { validCpf } from "../buyer-fields";

export function validSellerDocument(value: string) {
  if (value.length === 11) return validCpf(value);
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (const length of [12, 13]) {
    let sum = 0, weight = length - 7;
    for (let i = 0; i < length; i++) { sum += Number(value[i]) * weight; weight = weight === 2 ? 9 : weight - 1; }
    const remainder = sum % 11;
    if (Number(value[length]) !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}
const beneficiarySchema = z.object({
  document: z.string().regex(/^[\d./-]+$/).transform(v => v.replace(/\D/g, "")).refine(validSellerDocument, "Informe o CPF/CNPJ válido do vendedor real."),
  name: z.string().trim().min(3).max(120).optional(),
}).strict();
const profileSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("own") }).strict(),
  z.object({ mode: z.literal("marketplace"), beneficiary: beneficiarySchema }).strict(),
]);
export type PlowfProfile = z.infer<typeof profileSchema>;
export function validatePlowfBuyer(profile: PlowfProfile, customer: any, keyId: string) {
  if (profile.mode !== "marketplace") return;
  if (!keyId.startsWith("product:")) throw new ApiError(422, "plowf_products_required", "No modo PSP/marketplace, use o checkout de um produto cadastrado para enviar os itens da venda.");
  const buyer = z.object({ name: z.string().trim().min(3), email: z.string().email(), cpf: z.string().refine(v => validSellerDocument(v.replace(/\D/g, ""))), phone: z.string().regex(/^\d{10,11}$/) });
  if (!buyer.safeParse(customer).success) throw new ApiError(422, "plowf_buyer_required", "Informe nome, e-mail, CPF/CNPJ e telefone completos do comprador.");
}
export async function plowfProfile(id: string): Promise<PlowfProfile> {
  const stored = await setting("plowf_profile:" + id);
  return stored ? decodePlowfProfile(stored) : { mode: "own" };
}
export function decodePlowfProfile(value: string | null): PlowfProfile {
  // Existing charges retain their original own-sale request shape.
  return value ? profileSchema.parse(JSON.parse(unseal(value, env.APP_ENCRYPTION_KEY || ""))) : { mode: "own" };
}
export async function snapshotPlowfProfile(id: string) {
  return seal(JSON.stringify(await plowfProfile(id)), env.APP_ENCRYPTION_KEY || "");
}
export async function plowfProfileSummary(id: string | null) {
  const p = id ? await plowfProfile(id) : { mode: "own" as const };
  return { mode: p.mode, document_last4: p.mode === "marketplace" ? p.beneficiary.document.slice(-4) : null };
}
export async function savePlowfProfile(input: unknown, actor: string) {
  const body = z.object({ connection_id: z.string().regex(/^gw_[A-Za-z0-9_-]{43}$/), mode: z.enum(["own", "marketplace"]), document: z.string().trim().max(30).optional(), name: z.string().trim().max(120).optional() }).strict().parse(input);
  if (body.connection_id !== await setting("plowf_connection")) throw new ApiError(409, "gateway_changed", "A conexão mudou. Atualize a página antes de salvar.");
  const previous = await plowfProfile(body.connection_id);
  const profile = profileSchema.parse(body.mode === "own" ? { mode: "own" } : {
    mode: "marketplace", beneficiary: {
      document: body.document || (previous.mode === "marketplace" ? previous.beneficiary.document : ""),
      ...(body.name ? { name: body.name } : {}),
    },
  });
  // Only the sales profile changes. API credentials and webhook URL stay intact.
  const saved = await db().prepare("INSERT INTO settings(id,value,updated_at) SELECT ?,?,? WHERE (SELECT value FROM settings WHERE id='plowf_connection')=? ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at RETURNING id")
    .bind("plowf_profile:" + body.connection_id, seal(JSON.stringify(profile), env.APP_ENCRYPTION_KEY || ""), now(), body.connection_id).first();
  if (!saved) throw new ApiError(409, "gateway_changed", "A conexão mudou. Atualize a página antes de salvar.");
  await audit(actor, "gateway.sales_profile_saved", body.connection_id);
  return { saved: true, ...await plowfProfileSummary(body.connection_id) };
}
