import { ptOverview } from "@/lib/server/portugal";
import {
  findProduct,
  publicProduct,
  checkoutProduct,
  saveProduct,
  buyProduct,
  productOrders,
  checkoutOrderDetails,
} from "@/lib/server/products";
import { after } from "next/server";
import { createStoreOrder, getStoreOrder, receiveStoreEvent, settleStoreOrders, dispatchStoreTracker, adminStoreOrders } from '@/lib/server/store-orders';
import { trackerOrderBackground, trackerOrderOverview, saveTrackerOrder } from "@/lib/server/trackerorder";
import { savePlowfProfile } from "@/lib/server/plowf-profile";
import { panelNotifications } from "@/lib/server/panel-notifications";
import { savePlowf, activateGateway, gatewayOverview, receivePlowfWebhook } from "@/lib/server/plowf";
import { saveBravo, receiveBravoWebhook } from "@/lib/server/bravopay";
import { broskiOverview, saveBroskiNotifications, receiveBroskiWebhook } from "@/lib/server/broski";
import { checkoutPresence, analyticsOverview } from "@/lib/server/analytics";
import { z } from "zod";
import {
  admin,
  allowedEmails,
  apiClient,
  audit,
  db,
  env,
  json,
  now,
  putSetting,
  rateLimit,
  route,
  setting,
} from "@/lib/server/core";
import {
  ApiError,
  encryptionKeyStatus,
  equal,
  hash,
  randomToken,
  readBody,
  readJson,
  safeCallback,
  seal,
  unseal,
  verify,
} from "@/lib/server/security";
import {
  applyProvider,
  createCharge,
  provider,
  serialize,
  sync,
  withCheckout,
  reconcileCharge,
  refreshCheckout,
  processGatewayEvents,
} from "@/lib/server/payments";
import { dispatch } from "@/lib/server/delivery";
import { startCheckoutTracking, trackingBackground, saveTrackingPixel, trackingOverview } from "@/lib/server/tiktok";
import { pushBackground, pushConfiguration, savePushSubscription, revokePushSubscription, pushSubscriptionStatus, testPush } from "@/lib/server/push";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
async function backgroundJobs(preferredEvent?: string) {
  await Promise.all([
    processGatewayEvents(preferredEvent, pushBackground).catch(() => { console.error("Gateway event processing unavailable; queued events retained"); }),
    pushBackground(),
    trackingBackground(),
  ]);
  await trackerOrderBackground();
  try { await settleStoreOrders(); await dispatchStoreTracker(); }
  catch { console.error('Store jobs retained for retry'); }
}
async function handle(request: Request) {
  return route(async () => {
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/api\//, ""),
      method = request.method;
    if (path.startsWith('v1/') || path.startsWith('webhooks/') || path.startsWith('checkout/') || path === 'admin/provider' || path === 'admin/balance' || path === 'admin/transactions' && method === 'POST' || path.startsWith('admin/gateways') || path === 'internal/dispatch' || /^products\/[^/]+\/order$/.test(path)) throw new ApiError(410, 'portugal_only', 'Utilize o checkout Portugal e a integração Broski em /api/pt.');
    if (path === "internal/recovery" && method === "POST") {
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      if (!env.DISPATCH_SECRET || !equal(token, env.DISPATCH_SECRET)) throw new ApiError(401, "unauthorized", "Credencial inválida.");
      return json({ error: { code: "recovery_removed", message: "Recuperacao por WhatsApp removida." } }, 410);
    }
    if (path === "tracking/presence" && method === "POST") {
      await checkoutPresence(request);
      return json({ received: true });
    }
    if (path === "tracking/start" && method === "POST") {
      await startCheckoutTracking(request);
      after(backgroundJobs);
      return json({ received: true });
    }
    if (path === "webhooks/broski" && method === "POST") {
      const queued = await receiveBroskiWebhook(await readBody(request), request.headers.get("Broski-Signature"));
      if (queued) after(pushBackground);
      return json({ received: true });
    }
    if (path.startsWith("webhooks/plowf/") && method === "POST") {
      const eventId = await receivePlowfWebhook(path.slice("webhooks/plowf/".length), await readBody(request), request.headers.get("X-Webhook-Signature"));
      after(() => backgroundJobs(eventId));
      return json({ received: true });
    }
    if (path.startsWith("webhooks/bravopay/") && method === "POST") {
      const eventId = await receiveBravoWebhook(path.slice("webhooks/bravopay/".length), await readBody(request), request.headers.get("BravoPay-Signature") || request.headers.get("X-Bravopay-Signature"));
      if (eventId) after(() => backgroundJobs(eventId));
      return json({ received: true });
    }
    if (path === "webhooks/pagpixhub" && method === "POST") {
      const raw = await readBody(request),
        secret = await setting("provider_webhook");
      if (
        !secret ||
        !verify(
          raw,
          request.headers.get("PagPixHub-Signature") ||
            request.headers.get("X-PagPixHub-Signature"),
          unseal(secret, env.APP_ENCRYPTION_KEY || ""),
        )
      )
        throw new ApiError(401, "invalid_signature", "Assinatura inválida.");
      after(backgroundJobs);
      const event = z
        .object({
          id: z.string().min(1).max(150),
          type: z.string().max(80),
          data: z
            .object({
              id: z.string().min(1).max(150),
              external_reference: z.string().nullable().optional(),
            })
            .passthrough(),
        })
        .parse(JSON.parse(raw));
      if (
        await db()
          .prepare("SELECT id FROM events WHERE id=?")
          .bind(event.id)
          .first()
      ) {
        after(async () => {
          try {
            await dispatch(3);
          } catch {
            console.error("Background webhook dispatch failed");
          }
        });
        return json({ received: true });
      }
      if (event.type.startsWith("transaction.")) {
        const tx = await db()
          .prepare(
            "SELECT * FROM transactions WHERE gateway='pagpixhub' AND (provider_id=? OR id=?) LIMIT 1",
          )
          .bind(event.data.id, event.data.external_reference || "")
          .first<any>();
        if (tx) {
          const result = await provider(
            "/transactions/" + encodeURIComponent(event.data.id),
          );
          if (!tx.provider_id && result.data.external_reference !== tx.id)
            throw new ApiError(
              409,
              "reference_mismatch",
              "Referência divergente.",
            );
          await applyProvider(tx, result.data);
        }
      }
      await db()
        .prepare("INSERT OR IGNORE INTO events(id,received_at) VALUES (?,?)")
        .bind(event.id, now())
        .run();
      after(async () => {
        try {
          await dispatch(3);
        } catch {
          console.error("Background webhook dispatch failed");
        }
      });
      return json({ received: true });
    }
    if (path === "internal/dispatch" && method === "POST") {
      const token =
        request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      if (!env.DISPATCH_SECRET || !equal(token, env.DISPATCH_SECRET))
        throw new ApiError(401, "unauthorized", "Credencial inválida.");
      await rateLimit("dispatcher", 5);
      const pending = await db()
        .prepare(
          "SELECT * FROM transactions WHERE status IN ('PENDING','CREATING') ORDER BY updated_at LIMIT 5",
        )
        .all<any>();
      for (const tx of pending.results) {
        try {
          await reconcileCharge(tx);
        } catch {}
      }
      const result = await dispatch(5);
      await backgroundJobs();
      await putSetting("last_dispatch", String(now()));
      return json(result);
    }
    if (path.startsWith("checkout/") && method === "GET") {
      if (env.PUBLIC_API_ENABLED !== "true")
        throw new ApiError(
          503,
          "checkout_disabled",
          "Recebimentos ainda não habilitados.",
        );
      const token = path.slice(9);
      if (!/^co_[A-Za-z0-9_-]{43}$/.test(token))
        throw new ApiError(404, "not_found", "Cobrança não encontrada.");
      await rateLimit("checkout:" + hash(token), 60);
      let tx = await db()
        .prepare("SELECT * FROM transactions WHERE checkout_hash=?")
        .bind(hash(token))
        .first<any>();
      if (!tx) throw new ApiError(404, "not_found", "Cobrança não encontrada.");
      after(backgroundJobs);
      tx = await refreshCheckout(tx);
      const productOrder = await db()
        .prepare(
          "SELECT snapshot FROM product_orders WHERE id=? AND product_id=?",
        )
        .bind(tx.idempotency_key, String(tx.key_id).replace(/^product:/, ""))
        .first<{ snapshot: string }>();
      return json({
        ...checkoutOrderDetails(productOrder?.snapshot || null, tx),
        id: tx.id,
        status: tx.status,
        ...(tx.status === "PAID" && tx.trackerorder_code ? { tracking_code: tx.trackerorder_code } : {}),
        pix_status: tx.pix_status,
        amount_cents: tx.amount,
        description: tx.description,
        pix: { copy_paste: tx.copy_paste, expires_at: tx.expires_at },
      });
    }
    if (path.startsWith("products/")) {
      const parts = path.split("/");
      if (parts.length === 3 && parts[2] === "order" && method === "POST") {
        const order = await buyProduct(request, parts[1]);
        after(backgroundJobs);
        return json(order, order.pix.copy_paste ? 201 : 202);
      }
      if (
        method === "GET" &&
        (parts.length === 2 || (parts.length === 3 && parts[2] === "image"))
      ) {
        const p = await findProduct(parts[1]);
        if (parts[2] === "image")
          return new Response(Buffer.from(p.image, "base64"), {
            headers: {
              "Content-Type": "image/jpeg",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "no-store",
            },
          });
        return json(await checkoutProduct(p));
      }
      throw new ApiError(404, "not_found", "Endpoint não encontrado.");
    }
    if (path.startsWith("v1/")) {
      const key = await apiClient(request);
      if (path === 'v1/store-orders' && method === 'POST') {
        const result = await createStoreOrder(key.id, request.headers.get('x-store-session') || '', await readJson(request));
        after(backgroundJobs);
        return json(result, result.pix.copy_paste ? 201 : 202);
      }
      if (path === 'v1/store-order-events' && method === 'POST') {
        const result = await receiveStoreEvent(key, await readBody(request), request.headers.get('plowf-signature') || '');
        after(backgroundJobs);
        return json(result);
      }
      if (path.startsWith('v1/store-orders/') && method === 'GET') {
        const result = await getStoreOrder(key.id, request.headers.get('x-store-session') || '', path.slice('v1/store-orders/'.length));
        after(backgroundJobs);
        return json(result);
      }
      if (path === "v1/transactions" && method === "POST") {
        const result = await createCharge(
          key.id,
          await readJson(request),
          request.headers.get("idempotency-key") || "",
        );
        after(backgroundJobs);
        return json(result, result.pix.copy_paste ? 201 : 202);
      }
      if (path === "v1/transactions" && method === "GET") {
        const limit = Math.min(
            100,
            Math.max(1, Number(url.searchParams.get("limit")) || 20),
          ),
          cursor = url.searchParams.get("cursor") || "";
        const rows = await db()
          .prepare(
            "SELECT * FROM transactions WHERE key_id=? AND (?='' OR id<?) ORDER BY id DESC LIMIT ?",
          )
          .bind(key.id, cursor, cursor, limit + 1)
          .all<any>();
        return json({
          data: rows.results.slice(0, limit).map(serialize),
          next_cursor:
            rows.results.length > limit ? rows.results[limit - 1].id : null,
        });
      }
      if (path.startsWith("v1/transactions/") && method === "GET") {
        const id = path.slice(16);
        let tx = await db()
          .prepare("SELECT * FROM transactions WHERE id=? AND key_id=?")
          .bind(id, key.id)
          .first<any>();
        if (!tx)
          throw new ApiError(404, "not_found", "Cobrança não encontrada.");
        if (tx.provider_id && now() - tx.updated_at > 15000)
          tx = await sync(tx);
        after(backgroundJobs);
        return json(withCheckout(tx));
      }
      throw new ApiError(404, "not_found", "Endpoint não encontrado.");
    }
    if (!path.startsWith("admin/"))
      throw new ApiError(404, "not_found", "Endpoint não encontrado.");
    const user = await admin(request);
    await rateLimit("admin:" + user.userId, 120);
    if (path === 'admin/store-orders' && method === 'GET') return json(await adminStoreOrders());
    if (path.startsWith('admin/store-orders/') && method === 'GET') return json(await adminStoreOrders(path.slice('admin/store-orders/'.length)));
    if (path === "admin/integrations/trackerorder" && method === "GET") return json(await trackerOrderOverview());
    if (path === "admin/integrations/trackerorder" && method === "POST") return json(await saveTrackerOrder(await readJson(request, 5000), user.email));
    if (path === "admin/gateways" && method === "GET") return json(await gatewayOverview());
    if (path === "admin/notifications/broski" && method === "GET") return json(await broskiOverview());
    if (path === "admin/notifications/broski" && method === "POST") return json(await saveBroskiNotifications(await readJson(request, 2000), user.email));
    if (path === "admin/gateways/plowf/profile" && method === "POST") return json(await savePlowfProfile(await readJson(request, 1000), user.email));
    if (path === "admin/gateways/plowf" && method === "POST") return json(await savePlowf(await readJson(request, 10000), user.email));
    if (path === "admin/gateways/bravopay" && method === "POST") return json(await saveBravo(await readJson(request, 10000), user.email));
    if (path === "admin/gateways/active" && method === "POST") return json(await activateGateway(await readJson(request, 500), user.email));
    if (path === "admin/recovery" || path.startsWith("admin/recovery/"))
      return json({ error: { code: "recovery_removed", message: "Recuperacao por WhatsApp removida." } }, 410);
    if (path === "admin/analytics" && method === "GET") {
      const [analytics, notifications] = await Promise.all([analyticsOverview(url.searchParams), panelNotifications(url.searchParams.get("notification_cursor"))]);
      return json({ ...analytics, notifications });
    }
    if (path === "admin/push" && method === "GET") return json(await pushConfiguration());
    if (path === "admin/push" && method === "POST") return json(await savePushSubscription(await readJson(request,4000),user.email));
    if (path === "admin/push" && method === "DELETE") return json(await revokePushSubscription(await readJson(request,2500),user.email));
    if (path === "admin/push/status" && method === "POST") return json(await pushSubscriptionStatus(await readJson(request,2500),user.email));
    if (path === "admin/push/test" && method === "POST") {
      await rateLimit("push-test:"+user.email,3);
      return json(await testPush(await readJson(request,2500),user.email));
    }
    if (path === "admin/tracking" && method === "GET") return json(await trackingOverview());
    if (path === "admin/tracking" && method === "POST") {
      await saveTrackingPixel(await readJson(request, 3000), user.email);
      return json({ saved: true });
    }
    if (/^admin\/products\/[^/]+\/image$/.test(path) && method === "GET") {
      const p = await findProduct(path.split("/")[2], false);
      return new Response(Buffer.from(p.image, "base64"), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (path === "admin/products" && method === "GET") {
      const rows = await db()
        .prepare(
          "SELECT id,name,description,amount,shipping,delivery_days,active,upsell_url,product_type,recovery_template FROM products ORDER BY created_at DESC LIMIT 500",
        )
        .all<any>();
      return json({ products: rows.results.map(p => publicProduct(p, true)) });
    }
    if (/^admin\/products\/[^/]+$/.test(path) && method === "GET") return json(publicProduct(await findProduct(path.split("/")[2], false), true));
    if (path === "admin/product-orders" && method === "GET")
      return json({ orders: await productOrders() });
    if (path === "admin/products" && method === "POST")
      return json(await saveProduct(request, user.email), 201);
    if (path.startsWith("admin/products/") && method === "POST")
      return json(await saveProduct(request, user.email, path.slice(15)));
    if (path === "admin/overview" && method === "GET") {
      after(async () => { await Promise.all([pushBackground(), trackerOrderBackground()]); });
      const day =
        url.searchParams.get("date") ||
        new Date().toLocaleDateString("en-CA", {
          timeZone: "Europe/Lisbon",
        });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
        throw new ApiError(422, "invalid_date", "Data inválida.");
      const start = Date.parse(day + "T00:00:00-03:00"),
        end = start + 86400000;
      if (!Number.isFinite(start))
        throw new ApiError(422, "invalid_date", "Data inválida.");
      const [
        stats,
        activity,
        txs,
        hours,
        keys,
        logs,
        deliveryRows,
        connected,
        webhookConfigured,
        lastDispatch,
        notifications,
      ] = await Promise.all([
        db()
          .prepare(
            "SELECT COUNT(*) as count,COALESCE(SUM(amount),0) as amount,COALESCE(SUM(fee),0) as fee FROM transactions WHERE status='PAID' AND paid_at>=? AND paid_at<?",
          )
          .bind(start, end)
          .first(),
        db()
          .prepare("SELECT COUNT(*) AS generated_count,COALESCE(SUM(amount),0) AS generated_amount,COALESCE(SUM(CASE WHEN status IN ('PENDING','CREATING') THEN 1 ELSE 0 END),0) AS pending_count,COALESCE(SUM(CASE WHEN status IN ('PENDING','CREATING') THEN amount ELSE 0 END),0) AS pending_amount,COALESCE(SUM(CASE WHEN status IN ('EXPIRED','FAILED','REFUNDED','CHARGEBACK') THEN 1 ELSE 0 END),0) AS ended_count FROM transactions WHERE created_at>=? AND created_at<?")
          .bind(start, end)
          .first(),
        db()
          .prepare(
            "SELECT id,external_reference,amount,status,description,created_at,paid_at,fee,net,gateway,customer,copy_paste,pix_reviewed_at,trackerorder_code FROM transactions ORDER BY created_at DESC LIMIT 100",
          )
          .all(),
        db()
          .prepare(
            "SELECT hour,SUM(amount) AS amount,SUM(generated) AS generated FROM (SELECT CAST((paid_at-?)/3600000 AS INTEGER) AS hour,amount,0 AS generated FROM transactions WHERE status='PAID' AND paid_at>=? AND paid_at<? UNION ALL SELECT CAST((created_at-?)/3600000 AS INTEGER) AS hour,0 AS amount,amount AS generated FROM transactions WHERE created_at>=? AND created_at<?) GROUP BY hour",
          )
          .bind(start, start, end, start, start, end)
          .all(),
        db()
          .prepare(
            "SELECT id,name,prefix,callback,created_at,revoked_at FROM api_keys ORDER BY created_at DESC",
          )
          .all(),
        db()
          .prepare(
            "SELECT actor,action,target,created_at FROM audit ORDER BY created_at DESC LIMIT 20",
          )
          .all(),
        db()
          .prepare(
            "SELECT id,transaction_id,attempts,last_status,delivered_at,next_at FROM deliveries ORDER BY next_at DESC LIMIT 20",
          )
          .all(),
        setting("provider_token"),
        setting("provider_webhook"),
        setting("last_dispatch"),
        panelNotifications(url.searchParams.get("notification_cursor")),
      ]);
      return json({
        user: {
          name: user.fullName || user.email.split("@")[0],
          email: user.email,
        },
        notifications,
        stats: { ...stats, ...activity },
        transactions: txs.results.map((row: any) => {
          const { customer: encryptedCustomer, ...transaction } = row;
          let customer = null;
          try {
            const buyer = JSON.parse(unseal(encryptedCustomer, env.APP_ENCRYPTION_KEY || ""));
            customer = { name: typeof buyer.name === "string" ? buyer.name : "", email: typeof buyer.email === "string" ? buyer.email : "", phone: typeof buyer.phone === "string" ? buyer.phone : "" };
          } catch { /* Unreadable historical customer data must not hide a sale. */ }
          return { ...transaction, customer };
        }),
        hours: hours.results,
        keys: keys.results,
        audit: logs.results,
        deliveries: deliveryRows.results,
        provider: {
          connected: (await ptOverview()).configured,
          webhookConfigured: (await ptOverview()).webhook_configured,
          enabled: env.PUBLIC_API_ENABLED === "true",
          encryptionReady:
            encryptionKeyStatus(env.APP_ENCRYPTION_KEY || "") === "ready",
          encryptionStatus: encryptionKeyStatus(env.APP_ENCRYPTION_KEY || ""),
          lastDispatch: lastDispatch ? Number(lastDispatch) : null,
        },
        allowedEmails: allowedEmails(),
        callbackHosts: (env.CALLBACK_HOSTS || "").split(",").filter(Boolean),
        origin: env.APP_ORIGIN || "",
        activeGateway: "broski",
      });
    }
    if (path === "admin/provider" && method === "POST") {
      const body = z
        .object({
          token: z
            .string()
            .regex(/^bp_live_[A-Za-z0-9_-]+$/)
            .max(500)
            .optional(),
          webhook_secret: z
            .string()
            .regex(/^whsec_[A-Za-z0-9_-]+$/)
            .max(500)
            .optional(),
        })
        .strict()
        .parse(await readJson(request));
      if (!body.token && !body.webhook_secret)
        throw new ApiError(422, "empty", "Informe uma credencial.");
      if (body.token) {
        const me = await provider("/me", {}, body.token);
        if (!me.data.id)
          throw new ApiError(
            502,
            "invalid_provider",
            "Não foi possível validar a conta.",
          );
        const account = await setting("provider_account");
        if (account && account !== me.data.id)
          throw new ApiError(
            409,
            "account_mismatch",
            "Use uma chave da mesma conta PagPixHub já vinculada.",
          );
        await putSetting("provider_account", String(me.data.id));
        await putSetting(
          "provider_token",
          seal(body.token, env.APP_ENCRYPTION_KEY || ""),
        );
      }
      if (body.webhook_secret)
        await putSetting(
          "provider_webhook",
          seal(body.webhook_secret, env.APP_ENCRYPTION_KEY || ""),
        );
      await audit(user.email, "provider.configured", "pagpixhub");
      return json({ saved: true });
    }
    if (path === "admin/balance" && method === "GET") {
      const result = await provider("/balance");
      return json(result.data);
    }
    if (path === "admin/keys" && method === "POST") {
      const input = z
        .object({
          name: z.string().trim().min(2).max(80),
          callback: z.string().max(2000).optional(),
        })
        .strict()
        .parse(await readJson(request));
      const callback = input.callback
        ? safeCallback(input.callback, env.CALLBACK_HOSTS || "")
        : null;
      const token = randomToken("pl_live_"),
        secret = callback ? randomToken("whsec_") : null,
        id = randomToken("key_");
      await db()
        .prepare(
          "INSERT INTO api_keys (id,name,hash,prefix,callback,webhook_secret,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          input.name,
          hash(token),
          token.slice(0, 16),
          callback,
          secret ? seal(secret, env.APP_ENCRYPTION_KEY || "") : null,
          now(),
        )
        .run();
      await audit(user.email, "key.created", id);
      return json({ id, token, webhook_secret: secret }, 201);
    }
    if (path.startsWith("admin/keys/") && method === "DELETE") {
      const id = path.slice(11);
      await db()
        .prepare("UPDATE api_keys SET revoked_at=? WHERE id=?")
        .bind(now(), id)
        .run();
      await audit(user.email, "key.revoked", id);
      return json({ revoked: true });
    }
    if (path === "admin/transactions" && method === "POST") {
      const result = await createCharge(
        "dashboard",
        await readJson(request),
        request.headers.get("idempotency-key") || "",
      );
      await audit(user.email, "charge.created", result.id);
      after(backgroundJobs);
      return json(result, result.pix.copy_paste ? 201 : 202);
    }
    if (/^admin\/transactions\/[^/]+\/pix-review$/.test(path) && method === "POST") {
      const { reviewed } = z.object({ reviewed: z.boolean() }).strict().parse(await readJson(request, 200));
      const tx = await db().prepare("UPDATE transactions SET pix_reviewed_at=CASE WHEN ? THEN COALESCE(pix_reviewed_at,?) ELSE NULL END WHERE id=? RETURNING id,pix_reviewed_at")
        .bind(reviewed ? 1 : 0, now(), path.split("/")[2]).first();
      if (!tx) throw new ApiError(404, "not_found", "Cobrança não encontrada.");
      await audit(user.email, reviewed ? "charge.pix_reviewed" : "charge.pix_review_cleared", path.split("/")[2]);
      return json(tx);
    }
    if (path.startsWith("admin/transactions/") && method === "GET") {
      let tx = await db()
        .prepare("SELECT * FROM transactions WHERE id=?")
        .bind(path.slice(19))
        .first<any>();
      if (!tx) throw new ApiError(404, "not_found", "Cobrança não encontrada.");
      if (tx.provider_id && now() - tx.updated_at > 15000) tx = await sync(tx);
      after(backgroundJobs);
      return json(withCheckout(tx));
    }
    if (path === "admin/dispatch" && method === "POST") {
      const result = await dispatch(3);
      return json(result);
    }
    throw new ApiError(404, "not_found", "Endpoint não encontrado.");
  });
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
