import { z } from "zod";
import { trackerOrderEnabled } from "./trackerorder";
import { normalizeBrazilPhone, validCpf } from "../buyer-fields";
import sharp from "sharp";
import { db, env, now, rateLimit, audit } from "./core";
import {
  ApiError,
  assertOrigin,
  hash,
  randomToken,
  readJson,
  seal,
  unseal,
} from "./security";
import { createCharge } from "./payments";
import { plowfRequiresBuyerName } from "./plowf";
import { checkoutShipping } from "../shipping";
import { linkCheckoutVisit } from "./analytics";
import { trackingInput, rememberOrderTracking } from "./tiktok";
import { productReviewsSchema, prepareProductReviews, readProductReviews } from "./product-reviews";
const productId = /^prd_[A-Za-z0-9_-]{43}$/;
export async function checkoutRequiresBuyerName(orderId?: string) {
  // Existing attempts remain tied to their original processor, even after a gateway switch.
  const existing = orderId ? await db().prepare("SELECT gateway,gateway_connection,plowf_profile FROM transactions WHERE idempotency_key=? AND key_id LIKE 'product:%'").bind(orderId).first<any>() : null;
  if (!existing && await trackerOrderEnabled()) return true;
  const selected = existing || await db().prepare("SELECT (SELECT value FROM settings WHERE id='active_gateway') AS gateway,(SELECT value FROM settings WHERE id='plowf_active_connection') AS gateway_connection").first<any>();
  return selected?.gateway === "plowf" && await plowfRequiresBuyerName(selected.gateway_connection, existing ? existing.plowf_profile : undefined);
}
export async function checkoutProduct(p: any) {
  return { ...publicProduct(p), requires_buyer_name: p.product_type !== "digital" || await checkoutRequiresBuyerName() };
}
export async function findProduct(id: string, publicOnly = true) {
  if (!productId.test(id))
    throw new ApiError(404, "not_found", "Produto não encontrado.");
  const p = await db()
    .prepare("SELECT * FROM products WHERE id=?")
    .bind(id)
    .first<any>();
  if (!p || (publicOnly && !p.active))
    throw new ApiError(404, "not_found", "Produto indisponível.");
  return p;
}
export function publicProduct(p: any, administrative = false) {
  return {
    id: p.id,
    name: p.name,
    product_type: p.product_type || "physical",
    description: p.description,
    amount: p.amount,
    shipping: p.shipping,
    delivery_days: p.delivery_days,
    image_url: `/api/products/${p.id}/image`,
    checkout_url: `${env.APP_ORIGIN}/comprar/${p.id}`,
    active: !!p.active,
    recovery_enabled: false,
    reviews: readProductReviews(p.reviews),
    ...(administrative ? { recovery_template: null } : {}),
    ...(administrative ? { upsell_enabled: !!p.upsell_url, upsell_url: p.upsell_url || "" } : {}),
  };
}
export async function saveProduct(
  request: Request,
  actor: string,
  id?: string,
) {
  const body = z
    .object({
      name: z.string().trim().min(2).max(150),
      description: z.string().trim().max(2000),
      amount: z.number().int().min(500).max(100000000),
      shipping: z.number().int().min(0).max(1000000),
      delivery_days: z.string().trim().min(1).max(100),
      active: z.boolean(),
      product_type: z.enum(["physical", "digital"]).optional(),
      upsell_enabled: z.boolean().optional(),
      recovery_enabled: z.boolean().optional(),
      recovery_template_id: z.string().max(200).optional(),
      upsell_url: z.string().trim().max(2048).optional(),
      image: z.string().max(1400000).optional(),
      reviews: productReviewsSchema.optional(),
    })
    .strict()
    .parse(await readJson(request, 2400000));
  const old = id ? await findProduct(id, false) : null;
  const reviews = body.reviews === undefined ? readProductReviews(old?.reviews) : await prepareProductReviews(body.reviews, readProductReviews(old?.reviews));
  const productType = body.product_type ?? old?.product_type ?? "physical";
  if (body.recovery_enabled) throw new ApiError(410, "recovery_removed", "Recuperacao por WhatsApp removida.");
  const recoveryTemplate = null;
  if (body.amount + (productType === "digital" ? 0 : body.shipping) > 100000000)
    throw new ApiError(422, "amount_invalid", "Valor total acima do limite.");
  let upsellUrl = old?.upsell_url || null;
  if (body.upsell_enabled !== undefined) {
    upsellUrl = body.upsell_enabled ? validUpsellUrl(body.upsell_url || "") : null;
  }
  let image = old?.image;
  if (body.image) {
    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
      body.image,
    );
    if (!m)
      throw new ApiError(
        422,
        "image_invalid",
        "Envie uma foto JPG, PNG ou WebP.",
      );
    try {
      const bytes = Buffer.from(m[1], "base64");
      const output = await sharp(bytes, {
        limitInputPixels: 16000000,
        animated: false,
      })
        .rotate()
        .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      if (output.length > 700000) throw new Error("large");
      image = output.toString("base64");
    } catch {
      throw new ApiError(
        422,
        "image_invalid",
        "Foto inválida ou muito grande. Escolha uma imagem menor.",
      );
    }
  }
  if (!image)
    throw new ApiError(422, "image_required", "Adicione uma foto do produto.");
  const pid = id || randomToken("prd_");
  await db()
    .prepare(
      "INSERT INTO products(id,name,description,amount,image,shipping,delivery_days,active,created_at,updated_at,upsell_url,product_type,recovery_template,reviews) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,amount=excluded.amount,image=excluded.image,shipping=excluded.shipping,delivery_days=excluded.delivery_days,active=excluded.active,updated_at=excluded.updated_at,upsell_url=excluded.upsell_url,product_type=excluded.product_type,recovery_template=excluded.recovery_template,reviews=excluded.reviews",
    )
    .bind(
      pid,
      body.name,
      body.description,
      body.amount,
      image,
      productType === "digital" ? 0 : body.shipping,
      body.delivery_days,
      body.active ? 1 : 0,
      old?.created_at || now(),
      now(),
      upsellUrl,
      productType,
      recoveryTemplate,
      JSON.stringify(reviews),
    )
    .run();
  await audit(actor, old ? "product.updated" : "product.created", pid);
  return publicProduct(await findProduct(pid, false), true);
}
const buyerSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    email: z.string().email().max(254),
    cpf: z.string().regex(/^\d{11}$/).refine(validCpf, "Informe um CPF válido."),
    phone: z.string().max(30).regex(/^[+\d\s().-]+$/).transform(normalizeBrazilPhone).pipe(z.string().regex(/^\d{10,11}$/)),
    address: z
      .object({
        cep: z.string().regex(/^\d{8}$/),
        street: z.string().trim().min(2).max(180),
        number: z.string().trim().min(1).max(20),
        complement: z.string().trim().max(100),
        district: z.string().trim().min(2).max(100),
        city: z.string().trim().min(2).max(100),
        state: z
          .string()
          .regex(
            /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/,
          ),
      })
      .strict(),
  })
  .strict();
export async function buyProduct(request: Request, id: string) {
  assertOrigin(request, env.APP_ORIGIN || "");
  if (env.PUBLIC_API_ENABLED !== "true")
    throw new ApiError(
      503,
      "payments_disabled",
      "A loja ainda não liberou os pagamentos.",
    );
  await rateLimit("product-buy-global", 120);
  const p = await findProduct(id);
  const raw = await readJson(request, 12000);
  const attempt = z.string().uuid().parse((raw as any)?.attempt);
  const orderId = "ord_" + hash(id + ":" + attempt);
  const existing = await db().prepare("SELECT snapshot FROM product_orders WHERE id=?").bind(orderId).first<any>();
  const productType = existing ? JSON.parse(existing.snapshot).product_type || "physical" : p.product_type || "physical";
  const digital = productType === "digital";
  const requiresName = digital && await checkoutRequiresBuyerName(orderId);
  if (requiresName && !buyerSchema.shape.name.safeParse((raw as any)?.buyer?.name).success) throw new ApiError(422, "buyer_name_required", "Informe seu nome completo para gerar o Pix.");
  const schema = digital ? buyerSchema.omit({ address: true }).extend({ name: requiresName ? buyerSchema.shape.name : buyerSchema.shape.name.optional() }) : buyerSchema;
  const body = z
    .object({ attempt: z.string().uuid(), quantity: z.number().int().min(1).max(99).default(1), buyer: schema, shipping_method: z.enum(["flex", "full"]).optional(), tracking: trackingInput.optional(), recovery_consent: z.boolean().optional() })
    .strict()
    .parse(raw);
  await rateLimit(
    "product-buy:" + hash(body.buyer.email.toLowerCase()),
    10,
    15 * 60000,
  );

  // Preserve the legacy hash for one-unit retries created before quantity support.
  const requestData = body.shipping_method ? { buyer: body.buyer, shipping_method: body.shipping_method } : body.buyer;
  const requestHash = hash(JSON.stringify(body.quantity === 1 ? requestData : { ...requestData, quantity: body.quantity }));
  // Keep original price and shipping even if the seller edits the catalog during a retry.
  const shipping = checkoutShipping.find(option => option.id === body.shipping_method);
  const snapshot = { product_type: productType, name: p.name, amount: p.amount, quantity: body.quantity, shipping: digital ? 0 : shipping?.amount ?? p.shipping, shipping_method: digital ? undefined : shipping?.id, delivery_days: digital ? undefined : shipping?.days, upsell_url: p.upsell_url || null, expires_in: 1800 };
  const pricing = existing ? JSON.parse(existing.snapshot) : snapshot;
  const total = pricing.amount * (pricing.quantity ?? 1) + pricing.shipping;
  if (!Number.isSafeInteger(total) || total > 100000000)
    throw new ApiError(422, "amount_invalid", "O total excede o limite por pedido. Reduza a quantidade.");
  const inserted = await db()
    .prepare(
      "INSERT OR IGNORE INTO product_orders(id,product_id,request_hash,snapshot,buyer,created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      orderId,
      id,
      requestHash,
      JSON.stringify(snapshot),
      seal(JSON.stringify(body.buyer), env.APP_ENCRYPTION_KEY || ""),
      now(),
    )
    .run();
  const order = await db()
    .prepare("SELECT * FROM product_orders WHERE id=?")
    .bind(orderId)
    .first<any>();
  if (!order || order.request_hash !== requestHash)
    throw new ApiError(
      409,
      "order_conflict",
      "Esta tentativa já foi usada com outros dados. Retome os dados originais do pedido.",
    );
  const frozen = JSON.parse(order.snapshot);

  if (body.tracking) {
    try { await linkCheckoutVisit(id, body.tracking.visit, orderId); }
    catch { console.error("Checkout analytics unavailable; payment preserved"); }
  }
  if (inserted.meta.changes && body.tracking) {
    try { await rememberOrderTracking(request, orderId, id, body.tracking, body.buyer, frozen.quantity ?? 1); }
    catch { console.error("TikTok attribution unavailable; checkout preserved"); }
  }
  const customer = { email: body.buyer.email, cpf: body.buyer.cpf, phone: body.buyer.phone, ...("name" in body.buyer ? { name: body.buyer.name } : {}) };
  const tx = await createCharge(
    "product:" + id,
    {
      amount_cents: frozen.amount * (frozen.quantity ?? 1) + frozen.shipping,
      description: (frozen.quantity ?? 1) > 1 ? `${frozen.name} (${frozen.quantity} unidades)` : frozen.name,
      external_reference: orderId,
      customer,
      expires_in: frozen.expires_in ?? 3600,
    },
    orderId,
  );
  return {
    ...tx,
    product: {
      name: frozen.name,
      amount: frozen.amount,
      quantity: frozen.quantity ?? 1,
      shipping: frozen.shipping,
    },
  };
}
export async function productOrders() {
  const rows = await db()
    .prepare(
      "SELECT o.*, t.id AS transaction_id,t.status,t.amount FROM product_orders o LEFT JOIN transactions t ON t.idempotency_key=o.id AND t.key_id='product:'||o.product_id ORDER BY o.created_at DESC LIMIT 100",
    )
    .all<any>();
  return rows.results.map((o) => ({
    id: o.id,
    product_id: o.product_id,
    product: JSON.parse(o.snapshot),
    buyer: JSON.parse(unseal(o.buyer, env.APP_ENCRYPTION_KEY || "")),
    created_at: o.created_at,
    transaction_id: o.transaction_id,
    status: o.status || "CREATING",
    amount: o.amount,
  }));
}

export function validUpsellUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || url.hostname.endsWith(".localhost")) throw Error();
    return url.href;
  } catch { throw new ApiError(422, "upsell_url_invalid", "Informe um link HTTPS válido para o upsell."); }
}
export function checkoutOrderDetails(snapshot: string | null, tx: any) {
  if (!snapshot) return { product: null, redirect_url: null };
  const { upsell_url, recovery, ...product } = JSON.parse(snapshot);
  let redirect_url = null;
  if (tx.status === "PAID" && tx.paid_at && tx.provider_id && upsell_url) {
    try { redirect_url = validUpsellUrl(upsell_url); } catch { /* Invalid legacy destination must never block the receipt. */ }
  }
  return { product: { ...product, quantity: product.quantity ?? 1 }, redirect_url };
}
