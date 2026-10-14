import { z } from "zod";
import { trackerOrderEnqueue } from "./trackerorder";
import { env, setting, db, now } from "./core";
import { ApiError, unseal, seal, randomToken, hash } from "./security";
import { safeTrackTransaction } from "./tiktok";
import { createPlowf, readPlowf, findPlowf, plowfConnection } from "./plowf";
import { snapshotPlowfProfile, decodePlowfProfile, validatePlowfBuyer } from "./plowf-profile";
import { createBravo, readBravo, findBravo, bravoConnection } from "./bravopay";
const ProviderTransaction = z.object({
  id: z.string().min(1),
  status: z.enum([
    "PENDING",
    "PAID",
    "EXPIRED",
    "FAILED",
    "REFUNDED",
    "CHARGEBACK",
  ]),
  amount_cents: z.number().int().nonnegative(),
  fee_cents: z.number().int().nonnegative().optional(),
  net_cents: z.number().int().optional(),
  pix_status: z.string().optional(),
  pix: z
    .object({
      copy_paste: z.string().nullable().optional(),
      expires_at: z.string().nullable().optional(),
    })
    .optional(),
  external_reference: z.string().nullable().optional(),
  paid_at: z.string().nullable().optional(),
});
export async function provider(
  path: string,
  options: RequestInit = {},
  tokenOverride?: string,
) {
  let token = tokenOverride;
  if (!token) {
    const encrypted = await setting("provider_token");
    if (!encrypted)
      throw new ApiError(
        503,
        "provider_not_configured",
        "Conecte a PagPixHub em Desenvolvedor.",
      );
    token = unseal(encrypted, env.APP_ENCRYPTION_KEY || "");
  }
  let response: Response;
  try {
    response = await fetch("https://pagpixhub.com/api/v1" + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      503,
      "provider_unavailable",
      "O processador não respondeu. Consulte a cobrança antes de tentar novamente.",
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status === 401 ? 503 : 502,
      "provider_error",
      response.status === 401
        ? "A credencial da PagPixHub foi recusada."
        : "O processador recusou a solicitação. Consulte a cobrança antes de repetir.",
    );
  try {
    return { status: response.status, data: (await response.json()) as any };
  } catch {
    throw new ApiError(
      502,
      "invalid_provider_response",
      "Resposta inválida do processador.",
    );
  }
}
export const ChargeInput = z
  .object({
    amount_cents: z.number().int().min(500).max(100000000),
    description: z.string().trim().min(1).max(300),
    external_reference: z.string().trim().min(1).max(120),
    customer: z
      .object({
        name: z.string().trim().max(120).optional(),
        email: z.string().email().max(254).optional(),
        cpf: z
          .string()
          .regex(/^[\d.\/-]{11,18}$/)
          .optional(),
        phone: z.string().max(30).optional(),
      })
      .strict()
      .default({}),
    expires_in: z.number().int().min(60).max(86400).default(3600),
    utm: z
      .object({
        source: z.string().max(250).optional(),
        medium: z.string().max(250).optional(),
        campaign: z.string().max(250).optional(),
        content: z.string().max(250).optional(),
        term: z.string().max(250).optional(),
        fbclid: z.string().max(500).optional(),
        gclid: z.string().max(500).optional(),
        ttclid: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export function serialize(tx: any) {
  return {
    id: tx.id,
    ...(tx.trackerorder_code ? { tracking_code: tx.trackerorder_code } : {}),
    gateway: tx.gateway || "pagpixhub",
    net_is_estimate: tx.gateway === "plowf",
    external_reference: tx.external_reference,
    amount_cents: tx.amount,
    fee_cents: tx.fee,
    net_cents: tx.net,
    status: tx.status,
    pix_status: tx.pix_status,
    description: tx.description,
    pix: { copy_paste: tx.copy_paste, expires_at: tx.expires_at },
    created_at: new Date(tx.created_at).toISOString(),
    paid_at: tx.paid_at ? new Date(tx.paid_at).toISOString() : null,
  };
}
export async function applyProvider(tx: any, input: unknown) {
  const p = ProviderTransaction.parse(input);
  if (
    (tx.provider_id && p.id !== tx.provider_id) ||
    p.amount_cents !== tx.amount
  )
    throw new ApiError(
      409,
      "provider_mismatch",
      "O valor retornado pelo processador não corresponde à cobrança.",
    );
  const paidAt = p.paid_at
    ? Date.parse(p.paid_at)
    : p.status === "PAID"
      ? now()
      : null;
  if (paidAt !== null && !Number.isFinite(paidAt))
    throw new ApiError(
      502,
      "invalid_provider_response",
      "Data inválida no processador.",
    );
  const eventId = "evt_" + hash(tx.id + ":" + p.status);
  const eventType =
    "transaction." +
    {
      PENDING: "created",
      PAID: "paid",
      EXPIRED: "expired",
      FAILED: "failed",
      REFUNDED: "refunded",
      CHARGEBACK: "chargeback",
    }[p.status];
  await db().batch([
    // Enqueue after the status update below so only confirmed payments qualify.
    db().prepare("UPDATE transactions SET pix_generated_at=COALESCE(pix_generated_at,?) WHERE id=? AND ? IS NOT NULL").bind(now(), tx.id, p.pix?.copy_paste || null),
    db()
      .prepare(
        `UPDATE transactions SET provider_id=?,status=CASE WHEN status IN ('REFUNDED','CHARGEBACK') THEN status WHEN status='PAID' AND ? NOT IN ('REFUNDED','CHARGEBACK') THEN status ELSE ? END,pix_status=?,copy_paste=COALESCE(?,copy_paste),expires_at=COALESCE(?,expires_at),fee=COALESCE(?,fee),net=COALESCE(?,net),paid_at=COALESCE(paid_at,?),updated_at=?,lease_until=0 WHERE id=? AND NOT (status IN ('REFUNDED','CHARGEBACK') AND status<>?) AND NOT (status='PAID' AND ? NOT IN ('PAID','REFUNDED','CHARGEBACK'))`,
      )
      .bind(
        p.id,
        p.status,
        p.status,
        p.pix_status || p.status.toLowerCase(),
        p.pix?.copy_paste || null,
        p.pix?.expires_at || null,
        p.fee_cents ?? null,
        p.net_cents ?? null,
        paidAt,
        now(),
        tx.id,
        p.status,
        p.status,
      ),
    db()
      .prepare(
        `INSERT OR IGNORE INTO deliveries (id,key_id,transaction_id,payload,attempts,next_at,lease_until) SELECT ?,t.key_id,t.id,json_object('id',?,'type',?,'created',?,'data',json_object('id',t.id,'external_reference',t.external_reference,'amount_cents',t.amount,'status',t.status,'fee_cents',t.fee,'net_cents',t.net)),0,?,0 FROM transactions t JOIN api_keys k ON k.id=t.key_id WHERE t.id=? AND t.status=? AND k.callback IS NOT NULL AND k.revoked_at IS NULL`,
      )
      .bind(
        eventId,
        eventId,
        eventType,
        Math.floor(now() / 1000),
        now(),
        tx.id,
        p.status,
      ),
    db().prepare("INSERT OR IGNORE INTO push_events(id,transaction_id,event,created_at) SELECT 'pending:'||t.id,t.id,'PENDING',t.created_at FROM transactions t JOIN settings s ON s.id='push_started_at' WHERE t.id=? AND t.status='PENDING' AND t.copy_paste IS NOT NULL AND t.created_at>=CAST(s.value AS INTEGER)").bind(tx.id),
    db().prepare("INSERT OR IGNORE INTO push_events(id,transaction_id,event,created_at) SELECT 'paid:'||t.id,t.id,'PAID',t.paid_at FROM transactions t JOIN settings s ON s.id='push_started_at' WHERE t.id=? AND t.status='PAID' AND t.paid_at>=CAST(s.value AS INTEGER)").bind(tx.id),
    trackerOrderEnqueue(tx.id),
  ]);
  const updated = await db()
    .prepare("SELECT * FROM transactions WHERE id=?")
    .bind(tx.id)
    .first<any>();
  await safeTrackTransaction(updated);
  return updated;
}
export async function sync(tx: any) {
  if (!tx.provider_id) return tx;
  if (tx.gateway === "plowf") return applyProvider(tx, await readPlowf(tx));
  if (tx.gateway === "bravopay") return applyProvider(tx, await readBravo(tx));
  const result = await provider(
    "/transactions/" + encodeURIComponent(tx.provider_id),
  );
  return applyProvider(tx, result.data);
}
export async function reconcileCharge(tx: any) {
  if (tx.provider_id) return sync(tx);
  if (tx.gateway === "plowf") {
    const found = await findPlowf(tx);
    if (found) return applyProvider(tx, found);
  } else if (tx.gateway === "bravopay") {
    const found = await findBravo(tx);
    if (found) return applyProvider(tx, found);
  } else {
    const found = await provider("/transactions?external_reference=" + encodeURIComponent(tx.id));
    if (Array.isArray(found.data.data) && found.data.data.length === 1) {
      if (found.data.data[0].external_reference !== tx.id) throw new ApiError(409, "reference_mismatch", "Referência divergente.");
      return applyProvider(tx, found.data.data[0]);
    }
  }
  await db().prepare("UPDATE transactions SET updated_at=? WHERE id=?").bind(now(), tx.id).run();
  return tx;
}
export async function refreshCheckout(tx: any) {
  if (!(tx.provider_id || (["plowf", "bravopay"].includes(tx.gateway) && tx.gateway_sent_at)) || !["PENDING", "CREATING"].includes(tx.status) || now() - tx.updated_at < 5000) return tx;
  const lease = now() + 30000;
  // Multiple tabs share a refresh lease, so faster screen polling cannot multiply provider calls.
  const claim = await db().prepare("UPDATE transactions SET lease_until=? WHERE id=? AND status IN ('PENDING','CREATING') AND updated_at<=? AND lease_until<? RETURNING id")
    .bind(lease, tx.id, now() - 5000, now()).first();
  if (!claim) return await db().prepare("SELECT * FROM transactions WHERE id=?").bind(tx.id).first<any>() || tx;
  try { return await reconcileCharge(tx); }
  catch { return await db().prepare("SELECT * FROM transactions WHERE id=?").bind(tx.id).first<any>() || tx; }
  finally {
    // Also throttle failed lookups; their last known financial state stays unchanged.
    await db().prepare("UPDATE transactions SET lease_until=0,updated_at=? WHERE id=? AND lease_until=?").bind(now(), tx.id, lease).run();
  }
}
export async function processGatewayEvents(preferredEvent?: string, onProcessed?: () => Promise<void>) {
  const events = await db().prepare("SELECT * FROM gateway_events WHERE processed_at IS NULL AND next_at<=? AND lease_until<? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,received_at LIMIT 3").bind(now(), now(), preferredEvent || "").all<any>();
  await Promise.all(events.results.map(async event => {
    const lease = now() + 60000;
    const claim = await db().prepare("UPDATE gateway_events SET lease_until=? WHERE id=? AND processed_at IS NULL AND lease_until<?").bind(lease, event.id, now()).run();
    if (!claim.meta.changes) return;
    try {
      const gateway = event.id.startsWith("bravopay:") ? "bravopay" : "plowf";
      const tx = await db().prepare("SELECT * FROM transactions WHERE gateway=? AND gateway_connection=? AND (provider_id=? OR id=?) LIMIT 1").bind(gateway, event.connection_id, gateway + ":" + event.provider_id, event.external_reference).first<any>();
      if (tx) await applyProvider(tx, gateway === "bravopay" ? await readBravo(tx, event.provider_id) : await readPlowf(tx, event.provider_id));
      await db().prepare("UPDATE gateway_events SET processed_at=?,lease_until=0 WHERE id=? AND lease_until=?").bind(now(), event.id, lease).run();
    } catch {
      await db().prepare("UPDATE gateway_events SET attempts=attempts+1,next_at=?,lease_until=0 WHERE id=? AND lease_until=?").bind(now() + Math.min(600000, 30000 * 2 ** Math.min(event.attempts, 5)), event.id, lease).run();
      return;
    }
    // Notify as each payment finishes, without waiting for another provider request in this batch.
    await onProcessed?.();
  }));
}
export async function createCharge(
  keyId: string,
  input: unknown,
  idempotency: string,
) {
  const data = ChargeInput.parse(input);
  if (!/^[A-Za-z0-9_:-]{8,120}$/.test(idempotency))
    throw new ApiError(
      422,
      "idempotency_required",
      "Envie Idempotency-Key com 8 a 120 caracteres.",
    );
  if (env.PUBLIC_API_ENABLED !== "true")
    throw new ApiError(
      503,
      "payments_disabled",
      "Recebimentos reais aguardam a liberação do endereço público e dos webhooks.",
    );
  const existing = await db().prepare("SELECT * FROM transactions WHERE key_id=? AND idempotency_key=?").bind(keyId, idempotency).first<any>();
  const selection = existing ? { gateway: existing.gateway, connection: existing.gateway_connection } : await db().prepare("SELECT gateway,(SELECT value FROM settings WHERE id=gateway||'_active_connection') AS connection FROM (SELECT COALESCE((SELECT value FROM settings WHERE id='active_gateway'),'pagpixhub') AS gateway)").first<any>();
  if (!existing && selection.gateway === "none") throw new ApiError(503, "gateway_disabled", "Os pagamentos estão temporariamente indisponíveis. Tente novamente mais tarde.");
  if (!["pagpixhub", "plowf", "bravopay"].includes(selection.gateway)) throw new ApiError(503, "gateway_invalid", "Gateway ativo inválido.");
  if (!existing && selection.gateway === "plowf") await plowfConnection(selection.connection || "");
  if (!existing && selection.gateway === "bravopay") {
    if (!(await bravoConnection(selection.connection || "")).webhook) throw new ApiError(503, "gateway_missing", "Configure o webhook BravoPay.");
    if (data.amount_cents > 50000000) throw new ApiError(422, "bravopay_amount", "O valor excede o limite por cobrança da BravoPay.");
  }
  if (!existing && selection.gateway === "pagpixhub" && !(await setting("provider_token")))
    throw new ApiError(
      503,
      "provider_not_configured",
      "A chave da PagPixHub ainda não foi salva no gateway. Configure em Desenvolvedor.",
    );
  if (!existing && selection.gateway === "pagpixhub" && !(await setting("provider_webhook")))
    throw new ApiError(
      503,
      "provider_not_configured",
      "O segredo do webhook da PagPixHub ainda não foi salvo no gateway. Configure em Desenvolvedor.",
    );
  const plowfProfile = existing?.plowf_profile ?? (!existing && selection.gateway === "plowf" ? await snapshotPlowfProfile(selection.connection) : null);
  if (!existing && selection.gateway === "plowf") validatePlowfBuyer(decodePlowfProfile(plowfProfile), data.customer, keyId);
  const id = randomToken("tx_"),
    checkout = randomToken("co_"),
    requestHash = hash(JSON.stringify(data));
  await db()
    .prepare(
      `INSERT OR IGNORE INTO transactions (id,key_id,idempotency_key,request_hash,external_reference,amount,status,description,customer,checkout_hash,checkout_token,created_at,updated_at,lease_until,gateway,gateway_connection,plowf_profile) VALUES (?,?,?,?,?,?,'CREATING',?,?,?,?,?,?,0,?,?,?)`,
    )
    .bind(
      id,
      keyId,
      idempotency,
      requestHash,
      data.external_reference,
      data.amount_cents,
      data.description,
      seal(JSON.stringify(data.customer), env.APP_ENCRYPTION_KEY || ""),
      hash(checkout),
      seal(checkout, env.APP_ENCRYPTION_KEY || ""),
      now(),
      now(),
      selection.gateway,
      ["plowf", "bravopay"].includes(selection.gateway) ? selection.connection : null,
      plowfProfile,
    )
    .run();
  let tx = await db()
    .prepare("SELECT * FROM transactions WHERE key_id=? AND idempotency_key=?")
    .bind(keyId, idempotency)
    .first<any>();
  if (!tx)
    throw new ApiError(
      500,
      "reservation_failed",
      "Não foi possível reservar a cobrança.",
    );
  if (tx.request_hash !== requestHash)
    throw new ApiError(
      409,
      "idempotency_conflict",
      "Esta chave já foi usada com outros dados.",
    );
  if (tx.provider_id) return withCheckout(tx);
  if (tx.gateway === "plowf" && tx.gateway_sent_at) {
    if (tx.status === "FAILED") return withCheckout(tx);
    try { tx = await reconcileCharge(tx); } catch { /* The original outbound attempt is never repeated. */ }
    return withCheckout(tx);
  }
  if (now() - tx.created_at > 23 * 3600000)
    throw new ApiError(
      409,
      "reconciliation_required",
      "Esta cobrança precisa de conciliação manual antes de ser reenviada.",
    );
  const lease = now() + 30000;
  const claimed = await db()
    .prepare(
      "UPDATE transactions SET lease_until=? WHERE id=? AND lease_until<? AND provider_id IS NULL RETURNING id",
    )
    .bind(lease, tx.id, now())
    .first();
  if (!claimed)
    throw new ApiError(
      409,
      "creation_in_progress",
      "Cobrança em processamento. Repita a mesma solicitação em alguns segundos.",
    );
  try {
    if (tx.gateway === "bravopay") {
      tx = await applyProvider(tx, await createBravo(tx, data));
      return withCheckout(tx);
    }
    if (tx.gateway === "plowf") {
      const result = await createPlowf(tx, data.customer);
      if (result) tx = await applyProvider(tx, result);
      else tx = await reconcileCharge(tx);
      return withCheckout(tx);
    }
    const result = await provider("/transactions", {
      method: "POST",
      headers: { "Idempotency-Key": tx.id },
      body: JSON.stringify({
        ...data,
        method: "pix",
        external_reference: tx.id,
      }),
    });
    tx = await applyProvider(tx, result.data);
    return withCheckout(tx);
  } finally {
    await db()
      .prepare(
        "UPDATE transactions SET lease_until=0 WHERE id=? AND lease_until=?",
      )
      .bind(tx.id, lease)
      .run();
  }
}
export function withCheckout(tx: any) {
  const token = unseal(tx.checkout_token, env.APP_ENCRYPTION_KEY || "");
  return {
    ...serialize(tx),
    checkout_url: `${env.APP_ORIGIN}/checkout/${token}`,
  };
}
