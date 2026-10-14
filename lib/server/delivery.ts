import { db, env, now } from "./core";
import { safeCallback, unseal, sign } from "./security";
export async function dispatch(limit = 3) {
  const due = await db()
    .prepare(
      "SELECT id FROM deliveries WHERE delivered_at IS NULL AND next_at<=? AND lease_until<? AND attempts<8 ORDER BY next_at LIMIT ?",
    )
    .bind(now(), now(), limit)
    .all<{ id: string }>();
  let sent = 0;
  for (const item of due.results) {
    const lease = now() + 20000;
    const d = await db()
      .prepare(
        "UPDATE deliveries SET lease_until=?,attempts=attempts+1 WHERE id=? AND lease_until<? AND delivered_at IS NULL RETURNING *",
      )
      .bind(lease, item.id, now())
      .first<any>();
    if (!d) continue;
    let status = 0;
    try {
      const key = await db()
        .prepare(
          "SELECT callback,webhook_secret FROM api_keys WHERE id=? AND revoked_at IS NULL",
        )
        .bind(d.key_id)
        .first<any>();
      if (!key?.callback || !key.webhook_secret) throw Error("revoked");
      const url = safeCallback(key.callback, env.CALLBACK_HOSTS || "");
      const secret = unseal(key.webhook_secret, env.APP_ENCRYPTION_KEY || "");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Plowf-Signature": sign(d.payload, secret),
          "User-Agent": "Plowf-Webhooks/1.0",
        },
        body: d.payload,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      status = response.status;
      await response.body?.cancel();
    } catch {}
    const delivered = status >= 200 && status < 300;
    const delays = [
      30000, 120000, 600000, 1800000, 3600000, 10800000, 21600000, 86400000,
    ];
    await db()
      .prepare(
        "UPDATE deliveries SET delivered_at=?,last_status=?,next_at=?,lease_until=0 WHERE id=? AND lease_until=?",
      )
      .bind(
        delivered ? now() : null,
        status,
        now() + delays[Math.min(d.attempts - 1, 7)],
        d.id,
        lease,
      )
      .run();
    if (delivered) sent++;
  }
  return { attempted: due.results.length, delivered: sent };
}
