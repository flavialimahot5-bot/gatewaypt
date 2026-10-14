import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { randomBytes, createECDH, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
mkdirSync(".sites-runtime", { recursive: true });
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync("drizzle/0000_sticky_psylocke.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0001_products.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0002_tiktok.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0003_push_notifications.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0004_checkout_presence.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0005_product_upsell.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0006_product_type.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0007_whatsapp_recovery.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0008_plowf_gateway.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0009_product_reviews.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0010_read_efficiency.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0011_broski_notifications.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0012_pix_review.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0013_plowf_sales_profile.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0014_trackerorder.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0015_store_orders.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0016_portugal.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0017_portugal_retry.sql", "utf8"));
class Statement {
  constructor(sql, params = []) {
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.sql, params);
  }
  async first() {
    return sqlite.prepare(this.sql).get(...this.params) || null;
  }
  async all() {
    return { results: sqlite.prepare(this.sql).all(...this.params) };
  }
  async run() {
    const r = sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes) } };
  }
}
globalThis.__testEnv = {
  DB: {
    prepare: (sql) => new Statement(sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        // SQLite's local connection is synchronous; keep a batch indivisible
        // when two dispatchers are exercised concurrently, like libSQL batches.
        for (const s of statements) {
          const r = sqlite.prepare(s.sql).run(...s.params);
          result.push({ success: true, meta: { changes: Number(r.changes) } });
        }
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  },
  ALLOWED_EMAILS: "owner@example.com",
  APP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  APP_ORIGIN: "https://gateway.example.com",
  PUBLIC_API_ENABLED: "true",
  CALLBACK_HOSTS: "shop.example.com",
  DISPATCH_SECRET: randomBytes(32).toString("hex"),
  ADMIN_USERS: {"owner@example.com":"test-credential-version"},
};
globalThis.__testUser = {
  userId: "test-owner",
  email: "owner@example.com",
  fullName: "Test Owner",
};
await build({
  stdin: {
    contents: `export * from './lib/server/store-orders'; export * from './lib/server/trackerorder'; export * from './lib/server/plowf-profile'; export * from './lib/buyer-fields'; export * from './lib/server/security'; export * from './lib/server/core'; export * from './lib/server/payments'; export * from './lib/server/plowf'; export * from './lib/server/bravopay'; export * from './lib/server/delivery'; export * from './lib/server/tiktok'; export * from './lib/server/push'; export * from './lib/server/analytics'; export * from './lib/server/products'; export * from './app/api/[...path]/route';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: ".sites-runtime/test-bundle.mjs",
  bundle: true,
  external: ["sharp","web-push"],
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "test-runtime",
      setup(b) {
        b.onResolve({ filter: /^next\/server$/ }, () => ({
          path: "next",
          namespace: "test",
        }));
        b.onResolve({ filter: /^\.\/config$/ }, () => ({
          path: "env",
          namespace: "test",
        }));
        b.onResolve({ filter: /^\.\/auth$/ }, () => ({
          path: "auth",
          namespace: "test",
        }));
        b.onResolve({ filter: /^\.\/database$/ }, () => ({
          path: "database",
          namespace: "test",
        }));
        b.onLoad({ filter: /.*/, namespace: "test" }, (a) => ({
          contents:
            a.path === "database"
              ? "export const database=globalThis.__testEnv.DB"
              : a.path === "next"
                ? "export function after(){}"
                : a.path === "env"
                  ? "export const env=globalThis.__testEnv; export const allowedEmails=()=>env.ALLOWED_EMAILS.toLowerCase().split(','); export const adminUsers=()=>env.ADMIN_USERS; export const authConfigured=()=>true"
                  : "export async function getCurrentUser(){return globalThis.__testUser}",
        }));
      },
    },
  ],
});
const m = await import("../.sites-runtime/test-bundle.mjs");
const env = globalThis.__testEnv;
const owner = globalThis.__testUser;
let upstreamCalls = 0;
let callbackStatus = 500;
const callbackRequests = [];
const providerRows = new Map();
globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith("https://shop.example.com")) {
    callbackRequests.push(options);
    return new Response(null, { status: callbackStatus });
  }
  if (!String(url).startsWith("https://pagpixhub.com/api/v1"))
    throw Error("Unexpected external request");
  if (options.method === "POST") {
    upstreamCalls++;
    const body = JSON.parse(options.body),
      id = "provider_" + options.headers["Idempotency-Key"];
    const row = {
      id,
      amount_cents: body.amount_cents,
      status: "PENDING",
      pix_status: "generating",
      external_reference: body.external_reference,
      pix: {
        copy_paste: null,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    };
    providerRows.set(id, row);
    return Response.json(row, { status: 202 });
  }
  const id = decodeURIComponent(String(url).split("/").pop());
  return providerRows.has(id)
    ? Response.json(providerRows.get(id))
    : Response.json({ error: "not found" }, { status: 404 });
};
function req(path, method = "GET", body, token, extra = {}) {
  return new Request(env.APP_ORIGIN + "/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: env.APP_ORIGIN,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...extra,
    },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
const run = (r) => m[r.method](r);
const result = async (r) => {
  const response = await run(r);
  return { status: response.status, body: await response.json() };
};
let keyA, keyB, charge;
await test("anonymous and unlisted identities cannot read dashboard", async () => {
  globalThis.__testUser = null;
  assert.equal((await run(req("admin/overview"))).status, 401);
  globalThis.__testUser = { ...owner, email: "outsider@example.com" };
  assert.equal((await run(req("admin/overview"))).status, 403);
  globalThis.__testUser = owner;
});
await test("cross-origin administrative writes are rejected", async () => {
  assert.equal(
    (
      await run(
        req("admin/keys", "POST", { name: "Blocked" }, undefined, {
          Origin: "https://evil.example",
        }),
      )
    ).status,
    403,
  );
});
await test("cross-origin administrative validation handles configured and Vercel production origins safely", () => {
  const keys = ["VERCEL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL"];
  const previous = keys.map(key => process.env[key]);
  const request = (origin, site = "same-origin", extra = {}) => new Request("https://internal.example/api/admin/products", {
    method: "POST", headers: { ...(origin === undefined ? {} : { Origin: origin }), "Sec-Fetch-Site": site, ...extra },
  });
  const denied = (r, expected) => assert.throws(() => m.assertOrigin(r, expected), { code: "invalid_origin" });
  try {
    keys.forEach(key => delete process.env[key]);
    m.assertOrigin(request("https://gatewaypt.vercel.app"), " https://GATEWAYPT.vercel.app:443/ \n");
    denied(request("https://gatewaypt.vercel.app"), "");
    denied(request("https://gatewaypt.vercel.app"), "https://gatewaypt.vercel.app/admin");
    Object.assign(process.env, { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "gatewaypt.vercel.app" });
    m.assertOrigin(request("https://gatewaypt.vercel.app"), "http://127.0.0.1:5173");
    m.assertOrigin(request("https://shop.example.com"), "https://shop.example.com/");
    for (const origin of [undefined, "null", "https://evil.vercel.app", "https://gatewaypt.vercel.app.evil.com", "http://gatewaypt.vercel.app", "https://gatewaypt.vercel.app:444"]) {
      denied(request(origin, "same-origin", { Host: "gatewaypt.vercel.app", "X-Forwarded-Host": "gatewaypt.vercel.app" }), "");
    }
    denied(request("https://gatewaypt.vercel.app", "cross-site"), "https://gatewaypt.vercel.app");
    process.env.VERCEL_ENV = "preview";
    denied(request("https://gatewaypt.vercel.app"), "https://preview.example.com");
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
await test("API keys are stored as hashes and scoped to separate integrations", async () => {
  keyA = (
    await result(
      req("admin/keys", "POST", {
        name: "Shop A",
        callback: "https://shop.example.com/hook",
      }),
    )
  ).body;
  keyB = (await result(req("admin/keys", "POST", { name: "Shop B" }))).body;
  assert.match(keyA.token, /^pl_live_/);
  const row = sqlite.prepare("SELECT * FROM api_keys WHERE id=?").get(keyA.id);
  assert.equal(row.hash, m.hash(keyA.token));
  assert.ok(!JSON.stringify(row).includes(keyA.token));
  assert.ok(!row.webhook_secret.includes(keyA.webhook_secret));
});
await test("invalid API credentials fail closed", async () =>
  assert.equal(
    (
      await run(
        req("v1/transactions", "GET", undefined, "pl_live_" + "x".repeat(43)),
      )
    ).status,
    401,
  ));
await test("provider credentials use authenticated encryption", async () => {
  const ciphertext = m.seal("bp_live_test", env.APP_ENCRYPTION_KEY);
  assert.equal(m.unseal(ciphertext, env.APP_ENCRYPTION_KEY), "bp_live_test");
  assert.throws(() =>
    m.unseal(ciphertext.slice(0, -3) + "abc", env.APP_ENCRYPTION_KEY),
  );
  await m.putSetting("provider_token", ciphertext);
  await m.putSetting(
    "provider_webhook",
    m.seal("whsec_provider_test", env.APP_ENCRYPTION_KEY),
  );
});
const payload = {
  amount_cents: 990,
  description: "Pedido de teste",
  external_reference: "order-1",
};
await test("invalid monetary amounts never reach provider", async () => {
  assert.equal(
    (
      await run(
        req(
          "v1/transactions",
          "POST",
          { ...payload, amount_cents: 4.5 },
          keyA.token,
          { "Idempotency-Key": "invalid-001" },
        ),
      )
    ).status,
    422,
  );
  assert.equal(upstreamCalls, 0);
});
await test("concurrent duplicate requests reserve only one charge", async () => {
  const r = await Promise.all(
    [1, 2].map(() =>
      result(
        req("v1/transactions", "POST", payload, keyA.token, {
          "Idempotency-Key": "order-0001",
        }),
      ),
    ),
  );
  charge = r.find((x) => x.status === 202)?.body;
  assert.ok(charge);
  assert.equal(upstreamCalls, 1);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM transactions").get().n,
    1,
  );
});
await test("202 retries reuse existing charge and checkout token", async () => {
  const again = await result(
    req("v1/transactions", "POST", payload, keyA.token, {
      "Idempotency-Key": "order-0001",
    }),
  );
  assert.equal(again.status, 202);
  assert.equal(again.body.id, charge.id);
  assert.equal(again.body.checkout_url, charge.checkout_url);
  assert.equal(upstreamCalls, 1);
});
await test("idempotency rejects changed amount", async () => {
  assert.equal(
    (
      await run(
        req(
          "v1/transactions",
          "POST",
          { ...payload, amount_cents: 1990 },
          keyA.token,
          { "Idempotency-Key": "order-0001" },
        ),
      )
    ).status,
    409,
  );
  assert.equal(upstreamCalls, 1);
});
await test("integration cannot read another integration transaction", async () => {
  assert.equal(
    (
      await run(
        req("v1/transactions/" + charge.id, "GET", undefined, keyB.token),
      )
    ).status,
    404,
  );
  const list = await result(
    req("v1/transactions", "GET", undefined, keyB.token),
  );
  assert.equal(list.body.data.length, 0);
});
await test("forged or replayed provider webhooks cannot settle a charge", async () => {
  const raw = JSON.stringify({
    id: "evt_forged",
    type: "transaction.paid",
    data: { id: "fake" },
  });
  assert.equal(
    (
      await run(
        req("webhooks/pagpixhub", "POST", raw, undefined, {
          "PagPixHub-Signature": "t=123,v1=dead",
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    m.verify(
      raw,
      m.sign(raw, "secret", Math.floor(Date.now() / 1000) - 600),
      "secret",
    ),
    false,
  );
  assert.equal(m.verify(raw + " ", m.sign(raw, "secret"), "secret"), false);
  assert.equal(m.verify(raw, "t=1234567890,v1=f", "secret"), false);
});
await test("valid paid webhook reconciles provider and creates one delivery", async () => {
  const tx = sqlite
    .prepare("SELECT * FROM transactions WHERE id=?")
    .get(charge.id);
  const p = providerRows.get(tx.provider_id);
  p.status = "PAID";
  p.pix_status = "paid";
  p.paid_at = new Date().toISOString();
  p.fee_cents = 99;
  p.net_cents = 891;
  const raw = JSON.stringify({
    id: "evt_provider_paid",
    type: "transaction.paid",
    data: { id: p.id, external_reference: tx.id },
  });
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await run(
          req("webhooks/pagpixhub", "POST", raw, undefined, {
            "PagPixHub-Signature": m.sign(raw, "whsec_provider_test"),
          }),
        )
      ).status,
      200,
    );
  assert.equal(
    sqlite.prepare("SELECT status FROM transactions WHERE id=?").get(tx.id)
      .status,
    "PAID",
  );
  assert.equal(
    sqlite.prepare("SELECT pix_status FROM transactions WHERE id=?").get(tx.id)
      .pix_status,
    "paid",
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) as n FROM deliveries WHERE payload LIKE '%transaction.paid%'",
      )
      .get().n,
    1,
  );
});
await test("out of order provider state cannot undo paid status", async () => {
  const tx = sqlite
    .prepare("SELECT * FROM transactions WHERE id=?")
    .get(charge.id);
  await m.applyProvider(tx, {
    ...providerRows.get(tx.provider_id),
    status: "PENDING",
    pix_status: "generating",
  });
  assert.equal(
    sqlite.prepare("SELECT status FROM transactions WHERE id=?").get(tx.id)
      .status,
    "PAID",
  );
  assert.equal(
    sqlite.prepare("SELECT pix_status FROM transactions WHERE id=?").get(tx.id)
      .pix_status,
    "paid",
  );
});
await test("provider amount mismatch cannot modify transaction", async () => {
  const tx = sqlite
    .prepare("SELECT * FROM transactions WHERE id=?")
    .get(charge.id);
  await assert.rejects(() =>
    m.applyProvider(tx, {
      ...providerRows.get(tx.provider_id),
      amount_cents: 999999,
    }),
  );
  assert.equal(
    sqlite.prepare("SELECT amount FROM transactions WHERE id=?").get(tx.id)
      .amount,
    990,
  );
});
await test("callback allowlist rejects local, alternate host, credentials and redirect ports", () => {
  for (const url of [
    "http://shop.example.com",
    "https://127.0.0.1/a",
    "https://evil.example/a",
    "https://shop.example.com:8443/a",
    "https://user:pass@shop.example.com/a",
  ])
    assert.throws(() => m.safeCallback(url, env.CALLBACK_HOSTS));
  assert.equal(
    m.safeCallback("https://shop.example.com/a", env.CALLBACK_HOSTS),
    "https://shop.example.com/a",
  );
});
await test("public checkout excludes customer and API secrets", async () => {
  const token = charge.checkout_url.split("/").pop();
  const res = await result(req("checkout/" + token));
  assert.equal(res.status, 200);
  assert.equal(res.body.customer, undefined);
  assert.ok(!JSON.stringify(res.body).includes(keyA.token));
  assert.equal((await run(req("checkout/co_" + "x".repeat(43)))).status, 404);
});
await test("failed callbacks retry with a valid signature and stable event ID", async () => {
  await m.dispatch(5);
  const pending = sqlite
    .prepare("SELECT * FROM deliveries WHERE delivered_at IS NULL")
    .all();
  assert.ok(pending.length > 0);
  assert.ok(
    pending.every(
      (row) =>
        row.attempts === 1 &&
        row.last_status === 500 &&
        row.next_at > Date.now(),
    ),
  );
  assert.ok(
    callbackRequests.every((r) =>
      m.verify(r.body, r.headers["Plowf-Signature"], keyA.webhook_secret),
    ),
  );
  const firstIds = callbackRequests.map((r) => JSON.parse(r.body).id).sort();
  sqlite.prepare("UPDATE deliveries SET next_at=0").run();
  callbackStatus = 204;
  await m.dispatch(5);
  const delivered = sqlite.prepare("SELECT * FROM deliveries").all();
  assert.ok(delivered.every((row) => row.attempts === 2 && row.delivered_at));
  assert.deepEqual(
    callbackRequests
      .slice(firstIds.length)
      .map((r) => JSON.parse(r.body).id)
      .sort(),
    firstIds,
  );
  const count = callbackRequests.length;
  await m.dispatch(5);
  assert.equal(callbackRequests.length, count);
});
await test("rate limits are persisted and enforced", async () => {
  await m.rateLimit("bounded-test", 2);
  await m.rateLimit("bounded-test", 2);
  await assert.rejects(
    () => m.rateLimit("bounded-test", 2),
    (e) => e.status === 429,
  );
});
await test("revocation takes effect on subsequent API calls", async () => {
  assert.equal((await run(req("admin/keys/" + keyB.id, "DELETE"))).status, 200);
  assert.equal(
    (await run(req("v1/transactions", "GET", undefined, keyB.token))).status,
    401,
  );
});
await test("body size limits reject oversized request", async () => {
  await assert.rejects(
    () => m.readBody(req("test", "POST", "x".repeat(70000))),
    (e) => e.status === 413,
  );
});
await test("dispatcher requires its own secret", async () =>
  assert.equal((await run(req("internal/dispatch", "POST"))).status, 401));
await test("private deployments block external payment creation", async () => {
  env.PUBLIC_API_ENABLED = "false";
  assert.equal(
    (
      await run(
        req("v1/transactions", "POST", payload, keyA.token, {
          "Idempotency-Key": "order-0002",
        }),
      )
    ).status,
    503,
  );
  assert.equal(upstreamCalls, 1);
});

await test("encryption tolerates outer whitespace without changing the key and rejects invalid keys", async () => {
  const key = env.APP_ENCRYPTION_KEY;
  const cipher = m.seal("credential", key);
  assert.equal(m.unseal(cipher, " " + key + "\r\n"), "credential");
  assert.equal(
    m.unseal(m.seal("credential", "\n" + key + " "), key),
    "credential",
  );
  try {
    for (const [value, expected] of [
      ["", "missing"],
      ["not-a-key", "invalid"],
      [key.slice(1), "invalid"],
      ["g".repeat(64), "invalid"],
      ['"' + key + '"', "invalid"],
      [key, "ready"],
      [key + "\n", "ready"],
    ]) {
      env.APP_ENCRYPTION_KEY = value;
      const { body } = await result(req("admin/overview"));
      assert.equal(body.provider.encryptionStatus, expected);
      assert.equal(body.provider.encryptionReady, expected === "ready");
      if (expected !== "ready")
        assert.throws(() => m.seal("secret", value), /APP_ENCRYPTION_KEY/);
    }
  } finally {
    env.APP_ENCRYPTION_KEY = key;
  }
});

await test("dashboard separates generated, pending and paid amounts with Sao Paulo day boundaries", async () => {
  globalThis.__testUser = owner;
  const start = Date.parse("2001-02-03T00:00:00-03:00");
  const insert = sqlite.prepare("INSERT INTO transactions(id,key_id,idempotency_key,request_hash,external_reference,amount,status,checkout_hash,checkout_token,description,customer,created_at,updated_at,paid_at,fee) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const [id, status, amount, created, paid] of [
    ["dash_pending", "PENDING", 1000, start, null],
    ["dash_paid", "PAID", 2000, start + 3600000, start + 7200000],
    ["dash_expired", "EXPIRED", 3000, start + 4000, null],
    ["dash_previous", "PAID", 4000, start - 1, start + 3000],
    ["dash_next", "PAID", 7000, start + 86400000, start + 86400000],
  ]) insert.run(id, "dashboard-test", id, id, id, amount, status, id, id, "Teste", "{}", created, created, paid, 0);
  const response = await result(req("admin/overview?date=2001-02-03"));
  assert.equal(response.status, 200);
  assert.equal(response.body.stats.generated_count, 3);
  assert.equal(response.body.stats.generated_amount, 6000);
  assert.equal(response.body.stats.pending_count, 1);
  assert.equal(response.body.stats.pending_amount, 1000);
  assert.equal(response.body.stats.ended_count, 1);
  assert.equal(response.body.stats.count, 2);
  assert.equal(response.body.stats.amount, 6000);
  assert.equal(response.body.hours.reduce((sum, hour) => sum + hour.generated, 0), 6000);
  assert.equal(response.body.hours.reduce((sum, hour) => sum + hour.amount, 0), 6000);
  sqlite.prepare("DELETE FROM transactions WHERE key_id='dashboard-test'").run();
});
await test("products: admin authorization, image validation, price integrity, idempotency and encrypted delivery", async () => {
  env.PUBLIC_API_ENABLED = "true";
  const sharp = (await import("sharp")).default;
  const image =
    "data:image/png;base64," +
    (
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#f5d45d" },
      })
        .png()
        .toBuffer()
    ).toString("base64");
  const product = {
    name: "Produto de teste",
    description: "Descrição",
    amount: 5790,
    shipping: 500,
    delivery_days: "5 a 10 dias úteis",
    active: true,
    image,
  };
  globalThis.__testUser = null;
  assert.equal((await run(req("admin/products", "POST", product))).status, 401);
  globalThis.__testUser = owner;
  assert.equal(
    (
      await run(
        req("admin/products", "POST", product, undefined, {
          Origin: "https://other.example",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await run(
        req("admin/products", "POST", {
          ...product,
          image: "data:image/svg+xml;base64,PHN2Zz4=",
        }),
      )
    ).status,
    422,
  );
  assert.equal((await run(req("admin/products", "POST", {...product,upsell_enabled:true,upsell_url:"javascript:alert(1)"}))).status,422);
  const created = await result(req("admin/products", "POST", {...product,upsell_enabled:true,upsell_url:"https://shop.example.com/upsell-a"}));
  assert.equal(created.body.upsell_enabled,true);
  assert.equal(created.body.upsell_url,"https://shop.example.com/upsell-a");
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.product_type, "physical");
  const digitalProduct = await result(req("admin/products", "POST", { ...product, product_type: "digital" }));
  assert.equal(digitalProduct.status, 201);
  assert.equal(digitalProduct.body.shipping, 0);
  assert.equal(digitalProduct.body.product_type, "digital");
  const digitalId = digitalProduct.body.id;
  const digitalBody = {attempt: crypto.randomUUID(), buyer: {email:"digital@example.com",cpf:"12345678909",phone:"11999999999"}};
  assert.equal((await run(req("products/" + id + "/order", "POST", digitalBody))).status, 422);
  const beforeInvalidBuyer = upstreamCalls;
  for (const cpf of ["11111111111", "12345678900", "1234567890", "123456789099"]) {
    assert.equal((await run(req("products/" + digitalId + "/order", "POST", { ...digitalBody, buyer: { ...digitalBody.buyer, cpf } }))).status, 422);
  }
  for (const phone of ["119999999999", "119999999"]) {
    assert.equal((await run(req("products/" + digitalId + "/order", "POST", { ...digitalBody, buyer: { ...digitalBody.buyer, phone } }))).status, 422);
  }
  assert.equal(upstreamCalls, beforeInvalidBuyer);
  const digitalOrder = await result(req("products/" + digitalId + "/order", "POST", {...digitalBody, buyer:{...digitalBody.buyer,phone:"+55 (11) 99999-9999"}, shipping_method:"full"}));
  assert.equal(digitalOrder.status, 202);
  assert.equal(digitalOrder.body.amount_cents, product.amount);
  assert.equal(digitalOrder.body.product.shipping, 0);
  const digitalStored = sqlite.prepare("SELECT * FROM product_orders WHERE product_id=?").get(digitalId);
  assert.equal(JSON.parse(digitalStored.snapshot).product_type, "digital");
  assert.deepEqual(JSON.parse(m.unseal(digitalStored.buyer, env.APP_ENCRYPTION_KEY)), digitalBody.buyer);
  await result(req("admin/products/" + digitalId, "POST", {...product, product_type:"physical",amount:9990}));
  const digitalRetry = await result(req("products/" + digitalId + "/order", "POST", {...digitalBody, shipping_method:"full"}));
  assert.equal(digitalRetry.body.id, digitalOrder.body.id);
  for (const phone of ['5511999999999', '+55 (11) 99999-9999', '(11) 99999-9999']) {
    const normalizedRetry=await result(req('products/'+digitalId+'/order','POST',{...digitalBody,buyer:{...digitalBody.buyer,phone},shipping_method:'full'}));
    assert.equal(normalizedRetry.body.id,digitalOrder.body.id);
  }

  assert.equal(digitalRetry.body.amount_cents, product.amount);
  assert.equal((await run(req("products/" + digitalId + "/order", "POST", {...digitalBody,attempt:crypto.randomUUID()}))).status,422);
  // Keep the original physical-order assertions isolated from this digital fixture.
  sqlite.prepare("DELETE FROM product_orders WHERE product_id=?").run(digitalId);

  assert.ok(created.body.checkout_url.endsWith("/comprar/" + id));
  const publicResponse = await result(req("products/" + id));
  assert.equal(publicResponse.body.amount, 5790);
  assert.equal(publicResponse.body.image, undefined);
  assert.equal(publicResponse.body.upsell_url, undefined);
  assert.equal(
    (await run(req("products/" + id + "/image"))).headers.get("content-type"),
    "image/jpeg",
  );
  const body = {
    attempt: "8218441f-117d-402b-a690-5bff17033267",
    buyer: {
      name: "Cliente Teste",
      email: "buyer@example.com",
      cpf: "12345678909",
      phone: "11999999999",
      address: {
        cep: "01001000",
        street: "Rua de Teste",
        number: "10",
        complement: "",
        district: "Centro",
        city: "São Paulo",
        state: "SP",
      },
    },
  };
  assert.equal(
    (
      await run(
        req("products/" + id + "/order", "POST", { ...body, amount_cents: 1 }),
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await run(
        req("products/" + id + "/order", "POST", body, undefined, {
          Origin: "https://evil.example",
        }),
      )
    ).status,
    403,
  );
  const calls = upstreamCalls;
  const fullBody = { ...body, attempt: "8218441f-117d-402b-a690-5bff17033268", shipping_method: "full" };
  const full = await result(req("products/" + id + "/order", "POST", fullBody));
  assert.equal(full.status, 202);
  assert.equal(full.body.amount_cents, 6788);
  assert.equal(full.body.product.shipping, 998);
  assert.equal((await run(req("products/" + id + "/order", "POST", { ...fullBody, shipping_method: "flex" }))).status, 409);
  const flex = await result(req("products/" + id + "/order", "POST", { ...body, attempt: "8218441f-117d-402b-a690-5bff17033269", shipping_method: "flex" }));
  assert.equal(flex.body.amount_cents, 5790);
  assert.equal(flex.body.product.shipping, 0);
  const order = await result(req("products/" + id + "/order", "POST", body));
  assert.equal(order.status, 202);
  assert.equal(order.body.amount_cents, 6290);
  assert.equal(upstreamCalls, calls + 3);
  assert.equal(order.body.buyer, undefined);
  const pendingReceipt=await result(req("checkout/"+new URL(order.body.checkout_url).pathname.split("/").pop()));
  assert.equal(pendingReceipt.body.redirect_url,null);
  assert.equal(pendingReceipt.body.product.upsell_url,undefined);
  const stored = sqlite
    .prepare("SELECT * FROM product_orders WHERE product_id=?")
    .get(id);
  assert.ok(!stored.buyer.includes(body.buyer.email));
  assert.equal(JSON.parse(stored.snapshot).upsell_url,"https://shop.example.com/upsell-a");
  assert.equal(
    JSON.parse(m.unseal(stored.buyer, env.APP_ENCRYPTION_KEY)).address.street,
    "Rua de Teste",
  );
  await result(
    req("admin/products/" + id, "POST", {
      ...product,
      amount: 9990,
      upsell_enabled: false,
      image: undefined,
    }),
  );
  const retry = await result(req("products/" + id + "/order", "POST", body));
  assert.equal(retry.body.id, order.body.id);
  assert.equal(retry.body.amount_cents, 6290);
  assert.equal(sqlite.prepare("SELECT upsell_url FROM products WHERE id=?").get(id).upsell_url,null);
  assert.equal(JSON.parse(sqlite.prepare("SELECT snapshot FROM product_orders WHERE id=?").get(stored.id).snapshot).upsell_url,"https://shop.example.com/upsell-a");
  assert.equal(upstreamCalls, calls + 3);
  assert.equal(
    (
      await run(
        req("products/" + id + "/order", "POST", {
          ...body,
          buyer: { ...body.buyer, name: "Outra pessoa" },
        }),
      )
    ).status,
    409,
  );
  const privateOrders = await result(req("admin/product-orders"));
  assert.equal(
    privateOrders.body.orders[0].buyer.address.street,
    "Rua de Teste",
  );
  await result(
    req("admin/products/" + id, "POST", {
      ...product,
      active: false,
      image: undefined,
    }),
  );
  assert.equal((await run(req("products/" + id))).status, 404);
  assert.equal(
    (
      await run(
        req("products/" + id + "/order", "POST", {
          ...body,
          attempt: "0218441f-117d-402b-a690-5bff17033267",
        }),
      )
    ).status,
    404,
  );
  env.PUBLIC_API_ENABLED = "false";
});
const trackingProduct = "prd_" + "T".repeat(43);
const trackingVisit = "9618441f-117d-402b-a690-5bff17033267";
const testPixel = "D7IP0BBC77U32HD1FV0G";
const testPixel2 = "TESTSECONDPIXEL123456";
const fakeToken = "mock-token-not-a-live-credential";
let trackedTx;
const rowsFor = (event) => sqlite.prepare("SELECT * FROM tracking_events WHERE event=?").all(event);
await test("TikTok: admin-only encrypted multi-pixel configuration, no token readback", async () => {
  globalThis.__testUser = null;
  assert.equal((await run(req("admin/tracking"))).status, 401);
  globalThis.__testUser = owner;
  assert.equal((await run(req("admin/tracking", "POST", {pixel_id: testPixel, label: "Blocked", access_token: fakeToken, is_active: true}, undefined, {Origin: "https://evil.example"}))).status, 403);
  for (const pixel of [testPixel, testPixel2]) {
    assert.equal((await run(req("admin/tracking", "POST", {pixel_id: pixel, label: "Test pixel", access_token: fakeToken, is_active: true}))).status, 200);
    const stored = sqlite.prepare("SELECT access_token FROM tracking_pixels WHERE pixel_id=?").get(pixel);
    assert.notEqual(stored.access_token, fakeToken);
    assert.equal(m.unseal(stored.access_token, env.APP_ENCRYPTION_KEY), fakeToken);
  }
  sqlite.prepare("INSERT INTO tracking_pixels SELECT pixel_id,'other-store',access_token,label,is_active,created_at FROM tracking_pixels WHERE pixel_id=?").run(testPixel);
  const response = await result(req("admin/tracking"));
  assert.equal(response.body.pixels.length, 2);
  assert.ok(!JSON.stringify(response.body).includes("access_token"));
});
await test("TikTok: one checkout event per visit per active pixel, server price and BRL", async () => {
  sqlite.prepare("INSERT INTO products(id,name,description,amount,image,shipping,delivery_days,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(trackingProduct,"Tracking test","Test",5790,"unused",0,"3 dias",1,Date.now(),Date.now());
  const body = {product_id: trackingProduct, tracking: {visit: trackingVisit, ttclid: "click_123"}};
  assert.equal((await run(req("tracking/start", "POST", {...body, event: "Purchase"}))).status, 422);
  assert.equal((await run(req("tracking/start", "POST", {...body, store_slug: "other-store"}))).status, 422);
  assert.equal((await run(req("tracking/start", "POST", body, undefined, {Origin: "https://evil.example"}))).status, 403);
  for (let i = 0; i < 2; i++) assert.equal((await run(req("tracking/start", "POST", body))).status, 200);
  assert.equal(rowsFor("InitiateCheckout").length, 2);
  assert.equal(rowsFor("Purchase").length, 0);
  const data = JSON.parse(m.unseal(rowsFor("InitiateCheckout")[0].payload, env.APP_ENCRYPTION_KEY));
  assert.equal(data.properties.value, 57.9);
  assert.equal(data.properties.currency, "BRL");
  assert.equal(data.user.ttclid, "click_123");
  assert.equal(data.user.external_id, m.hash(trackingVisit));
});
await test("TikTok: Purchase fires only for actual Pix, stays pending financially and never duplicates on payment", async () => {
  env.PUBLIC_API_ENABLED = "true";
  const body = {attempt: trackingVisit, shipping_method: "full", tracking: {visit: trackingVisit, ttclid: "click_123"}, buyer: {
    name: "Tracking Buyer", email: "TRACKING@example.com", cpf: "12345678909", phone: "11999999999",
    address: {cep: "01001000", street: "Rua Teste", number: "1", complement: "", district: "Centro", city: "São Paulo", state: "SP"},
  }};
  const order = await result(req("products/" + trackingProduct + "/order", "POST", body));
  assert.equal(order.status, 202);
  trackedTx = sqlite.prepare("SELECT * FROM transactions WHERE id=?").get(order.body.id);
  assert.equal(rowsFor("PixGenerated").length, 0);
  assert.equal(rowsFor("AddPaymentInfo").length, 0);
  assert.equal(rowsFor("Purchase").length, 0);
  const provider = providerRows.get(trackedTx.provider_id);
  provider.pix.copy_paste = "FAKE-NONPAYABLE-PIX-CODE";
  await m.applyProvider(trackedTx, provider);
  await m.applyProvider(trackedTx, provider);
  assert.equal(rowsFor("PixGenerated").length, 2);
  assert.equal(rowsFor("AddPaymentInfo").length, 2);
  assert.equal(rowsFor("Purchase").length, 2);
  assert.equal(sqlite.prepare("SELECT status FROM transactions WHERE id=?").get(trackedTx.id).status,"PENDING");
  assert.equal(sqlite.prepare("SELECT completed FROM tracking_context WHERE order_id=?").get(trackedTx.idempotency_key).completed,1);
  const firstPurchase = rowsFor("Purchase")[0].payload;
  const pix = JSON.parse(m.unseal(rowsFor("PixGenerated")[0].payload, env.APP_ENCRYPTION_KEY));
  const paymentInfo = JSON.parse(m.unseal(rowsFor("AddPaymentInfo")[0].payload, env.APP_ENCRYPTION_KEY));
  assert.equal(paymentInfo.event, "AddPaymentInfo");
  assert.equal(paymentInfo.properties.value, 67.88);
  assert.equal(paymentInfo.properties.currency, "BRL");
  assert.notEqual(paymentInfo.event_id, pix.event_id);
  assert.equal(pix.properties.value, 67.88);
  assert.equal(pix.properties.currency, "BRL");
  assert.equal(pix.user.email, m.hash("tracking@example.com"));
  assert.equal(pix.user.phone, m.hash("+5511999999999"));
  assert.ok(!JSON.stringify(pix).includes(body.buyer.cpf));
  assert.ok(!JSON.stringify(pix).includes("Rua Teste"));
  assert.equal((await run(req("tracking/start", "POST", {product_id: trackingProduct, tracking: {visit: trackingVisit}, status: "PAID"}))).status, 422);
  await assert.rejects(() => m.applyProvider(trackedTx, {...provider, status: "PAID", amount_cents: 1}));
  assert.equal(rowsFor("Purchase").length, 2);
  provider.status = "PAID";
  provider.paid_at = new Date().toISOString();
  const event = JSON.stringify({id: "tracking-paid-webhook", type: "transaction.paid", data: {id: provider.id}});
  const webhookSecret = m.unseal((await m.setting("provider_webhook")), env.APP_ENCRYPTION_KEY);
  for (let i = 0; i < 2; i++) assert.equal((await run(req("webhooks/pagpixhub", "POST", event, undefined, {"PagPixHub-Signature": m.sign(event, webhookSecret)}))).status, 200);
  await m.reconcileTracking();
  assert.equal(rowsFor("Purchase").length, 2);
  assert.equal(rowsFor("PixGenerated").length, 2);
  assert.equal(rowsFor("AddPaymentInfo").length, 2);
  const purchase = JSON.parse(m.unseal(rowsFor("Purchase")[0].payload, env.APP_ENCRYPTION_KEY));
  assert.equal(purchase.properties.value, 67.88);
  assert.notEqual(purchase.event_id, pix.event_id);
  assert.equal(purchase.event_time, Math.floor(trackedTx.created_at/1000));
  assert.equal(purchase.properties.conversion_stage, "pix_generated");
  assert.equal(rowsFor("Purchase")[0].payload, firstPurchase);
});
await test("TikTok: transport failure retries stable IDs; API code must be zero; no duplicate sends", async () => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  let code = 40001;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://business-api.tiktok.com/open_api/v1.3/event/track/");
    assert.equal(options.headers["Access-Token"], fakeToken);
    const body = JSON.parse(options.body);
    sent.push(body);
    return Response.json({code});
  };
  try {
    await m.dispatchTracking(20);
    assert.equal(sent.length, 8);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM tracking_events WHERE delivered_at IS NOT NULL").get().n, 0);
    assert.ok(rowsFor("Purchase").every(r => r.last_error === "api_40001" && r.attempts === 1));
    assert.ok(sent.every(b => b.test_event_code === undefined && b.event_source === "web"));
    await m.dispatchTracking(20);
    assert.equal(sent.length, 8); // backoff
    sqlite.exec("UPDATE tracking_events SET next_at=0");
    code = 0;
    env.TIKTOK_TEST_EVENT_CODE = "TEST-MOCK-ONLY";
    await Promise.all([m.dispatchTracking(20), m.dispatchTracking(20)]);
    assert.equal(sent.length, 16);
    assert.deepEqual(new Set(sent.slice(0,8).map(x=>x.data[0].event_id)),new Set(sent.slice(8).map(x=>x.data[0].event_id)));
    assert.ok(sent.slice(8).every(x=>x.test_event_code === "TEST-MOCK-ONLY"));
    assert.ok(rowsFor("Purchase").every(r => r.delivered_at && r.payload === null));
    await m.reconcileTracking(); await m.dispatchTracking(20);
    assert.equal(sent.length, 16);
  } finally { globalThis.fetch = originalFetch; delete env.TIKTOK_TEST_EVENT_CODE; }
});
await test("TikTok: paused pixels and legacy orders produce no new conversions", async () => {
  for (const pixel of [testPixel, testPixel2]) await m.saveTrackingPixel({pixel_id: pixel, label: "Paused", is_active: false}, owner.email);
  assert.deepEqual(await m.getActivePixels(), []);
  const before = sqlite.prepare("SELECT COUNT(*) AS n FROM tracking_events").get().n;
  const old = sqlite.prepare("SELECT * FROM transactions WHERE key_id LIKE 'product:%' AND id<>? LIMIT 1").get(trackedTx.id);
  await m.trackTransaction({...old, status: "PAID", paid_at: Date.now()});
  await m.startCheckoutTracking(req("tracking/start", "POST", {product_id: trackingProduct, tracking: {visit: "9618441f-117d-402b-a690-5bff17033268"}}));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM tracking_events").get().n, before);
});
const deviceKey = createECDH("prime256v1"); deviceKey.generateKeys();
const device = {endpoint:"https://web.push.apple.com/mock-test-device",expirationTime:null,keys:{p256dh:deviceKey.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};
let pushTx;
await test("Push: protected enrollment, encrypted keys, SSRF rejection and account isolation", async () => {
  // Earlier dashboard tests now start the shared notification event stream.
  // Isolate transport fixtures from those previously generated sale events.
  sqlite.exec("DELETE FROM push_deliveries; DELETE FROM push_events");
  globalThis.__testUser = null;
  assert.equal((await run(req("admin/push"))).status,401);
  assert.equal((await run(req("admin/push","POST",device))).status,401);
  globalThis.__testUser = owner;
  assert.equal((await run(req("admin/push","POST",device,undefined,{Origin:"https://evil.example"}))).status,403);
  for(const endpoint of ["http://web.push.apple.com/a","https://127.0.0.1/a","https://web.push.apple.com.evil.example/a","https://fcm.googleapis.com:8443/a","https://user:pass@web.push.apple.com/a"])
    assert.throws(()=>m.validatePushEndpoint(endpoint));
  const config=await result(req("admin/push"));
  assert.equal(config.status,200);
  assert.equal(config.body.public_key.length,87);
  assert.equal(config.body.privateKey,undefined);
  assert.equal((await result(req("admin/push"))).body.public_key,config.body.public_key);
  assert.equal((await run(req("admin/push","POST",device))).status,200);
  const stored=sqlite.prepare("SELECT * FROM push_subscriptions WHERE id=?").get(m.hash(device.endpoint));
  assert.ok(!stored.subscription.includes(device.endpoint));
  assert.deepEqual(JSON.parse(m.unseal(stored.subscription,env.APP_ENCRYPTION_KEY)),device);
  await m.revokePushSubscription({endpoint:device.endpoint},"someone-else@example.com");
  assert.equal((await m.pushSubscriptionStatus({endpoint:device.endpoint},owner.email)).enabled,true);
});
await test("Push: actual pending Pix and verified paid transitions queue once atomically", async () => {
  const result=await m.createCharge("dashboard",{amount_cents:6788,description:"Mock push order",external_reference:"push-test",customer:{}},"push-test-idempotency");
  pushTx=sqlite.prepare("SELECT * FROM transactions WHERE id=?").get(result.id);
  const provider=providerRows.get(pushTx.provider_id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_events WHERE transaction_id=?").get(pushTx.id).n,0);
  provider.pix.copy_paste="FAKE-NONPAYABLE-PUSH-TEST";
  await m.applyProvider(pushTx,provider);await m.applyProvider(pushTx,provider);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_events WHERE transaction_id=? AND event='PENDING'").get(pushTx.id).n,1);
  await assert.rejects(()=>m.applyProvider(pushTx,{...provider,status:"PAID",amount_cents:1}));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_events WHERE event='PAID'").get().n,0);
});
await test("Push: encrypted delivery, retries, stable deduplication and stale pending suppression", async () => {
  const original=globalThis.fetch;
  let code=503;
  const pushes=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,device.endpoint);
    assert.equal(options.redirect,"error");
    assert.ok(options.body.byteLength>100);
    assert.ok(!Buffer.from(options.body).includes(Buffer.from("Pagamento confirmado")));
    pushes.push(options);
    return new Response(null,{status:code});
  };
  try {
    await m.dispatchPush();
    assert.equal(pushes.length,1);
    assert.equal(sqlite.prepare("SELECT sent_at FROM push_deliveries").get().sent_at,null);
    await m.dispatchPush();assert.equal(pushes.length,1);
    code=201;sqlite.exec("UPDATE push_deliveries SET next_at=0");
    await Promise.all([m.dispatchPush(),m.dispatchPush()]);assert.equal(pushes.length,2);
    await m.dispatchPush();assert.equal(pushes.length,2);
    const provider=providerRows.get(pushTx.provider_id);
    provider.status="PAID";provider.paid_at=new Date().toISOString();
    await m.applyProvider(pushTx,provider);await m.applyProvider(pushTx,provider);
    await m.dispatchPush();assert.equal(pushes.length,3);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_events WHERE event='PAID'").get().n,1);
    // A delayed pending attempt is discarded once the authoritative state is paid.
    sqlite.exec("UPDATE push_deliveries SET sent_at=NULL,next_at=0 WHERE event_id LIKE 'pending:%'");
    await m.dispatchPush();assert.equal(pushes.length,3);
    assert.equal(sqlite.prepare("SELECT attempts FROM push_deliveries WHERE event_id LIKE 'pending:%'").get().attempts,8);
    assert.equal((await m.testPush({endpoint:device.endpoint},owner.email)).sent,true);
    assert.equal(pushes.length,4);
    code=410;
    sqlite.exec("UPDATE push_deliveries SET sent_at=NULL,next_at=0 WHERE event_id LIKE 'paid:%'");
    await m.dispatchPush();assert.equal(pushes.length,5);
    assert.equal((await m.pushSubscriptionStatus({endpoint:device.endpoint},owner.email)).enabled,false);
  }finally{globalThis.fetch=original;}
});
await test("Push: recipient preparation rolls back atomically and does not repeat historical fan-out", async () => {
  const eventId = "paid:atomic-fanout-test", time = Date.now();
  sqlite.prepare("INSERT INTO push_events(id,transaction_id,event,created_at) VALUES (?,?,'PAID',?)").run(eventId,pushTx.id,time);
  sqlite.exec("UPDATE push_subscriptions SET revoked_at=NULL,created_at=0");
  sqlite.exec("CREATE TRIGGER fail_fanout BEFORE UPDATE OF fanout_at ON push_events BEGIN SELECT RAISE(ABORT,'simulated crash'); END");
  await assert.rejects(() => m.dispatchPush(), /simulated crash/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_deliveries WHERE event_id=?").get(eventId).n,0);
  assert.equal(sqlite.prepare("SELECT fanout_at FROM push_events WHERE id=?").get(eventId).fanout_at,null);
  sqlite.exec("DROP TRIGGER fail_fanout");
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null,{status:201});
  try {
    await m.dispatchPush();
    const prepared = sqlite.prepare("SELECT fanout_at FROM push_events WHERE id=?").get(eventId).fanout_at;
    assert.ok(prepared);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_deliveries WHERE event_id=?").get(eventId).n,1);
    await m.dispatchPush();
    assert.equal(sqlite.prepare("SELECT fanout_at FROM push_events WHERE id=?").get(eventId).fanout_at,prepared);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_deliveries WHERE event_id=?").get(eventId).n,1);
  } finally { globalThis.fetch=original; }
});
await test("Push: changing account password stops notifications to previously enrolled device", async () => {
  await m.savePushSubscription(device,owner.email);
  env.ADMIN_USERS[owner.email]="new-credential-version";
  sqlite.exec("UPDATE push_subscriptions SET created_at=0; UPDATE push_deliveries SET sent_at=NULL,next_at=0,attempts=0");
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error("Revoked device must not contact push service");};
  try {
    await m.dispatchPush();
    assert.ok(sqlite.prepare("SELECT revoked_at FROM push_subscriptions").get().revoked_at);
    assert.equal((await m.pushSubscriptionStatus({endpoint:device.endpoint},owner.email)).enabled,false);
  }finally{globalThis.fetch=original;}
});
await test("Analytics: private dashboard, origin enforcement, bounded stages and no field collection", async () => {
  globalThis.__testUser = null;
  assert.equal((await run(req("admin/analytics"))).status,401);
  globalThis.__testUser = owner;
  const body={product_id:trackingProduct,visit:"6618441f-117d-402b-a690-5bff17033267",stage:0};
  assert.equal((await run(req("tracking/presence","POST",body,undefined,{Origin:"https://evil.example"}))).status,403);
  assert.equal((await run(req("tracking/presence","POST",{...body,stage:5}))).status,422);
  assert.equal((await run(req("tracking/presence","POST",{...body,email:"private@example.com"}))).status,422);
  assert.equal((await run(req("tracking/presence","POST",{...body,product_id:"missing"}))).status,404);
  for(const stage of [0,1,2,3,1]) assert.equal((await run(req("tracking/presence","POST",{...body,stage}))).status,200);
  const rows=sqlite.prepare("SELECT * FROM checkout_sessions WHERE id=?").all(m.hash(trackingProduct+":"+body.visit));
  assert.equal(rows.length,1); assert.equal(rows[0].stage,3); assert.equal(rows[0].order_id,null);
});
await test("Analytics: authoritative Pix and purchase, cohort ratios, expiry and historical order exclusion", async () => {
  const seen=Date.now();
  const query=new URLSearchParams("period=today");
  let a=await m.analyticsOverview(query);
  assert.ok(a.funnel.arrivals>=2);
  assert.equal(a.funnel.paid,1); assert.equal(a.funnel.pix,1);
  assert.equal(a.live.reduce((s,r)=>s+r.count,0),a.funnel.arrivals);
  const linked=sqlite.prepare("SELECT * FROM checkout_sessions WHERE order_id=?").get(trackedTx.idempotency_key);
  assert.ok(linked);
  // A repeated order link cannot hijack an already attributed visit.
  await m.linkCheckoutVisit(trackingProduct,trackingVisit,"unrelated-order");
  assert.equal(sqlite.prepare("SELECT order_id FROM checkout_sessions WHERE id=?").get(linked.id).order_id,trackedTx.idempotency_key);
  sqlite.exec("UPDATE checkout_sessions SET last_seen=0 WHERE order_id IS NULL");
  a=await m.analyticsOverview(query);
  assert.equal(a.funnel.abandoned,1);
  assert.equal(a.live.reduce((s,r)=>s+r.count,0),1);
  assert.ok(!JSON.stringify(a).includes("private@example.com"));
  // Pending and refunded transactions are never counted as paid.
  sqlite.prepare("UPDATE transactions SET status='REFUNDED' WHERE id=?").run(trackedTx.id);
  a=await m.analyticsOverview(query); assert.equal(a.funnel.paid,0); assert.equal(a.funnel.pix,1);
  assert.equal(a.sales.generated,sqlite.prepare("SELECT COUNT(*) n FROM transactions WHERE copy_paste IS NOT NULL AND created_at>=? AND created_at<?").get(a.start,a.end).n);
  assert.equal(a.sales.converted,sqlite.prepare("SELECT COUNT(*) n FROM transactions WHERE copy_paste IS NOT NULL AND status='PAID' AND created_at>=? AND created_at<?").get(a.start,a.end).n);
});
await test("Analytics: Brazilian date boundaries and invalid filters", async () => {
  const time=Date.parse("2026-09-23T01:30:00Z");
  assert.equal(m.analyticsRange(new URLSearchParams("period=today"),time).start,Date.parse("2026-09-22T03:00:00Z"));
  assert.equal(m.analyticsRange(new URLSearchParams("period=week"),time).start,Date.parse("2026-09-16T03:00:00Z"));
  assert.equal(m.analyticsRange(new URLSearchParams("period=month"),time).start,Date.parse("2026-09-01T03:00:00Z"));
  assert.throws(()=>m.analyticsRange(new URLSearchParams("period=custom&date=2026-02-30"),time));
  assert.equal((await run(req("admin/analytics?period=bad"))).status,422);
});
await test("Upsell: destination is private until verified PAID and unsafe URLs are rejected", async () => {
  const snapshot=JSON.stringify({name:"Test",upsell_url:"https://shop.example.com/offer?a=1"});
  for(const status of ["PENDING","CREATING","EXPIRED","FAILED","REFUNDED","CHARGEBACK"]) {
    const result=m.checkoutOrderDetails(snapshot,{status,provider_id:"provider",paid_at:Date.now()});
    assert.equal(result.redirect_url,null); assert.equal(result.product.upsell_url,undefined);
  }
  assert.equal(m.checkoutOrderDetails(snapshot,{status:"PAID",provider_id:"provider",paid_at:Date.now()}).redirect_url,"https://shop.example.com/offer?a=1");
  assert.equal(m.checkoutOrderDetails(snapshot,{status:"PAID"}).redirect_url,null);
  assert.equal(m.checkoutOrderDetails(JSON.stringify({name:"Legacy"}),{status:"PAID",paid_at:1,provider_id:"p"}).redirect_url,null);
  for(const url of ["javascript:alert(1)","http://shop.example.com","https://user:pass@shop.example.com","/relative",""])assert.throws(()=>m.validUpsellUrl(url));
  assert.equal(m.publicProduct({id:"p",upsell_url:"https://shop.example.com"}).upsell_url,undefined);
});
await test("Removed WhatsApp recovery cannot send messages through old endpoints", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Recovery must not call external services"); };
  try {
    for (const path of ["admin/recovery", "admin/recovery/templates", "admin/recovery/test"]) {
      assert.equal((await run(req(path,"POST",{}))).status,410);
    }
    assert.equal((await run(req("internal/recovery","POST",{},undefined,{Authorization:"Bearer "+env.DISPATCH_SECRET}))).status,410);
    assert.equal(m.publicProduct({id:"old",recovery_template:'{"id":"old"}'}).recovery_enabled,false);
  } finally { globalThis.fetch = previous; }
});
await test("Plowf: isolated connections, switching, immutable routing, signed durable webhooks and no duplicate POST", async () => {
  const previousFetch=globalThis.fetch;
  const tokenA="plowf_test_token_A",tokenB="plowf_test_token_B",secretA="plowf_webhook_secret_A",secretB="plowf_webhook_secret_B";
  const rows=new Map(),hooks=[],posts=[],reads=[];
  let timeout=false,emptyList=false,rejectCreate=false,readFailure=false;
  globalThis.fetch=async (url,options={})=>{
    const u=new URL(url);
    if(u.origin!=="https://app.plowf.com")return previousFetch(url,options);
    const token=options.headers.Authorization.replace("Bearer ","");
    assert.ok([tokenA,tokenB].includes(token));
    assert.equal(options.redirect,"error");
    if(u.pathname.endsWith("/providers"))return Response.json({data:[]});
    if(u.pathname.endsWith("/webhooks"))return Response.json({data:hooks.filter(h=>h.account===token)});
    if(options.method==="POST"){
      const body=JSON.parse(options.body);posts.push({token,body});
      if(rejectCreate)return Response.json({message:"Invalid"},{status:422});
      const raw={uuid:crypto.randomUUID(),external_ref:body.external_ref,value:body.value,fees:"0.99",currency:"BRL",type:"PIX",status:"PENDING",payment:{payload:"test-plowf-pix",expires_at:new Date(Date.now()+1800000).toISOString()},history:[]};
      rows.set(raw.uuid,{raw,token});
      if(timeout)throw Error("Response lost after creating charge");
      return Response.json({data:raw},{status:201});
    }
    if(u.pathname.endsWith("/payments"))return Response.json({data:emptyList?[]:[...rows.values()].filter(r=>r.token===token).map(r=>r.raw)});
    const entry=rows.get(u.pathname.split("/").pop());reads.push(token);
    if(readFailure)return new Response(null,{status:503});
    assert.equal(entry?.token,token,"must use the original connection's token");
    return Response.json({data:entry.raw});
  };
  try {
    globalThis.__testUser=null; assert.equal((await run(req("admin/gateways"))).status,401);globalThis.__testUser=owner;
    assert.equal((await run(req("admin/gateways/active","POST",{gateway:"plowf"},undefined,{Origin:"https://evil.example"}))).status,403);
    assert.equal((await result(req("admin/gateways"))).body.active,"pagpixhub");
    assert.equal((await run(req("admin/gateways/active","POST",{gateway:"plowf"}))).status,422);
    assert.equal((await run(req("admin/gateways/plowf","POST",{}))).status,422);
    const connected=await result(req("admin/gateways/plowf","POST",{token:tokenA,webhook_secret:secretA}));assert.equal(connected.status,200);
    const connectionA=connected.body.webhook_url.split("/").pop();
    const savedCredentials=sqlite.prepare("SELECT value FROM settings WHERE id=?").get("plowf_connection:"+connectionA).value;
    const reused=await result(req("admin/gateways/plowf","POST",{token:"",webhook_secret:""}));
    assert.equal(reused.body.webhook_url,connected.body.webhook_url);
    assert.equal(sqlite.prepare("SELECT value FROM settings WHERE id=?").get("plowf_connection:"+connectionA).value,savedCredentials);
    assert.ok(!sqlite.prepare("SELECT value FROM settings WHERE id=?").get("plowf_connection:"+connectionA).value.includes(tokenA));
    assert.equal((await result(req("admin/gateways"))).body.active,"pagpixhub");
    assert.equal((await run(req("admin/gateways/active","POST",{gateway:"plowf"}))).status,422);
    hooks.push({url:connected.body.webhook_url,token:secretA,events:["PAYMENT"],status:"ACTIVE",account:tokenA});
    const payload={amount_cents:5790,description:"Direct sale",external_reference:"own-sale",customer:{email:"buyer@example.com",cpf:"12345678909",phone:"11999999999"}};
    const pag=await m.createCharge("dashboard",payload,"plowf-legacy-pag");
    assert.equal(pag.gateway,"pagpixhub");
    assert.equal((await run(req("admin/gateways/active","POST",{gateway:"plowf"}))).status,200);
    const pagPostsBefore=upstreamCalls;
    const tx=await m.createCharge("dashboard",payload,"plowf-charge-1");assert.equal(tx.gateway,"plowf");assert.equal(tx.amount_cents,5790);assert.equal(tx.net_is_estimate,true);
    assert.equal(upstreamCalls,pagPostsBefore,"Plowf creation must never POST to PagPixHub");
    assert.equal(posts.length,1);assert.equal(posts[0].body.value,57.9);assert.equal(posts[0].body.customer.name,undefined);assert.equal(posts[0].body.final_beneficiary,undefined);assert.equal(posts[0].body.products,undefined);
    const stored=()=>sqlite.prepare("SELECT * FROM transactions WHERE id=?").get(tx.id);
    assert.equal(stored().gateway_connection,connectionA);assert.equal(stored().status,"PENDING");
    assert.ok(stored().provider_id.startsWith("plowf:"));
    // Disabling keeps credentials and old charges; new charges fail before any provider call.
    assert.equal((await run(req("admin/gateways/active","POST",{gateway:"none",expected_gateway:"pagpixhub"}))).status,409);
    assert.equal((await m.gatewayOverview()).active,"plowf");
    assert.equal((await run(req("admin/gateways/active","POST",{gateway:"none",expected_gateway:"plowf"}))).status,200);
    const paused=await m.gatewayOverview();assert.equal(paused.active,"none");assert.equal(paused.plowf.configured,true);assert.equal(paused.pagpixhub.configured,true);
    await assert.rejects(()=>m.createCharge("dashboard",payload,"paused-charge"),e=>e.code==="gateway_disabled");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM transactions WHERE idempotency_key='paused-charge'").get().n,0);
    assert.equal((await m.createCharge("dashboard",payload,"plowf-charge-1")).id,tx.id);
    assert.equal(posts.length,1);assert.equal(upstreamCalls,pagPostsBefore);
    await m.activateGateway({gateway:"plowf"},owner.email);
    assert.equal((await m.gatewayOverview()).plowf.current,connectionA);
    assert.equal(sqlite.prepare("SELECT value FROM settings WHERE id=?").get("plowf_connection:"+connectionA).value,savedCredentials);
    await m.activateGateway({gateway:"pagpixhub"},owner.email);
    const switchedPag=await m.createCharge("dashboard",payload,"switched-pag-new");assert.equal(switchedPag.gateway,"pagpixhub");assert.equal(upstreamCalls,pagPostsBefore+1);assert.equal(posts.length,1);
    assert.equal((await m.createCharge("dashboard",payload,"plowf-charge-1")).id,tx.id);assert.equal(posts.length,1);
    const arow=rows.get(stored().provider_id.slice(6)).raw;
    const webhook=(connection,secret,data)=>{
      const raw=JSON.stringify({event:"PAYMENT",data});return req("webhooks/plowf/"+connection,"POST",raw,undefined,{"X-Webhook-Signature":createHmac("sha256",secret).update(raw).digest("hex")});
    };
    assert.equal((await run(webhook(connectionA,"wrong",arow))).status,401);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gateway_events").get().n,0);
    // A signed 'paid' notification is not proof of payment: re-read the provider.
    assert.equal((await run(webhook(connectionA,secretA,{...arow,status:"PAID"}))).status,200);
    await m.processGatewayEvents();assert.equal(stored().status,"PENDING");
    arow.status="PAID";arow.history=[{status:"PAID",created_at:new Date().toISOString()}];
    await run(webhook(connectionA,secretA,arow));await run(webhook(connectionA,secretA,arow));
    readFailure=true;await m.processGatewayEvents();assert.equal(stored().status,"PENDING");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gateway_events WHERE processed_at IS NULL").get().n,1);
    readFailure=false;sqlite.exec("UPDATE gateway_events SET next_at=0");await m.processGatewayEvents();assert.equal(stored().status,"PAID");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_events WHERE transaction_id=? AND event='PAID'").get(tx.id).n,1);
    assert.equal((await m.checkoutOrderDetails(JSON.stringify({name:"test",upsell_url:"https://shop.example.com/offer"}),stored())).redirect_url,"https://shop.example.com/offer");
    assert.equal((await m.reconcileCharge(sqlite.prepare("SELECT * FROM transactions WHERE id=?").get(pag.id))).gateway,"pagpixhub");
    const b=await m.savePlowf({token:tokenB,webhook_secret:secretB},owner.email);const connectionB=b.webhook_url.split("/").pop();
    hooks.push({url:b.webhook_url,token:secretB,events:["PAYMENT"],status:"ACTIVE",account:tokenB});await m.activateGateway({gateway:"plowf"},owner.email);
    await m.sync(stored());assert.equal(reads.at(-1),tokenA);
    const crossRaw=JSON.stringify({id:"cross-provider",type:"transaction.paid",data:{id:stored().provider_id,external_reference:tx.id}});
    assert.equal((await run(req("webhooks/pagpixhub","POST",crossRaw,undefined,{"PagPixHub-Signature":m.sign(crossRaw,"whsec_provider_test")}))).status,200);
    const priorReads=reads.length;await run(webhook(connectionB,secretB,arow));await m.processGatewayEvents();assert.equal(reads.length,priorReads);
    // Timeout: keep a single outbound attempt, even after switching active gateways.
    timeout=true;emptyList=true;
    await assert.rejects(()=>m.createCharge("dashboard",payload,"plowf-timeout-1"));const count=posts.length;
    await m.activateGateway({gateway:"pagpixhub"},owner.email);
    const uncertain=await m.createCharge("dashboard",payload,"plowf-timeout-1");assert.equal(uncertain.status,"CREATING");assert.equal(posts.length,count);
    const lost=[...rows.values()].find(r=>r.raw.external_ref===uncertain.id).raw;lost.status="PAID";
    await run(webhook(connectionB,secretB,lost));await m.processGatewayEvents();assert.equal(sqlite.prepare("SELECT status FROM transactions WHERE id=?").get(uncertain.id).status,"PAID");
    timeout=false;emptyList=false;await m.activateGateway({gateway:"plowf"},owner.email);
    // Concurrent attempts never produce two Plowf charges.
    const before=posts.length;const concurrent=await Promise.allSettled([m.createCharge("dashboard",payload,"plowf-concurrent"),m.createCharge("dashboard",payload,"plowf-concurrent")]);
    assert.ok(concurrent.some(r=>r.status==="fulfilled"));assert.equal(posts.length,before+1);
    rejectCreate=true;await assert.rejects(()=>m.createCharge("dashboard",payload,"plowf-rejected"));rejectCreate=false;
    const rejected=await m.createCharge("dashboard",payload,"plowf-rejected");assert.equal(rejected.status,"FAILED");assert.equal(posts.length,before+2);
    for(const changed of [{...arow,value:58},{...arow,payment:{...arow.payment,value:58}},{...arow,currency:"EUR"},{...arow,external_ref:"wrong"},{...arow,status:"UNKNOWN"}])assert.throws(()=>m.normalizePlowf(changed,stored()));
    assert.equal(m.plowfCents("57.90"),5790);assert.throws(()=>m.plowfCents("57.901"));
    assert.equal(m.normalizePlowf({...arow,fees:undefined},stored()).fee_cents,undefined);
    const overview=await m.gatewayOverview();assert.ok(!JSON.stringify(overview).includes(tokenA));assert.ok(!JSON.stringify(overview).includes(secretA));
    const publicTx=m.withCheckout(stored());assert.equal(publicTx.gateway_connection,undefined);assert.equal(publicTx.customer,undefined);
    const list=await result(req("admin/overview"));assert.ok(list.body.transactions.some(t=>t.gateway==="plowf"));
    const listedCustomer=list.body.transactions.find(t=>t.id===tx.id).customer;
    assert.equal(listedCustomer.email,payload.customer.email);
    assert.deepEqual(Object.keys(listedCustomer).sort(),["email","name","phone"]);
    assert.equal((await m.analyticsOverview(new URLSearchParams("period=today"))).received.estimated_net,2);
    arow.status="PARTIALLY_REFUNDED";await m.sync(stored());assert.equal(stored().status,"REFUNDED");assert.equal(stored().pix_status,"partially_refunded");
    arow.status="PENDING";await m.sync(stored());assert.equal(stored().status,"REFUNDED");
  } finally {globalThis.fetch=previousFetch;globalThis.__testUser=owner;await m.putSetting("active_gateway","pagpixhub");}
});
await test("Plowf checkout sends frozen items, stable SKUs and freight; validation errors stay private", async () => {
  const previousFetch=globalThis.fetch, posts=[], pagBefore=upstreamCalls;
  let rejection=null;
  globalThis.fetch=async (url,options={})=>{
    if(new URL(url).origin!=="https://app.plowf.com")return previousFetch(url,options);
    assert.equal(options.method,"POST");
    const body=JSON.parse(options.body);posts.push(body);
    if(rejection)return Response.json(rejection,{status:422});
    // Model the stricter account: it rejects checkout charges without real line items.
    if(!body.products?.length)return Response.json({errors:{products:["Required"]}},{status:422});
    assert.equal(body.products.reduce((sum,p)=>sum+Math.round(p.price*100)*p.quantity,0),Math.round(body.value*100));
    return Response.json({data:{uuid:crypto.randomUUID(),external_ref:body.external_ref,value:body.value,currency:"BRL",type:"PIX",status:"PENDING",payment:{payload:"mock-pix-items"}}},{status:201});
  };
  try {
    await m.putSetting("active_gateway","plowf");
    const productId="prd_plowf_frozen_items";
    sqlite.prepare("INSERT INTO products(id,name,description,amount,image,shipping,delivery_days,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(productId,"Edited catalog name","",9999,"",0,"",m.now(),m.now());
    const input=(id,shipping=0)=>({amount_cents:5790+shipping,description:"Frozen product",external_reference:id,customer:{name:"Test Buyer",email:"buyer@example.com",cpf:"12345678909",phone:"11999999999"}});
    const insert=(id,shipping=0)=>sqlite.prepare("INSERT INTO product_orders(id,product_id,request_hash,snapshot,buyer,created_at) VALUES (?,?,?,?,?,?)")
      .run(id,productId,"test",JSON.stringify({name:"Frozen product",amount:5790,shipping,shipping_method:shipping?"full":"flex"}),"unused-test-buyer",m.now());
    insert("ord_plowf_items_free");
    const free=await m.createCharge("product:"+productId,input("ord_plowf_items_free"),"ord_plowf_items_free");
    assert.equal(free.status,"PENDING");
    assert.deepEqual(posts[0].products,[{external_ref:productId,name:"Frozen product",price:57.9,quantity:1}]);
    assert.deepEqual(posts[0].customer,{name:"Test Buyer",document:"12345678909",email:"buyer@example.com",phone:"11999999999"});
    assert.equal(posts[0].final_beneficiary,undefined);
    const retry=await m.createCharge("product:"+productId,input("ord_plowf_items_free"),"ord_plowf_items_free");
    assert.equal(retry.id,free.id);assert.equal(posts.length,1);
    insert("ord_plowf_items_full",998);
    await m.createCharge("product:"+productId,input("ord_plowf_items_full",998),"ord_plowf_items_full");
    assert.deepEqual(posts[1].products,[posts[0].products[0],{external_ref:`shipping:${productId}:full`,name:"Frete Full",price:9.98,quantity:1}]);
    assert.equal(posts[1].value,67.88);
    // A corrupt total or a different product's snapshot must never reach the provider.
    insert("ord_plowf_items_wrong");
    await assert.rejects(()=>m.createCharge("product:"+productId,input("ord_plowf_items_wrong",998),"ord_plowf_items_wrong"),e=>e.code==="plowf_order_mismatch");
    await assert.rejects(()=>m.createCharge("product:other",input("ord_plowf_items_free"),"ord_plowf_wrong_product"),e=>e.code==="plowf_order_mismatch");
    assert.equal(posts.length,2);assert.equal(upstreamCalls,pagBefore);
    rejection={message:"private upstream message",errors:{"customer.name":["private buyer name"],"products.0.price":["private value"],"final_beneficiary.document":["private document"],"secret_field_private":["private token"]}};
    insert("ord_plowf_items_rejected");
    await assert.rejects(()=>m.createCharge("product:"+productId,input("ord_plowf_items_rejected"),"ord_plowf_items_rejected"),e=>{
      assert.equal(e.code,"plowf_http_422");assert.match(e.message,/nome do comprador/);assert.match(e.message,/itens do pedido/);assert.match(e.message,/beneficiário final/);assert.ok(!e.message.includes("private"));return true;
    });
    const rejected=await m.createCharge("product:"+productId,input("ord_plowf_items_rejected"),"ord_plowf_items_rejected");
    assert.equal(rejected.status,"FAILED");assert.equal(posts.length,3);assert.equal(upstreamCalls,pagBefore);
    rejection={message:"private upstream error",errors:{unrecognized:"private value"}};
    await assert.rejects(()=>m.plowfRequest({token:"mock"},"/payments",{}),e=>e.code==="plowf_http_422" && !e.message.includes("private") && e.message.includes("campos exigidos"));
    rejection=null;
    const multiId='ord_plowf_items_quantity';insert(multiId,998);
    sqlite.prepare("UPDATE product_orders SET snapshot=json_set(snapshot,'$.quantity',3) WHERE id=?").run(multiId);
    await m.createCharge('product:'+productId,{...input(multiId,998),amount_cents:5790*3+998},multiId);
    assert.equal(posts.at(-1).products[0].quantity,3);
    assert.equal(posts.at(-1).products[0].price,57.9);
    assert.equal(posts.at(-1).products[1].quantity,1);
    assert.equal(posts.at(-1).value,183.68);
  } finally {globalThis.fetch=previousFetch;await m.putSetting("active_gateway","pagpixhub");}
});
await test("Fast checkout refresh shares a lease, throttles failures and never recreates a charge", async () => {
  const previousFetch=globalThis.fetch, previousNow=Date.now;
  let clock=previousNow(), reads=0, posts=0, release, fail=false;
  Date.now=()=>clock;
  let raw;
  globalThis.fetch=async (url,options={})=>{
    assert.ok(String(url).startsWith("https://app.plowf.com/api/v1/payments"));
    if(options.method==="POST") {
      posts++;
      const body=JSON.parse(options.body);
      raw={uuid:crypto.randomUUID(),external_ref:body.external_ref,value:body.value,currency:"BRL",type:"PIX",status:"PENDING",payment:{payload:"mock-refresh"}};
      return Response.json({data:raw});
    }
    reads++;
    if(fail)return new Response(null,{status:503});
    await new Promise(resolve=>{release=resolve;});
    return Response.json({data:raw});
  };
  try {
    await m.putSetting("active_gateway","plowf");
    const created=await m.createCharge("dashboard",{amount_cents:500,description:"Refresh test",external_reference:"refresh-test",customer:{}},"checkout-refresh-test");
    const stored=()=>sqlite.prepare("SELECT * FROM transactions WHERE id=?").get(created.id);
    await m.refreshCheckout(stored());assert.equal(reads,0);
    clock+=6000;
    const first=m.refreshCheckout(stored());
    await new Promise(setImmediate);
    assert.equal(reads,1);
    const duplicate=await m.refreshCheckout(stored());assert.equal(duplicate.status,"PENDING");assert.equal(reads,1);
    release();await first;
    await m.refreshCheckout(stored());assert.equal(reads,1);
    clock+=6000;fail=true;
    assert.equal((await m.refreshCheckout(stored())).status,"PENDING");assert.equal(reads,2);
    await m.refreshCheckout(stored());assert.equal(reads,2,"failed reads must also be throttled");
    clock+=6000;fail=false;raw.status="PAID";
    const paid=m.refreshCheckout(stored());await new Promise(setImmediate);release();
    assert.equal((await paid).status,"PAID");
    clock+=6000;await m.refreshCheckout(stored());assert.equal(reads,3);assert.equal(posts,1);
  } finally {globalThis.fetch=previousFetch;Date.now=previousNow;await m.putSetting("active_gateway","pagpixhub");}
});
await test("A slow webhook cannot hold a different payment's approval notification", async () => {
  const previousFetch=globalThis.fetch, rows=new Map();let blockedId,release;
  globalThis.fetch=async (url,options={})=>{
    if(options.method==="POST") {
      const body=JSON.parse(options.body),raw={uuid:crypto.randomUUID(),external_ref:body.external_ref,value:body.value,currency:"BRL",type:"PIX",status:"PENDING",payment:{payload:"mock-queue"}};
      rows.set(raw.uuid,raw);return Response.json({data:raw});
    }
    const id=new URL(url).pathname.split("/").pop();
    if(id===blockedId)await new Promise(resolve=>{release=resolve;});
    return Response.json({data:rows.get(id)});
  };
  try {
    await m.putSetting("active_gateway","plowf");
    const create=async name=>m.createCharge("dashboard",{amount_cents:500,description:name,external_reference:name,customer:{}},name);
    const slow=await create("slow-webhook-test"),fast=await create("fast-webhook-test");
    const stored=id=>sqlite.prepare("SELECT * FROM transactions WHERE id=?").get(id);
    const slowRow=stored(slow.id),fastRow=stored(fast.id);
    blockedId=slowRow.provider_id.slice(6);
    for(const tx of [slowRow,fastRow]) {
      const raw=rows.get(tx.provider_id.slice(6));raw.status="PAID";
      const body=JSON.stringify({event:"PAYMENT",data:raw});
      const connection=await m.plowfConnection(tx.gateway_connection);
      await m.receivePlowfWebhook(tx.gateway_connection,body,createHmac("sha256",connection.webhook).update(body).digest("hex"));
    }
    let fastNotified=false;
    const work=m.processGatewayEvents(undefined,async()=>{if(stored(fast.id).status==="PAID")fastNotified=true;});
    await new Promise(setImmediate);
    assert.ok(release,"slow provider lookup is still running");
    assert.equal(fastNotified,true,"fast payment notification must not await the slow lookup");
    assert.equal(stored(slow.id).status,"PENDING");
    release();await work;assert.equal(stored(slow.id).status,"PAID");
  } finally {release?.();globalThis.fetch=previousFetch;await m.putSetting("active_gateway","pagpixhub");}
});
await test("Digital Plowf checkout collects a real name only for the connection that requires it, without address or freight", async () => {
  const previousFetch=globalThis.fetch,posts=[];
  let requireName=true;
  globalThis.fetch=async (url,options={})=>{
    assert.ok(String(url).startsWith("https://app.plowf.com/api/v1/payments"));
    const body=JSON.parse(options.body);posts.push(body);
    if(requireName && !body.customer.name)return Response.json({errors:{"customer.name":["Required"]}},{status:422});
    assert.equal(body.customer.address,undefined);assert.equal(body.address,undefined);
    assert.equal(body.products.length,1);assert.equal(body.products[0].price,17.69);assert.equal(body.value,17.69);
    return Response.json({data:{uuid:crypto.randomUUID(),external_ref:body.external_ref,value:body.value,currency:"BRL",type:"PIX",status:"PENDING",payment:{payload:"mock-digital"}}},{status:201});
  };
  try {
    await m.putSetting("active_gateway","plowf");
    const connection=await m.setting("plowf_active_connection"), flag="plowf_requires_customer_name:"+connection;
    await m.putSetting(flag,"false");
    const id=m.randomToken("prd_");
    sqlite.prepare("INSERT INTO products(id,name,description,amount,image,shipping,delivery_days,product_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id,"Digital upsell","Test",1769,"unused",0,"","digital",m.now(),m.now());
    const product=await m.findProduct(id);
    assert.equal((await m.checkoutProduct(product)).requires_buyer_name,false);
    const original={attempt:crypto.randomUUID(),buyer:{email:"digital-plowf@example.com",cpf:"12345678909",phone:"11999999999"}};
    const rejected=await result(req("products/"+id+"/order","POST",original));
    assert.equal(rejected.body.error.code,"plowf_http_422");assert.equal(posts.length,1);
    assert.equal(await m.plowfRequiresBuyerName(connection),true);
    assert.equal((await result(req("products/"+id))).body.requires_buyer_name,true);
    for(const name of [undefined,"","  ","Ab",123]) {
      const missing=await result(req("products/"+id+"/order","POST",{attempt:crypto.randomUUID(),buyer:{...original.buyer,...(name===undefined?{}:{name})}}));
      assert.equal(missing.status,422);assert.equal(missing.body.error.code,"buyer_name_required");
    }
    assert.equal(posts.length,1,"missing names must be rejected before charging or reserving orders");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM product_orders WHERE product_id=?").get(id).n,1);
    const body={attempt:crypto.randomUUID(),buyer:{name:"Comprador de Teste",...original.buyer},shipping_method:"full"};
    const order=await result(req("products/"+id+"/order","POST",body));
    assert.equal(order.status,201);assert.equal(order.body.status,"PENDING");assert.equal(order.body.amount_cents,1769);assert.equal(order.body.product.shipping,0);
    assert.equal(posts[1].customer.name,body.buyer.name);
    const saved=sqlite.prepare("SELECT * FROM product_orders WHERE product_id=? ORDER BY created_at DESC").all(id).find(r=>JSON.parse(m.unseal(r.buyer,env.APP_ENCRYPTION_KEY)).name);
    assert.equal(JSON.parse(saved.snapshot).shipping,0);assert.equal(JSON.parse(m.unseal(saved.buyer,env.APP_ENCRYPTION_KEY)).address,undefined);
    await m.putSetting("active_gateway","pagpixhub");
    assert.equal((await m.checkoutProduct(product)).requires_buyer_name,false);
    const retry=await result(req("products/"+id+"/order","POST",body));assert.equal(retry.body.id,order.body.id);assert.equal(posts.length,2);
    await m.putSetting("active_gateway","plowf");
    const other="gw_"+"C".repeat(43);
    await m.putSetting("plowf_connection:"+other,await m.setting("plowf_connection:"+connection));
    await m.putSetting("plowf_active_connection",other);requireName=false;
    assert.equal((await m.checkoutProduct(product)).requires_buyer_name,false);
    const own=await result(req("products/"+id+"/order","POST",{...original,attempt:crypto.randomUUID()}));assert.equal(own.status,201);assert.equal(posts[2].customer.name,undefined);
    await m.putSetting("plowf_active_connection",connection);
  } finally {globalThis.fetch=previousFetch;await m.putSetting("active_gateway","pagpixhub");}
});
await test("Product reviews stay isolated, sanitize photos, survive editing and can be removed", async () => {
  sqlite.prepare("DELETE FROM rate_limits").run();
  const sharp = (await import("sharp")).default;
  const image = "data:image/png;base64," + (await sharp({create:{width:320,height:240,channels:3,background:"#20bb88"}}).png().toBuffer()).toString("base64");
  const product = {name:"Produto avaliações",description:"Teste local",amount:500,shipping:0,delivery_days:"Digital",product_type:"digital",active:true,image};
  const review = {id:crypto.randomUUID(),name:"Cliente de teste",rating:4,text:"Comentário deste produto.",photo:image};
  const a = await result(req("admin/products","POST",{...product,reviews:[review]}));
  assert.equal(a.status,201);assert.equal(a.body.reviews.length,1);
  const stored = a.body.reviews[0];
  assert.match(stored.photo,/^data:image\/jpeg;base64,/);
  const metadata = await sharp(Buffer.from(stored.photo.split(",")[1],"base64")).metadata();
  assert.equal(metadata.width,160);assert.equal(metadata.height,160);assert.equal(metadata.exif,undefined);
  const b = await result(req("admin/products","POST",product));
  assert.equal(b.status,201);assert.deepEqual(b.body.reviews,[]);
  assert.deepEqual((await result(req("products/"+a.body.id))).body.reviews,[stored]);
  assert.deepEqual((await result(req("products/"+b.body.id))).body.reviews,[]);
  globalThis.__testUser = null;
  assert.equal((await run(req("admin/products/"+a.body.id))).status,401);
  assert.equal((await run(req("admin/products/"+a.body.id,"POST",{...product,reviews:[]}))).status,401);
  globalThis.__testUser = owner;
  assert.deepEqual((await result(req("admin/products/"+a.body.id))).body.reviews,[stored]);
  assert.deepEqual((await result(req("admin/products/"+a.body.id,"POST",product))).body.reviews,[stored],"older clients omitting reviews must preserve them");
  const edited = {...stored,name:"Nome atualizado",rating:2,text:"Comentário atualizado."};
  const second = {...review,id:crypto.randomUUID(),name:"Outra pessoa",photo:""};
  assert.deepEqual((await result(req("admin/products/"+a.body.id,"POST",{...product,reviews:[second,edited]}))).body.reviews,[second,edited]);
  assert.deepEqual((await result(req("products/"+b.body.id))).body.reviews,[],"editing one product must never change another");
  for (const invalid of [
    [{...review,rating:0}], [{...review,rating:6}], [{...review,rating:2.5}], [{...review,name:" "}], [{...review,text:" "}],
    [review,review], Array.from({length:9},()=>({...review,id:crypto.randomUUID()})),
    [{...review,photo:"https://other.example/photo.jpg"}], [{...review,photo:"data:image/svg+xml;base64,PHN2Zz4="}],
    [{...review,photo:"data:image/png;base64,aW52YWxpZA=="}],
  ]) assert.equal((await run(req("admin/products/"+a.body.id,"POST",{...product,reviews:invalid}))).status,422);
  assert.deepEqual((await result(req("products/"+a.body.id))).body.reviews,[second,edited],"invalid writes must leave existing reviews intact");
  assert.deepEqual((await result(req("admin/products/"+a.body.id,"POST",{...product,reviews:[]}))).body.reviews,[]);
  assert.deepEqual((await result(req("products/"+a.body.id))).body.reviews,[]);
});


await test("BravoPay: saved drafts, isolated activation, idempotent Pix, signed webhooks and original account routing", async () => {
  const previousFetch=globalThis.fetch, active=await m.setting('active_gateway');
  const tokenA='bp_live_bravo_test_A', tokenB='bp_live_bravo_test_B', secretA='whsec_bravo_test_secret_A',secretB='whsec_bravo_test_secret_B';
  const rows=new Map(), posts=[], reads=[];
  let lost=false, badRead=false, accountFailure=false, createFailure=false;
  const payload={amount_cents:5790,description:'Produto de teste',external_reference:'bravo-order',customer:{email:'bravo@example.com'},expires_in:3600};
  globalThis.fetch=async(url,options={})=>{
    const u=new URL(url);if(u.origin!=='https://bravopay.club')return previousFetch(url,options);
    assert.equal(options.redirect,'error');const token=options.headers.Authorization.replace('Bearer ','');
    assert.ok([tokenA,tokenB].includes(token));
    if(u.pathname.endsWith('/me'))return accountFailure?Response.json({error:token},{status:401}):Response.json({id:'user_'+token});
    if(options.method==='POST'){
      const body=JSON.parse(options.body),key=options.headers['Idempotency-Key'];posts.push({token,body,key});
      if(createFailure)return Response.json({error:{message:'private-secret-'+token}},{status:422});
      const id='tx_bravo_'+key;
      if(!rows.has(id))rows.set(id,{token,raw:{id,method:'PIX',currency:'BRL',status:'PENDING',amount_cents:body.amount_cents,fee_cents:99,net_cents:body.amount_cents-99,external_reference:body.external_reference,pix:{copy_paste:'bravo-test-pix',expires_at:new Date(Date.now()+3600000).toISOString()}}});
      if(lost)throw Error('Lost response after upstream commit');
      return Response.json(rows.get(id).raw);
    }
    if(u.pathname.endsWith('/transactions'))return Response.json({data:[...rows.values()].filter(r=>r.token===token && r.raw.external_reference===u.searchParams.get('external_reference')).map(r=>r.raw),has_more:false});
    reads.push({token,id:u.pathname.split('/').pop()});
    const row=rows.get(u.pathname.split('/').pop());assert.equal(row?.token,token);
    if(badRead)return Response.json({...row.raw,amount_cents:1});
    return Response.json(row.raw);
  };
  const stored=id=>sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(id);
  const hook=(connection,secret,raw,t=Math.floor(Date.now()/1000),alias=false)=>req('webhooks/bravopay/'+connection,'POST',raw,undefined,{[alias?'X-Bravopay-Signature':'BravoPay-Signature']:`t=${t},v1=${createHmac('sha256',secret).update(t+'.'+raw).digest('hex')}`});
  try {
    globalThis.__testUser=null;assert.equal((await run(req('admin/gateways/bravopay','POST',{token:tokenA}))).status,401);globalThis.__testUser=owner;
    assert.equal((await run(req('admin/gateways/bravopay','POST',{token:tokenA},undefined,{Origin:'https://evil.example'}))).status,403);
    assert.equal((await run(req('admin/gateways/active','POST',{gateway:'bravopay'}))).status,422);
    assert.equal((await run(req('admin/gateways/bravopay','POST',{}))).status,422);
    accountFailure=true;assert.equal((await run(req('admin/gateways/bravopay','POST',{token:tokenA}))).status,502);accountFailure=false;
    const draft=await result(req('admin/gateways/bravopay','POST',{token:tokenA}));assert.equal(draft.status,200);
    const connectionA=draft.body.webhook_url.split('/').pop();
    assert.equal((await m.gatewayOverview()).active,active);
    assert.equal((await m.bravoOverview()).webhook_configured,false);
    assert.equal((await run(req('admin/gateways/active','POST',{gateway:'bravopay'}))).status,422);
    const complete=await result(req('admin/gateways/bravopay','POST',{webhook_secret:secretA}));assert.equal(complete.status,200);assert.equal(complete.body.webhook_url,draft.body.webhook_url);
    const sealed=await m.setting('bravopay_connection:'+connectionA);assert.ok(!sealed.includes(tokenA));assert.ok(!sealed.includes(secretA));
    assert.equal((await result(req('admin/gateways/bravopay','POST',{token:'',webhook_secret:''}))).body.webhook_url,draft.body.webhook_url);
    const overview=JSON.stringify(await m.gatewayOverview());assert.ok(!overview.includes(tokenA));assert.ok(!overview.includes(secretA));
    await m.activateGateway({gateway:'bravopay'},owner.email);
    const pagCalls=upstreamCalls;
    const tx=await m.createCharge('dashboard',payload,'bravo-charge-one');assert.equal(tx.gateway,'bravopay');assert.equal(tx.pix.copy_paste,'bravo-test-pix');assert.equal(posts.length,1);assert.equal(upstreamCalls,pagCalls);
    assert.equal(posts[0].key,tx.id);assert.equal(posts[0].body.method,'pix');assert.equal(posts[0].body.customer.name,undefined);assert.equal(posts[0].body.external_reference,tx.id);
    assert.equal(stored(tx.id).gateway_connection,connectionA);
    assert.equal((await m.createCharge('dashboard',payload,'bravo-charge-one')).id,tx.id);assert.equal(posts.length,1);
    await assert.rejects(()=>m.createCharge('dashboard',{...payload,amount_cents:50000001},'bravo-too-large'),e=>e.code==='bravopay_amount');assert.equal(posts.length,1);
    await assert.rejects(()=>m.createCharge('dashboard',{...payload,amount_cents:5800},'bravo-charge-one'),e=>e.code==='idempotency_conflict');
    const entry=rows.get(stored(tx.id).provider_id.replace('bravopay:',''));
    for(const corrupt of [{amount_cents:5800},{external_reference:'wrong'},{id:'wrong'},{currency:'USD'},{method:'CARD'},{pix:{expires_at:'invalid'}}])assert.throws(()=>m.normalizeBravo({...entry.raw,...corrupt},stored(tx.id)));
    const raw=JSON.stringify({id:'evt_bravo_paid',type:'transaction.paid',data:{id:entry.raw.id,external_reference:tx.id}});
    assert.equal((await run(hook(connectionA,'wrong-secret',raw))).status,401);
    assert.equal((await run(hook(connectionA,secretA,raw,Math.floor(Date.now()/1000)-301))).status,401);
    assert.equal((await run(hook(connectionA,secretA,raw,Math.floor(Date.now()/1000)+301))).status,401);
    const beforeReads=reads.length;
    assert.equal((await run(hook(connectionA,secretA,raw))).status,200);assert.equal(reads.length,beforeReads);assert.equal(stored(tx.id).status,'PENDING');
    entry.raw.status='PAID';entry.raw.paid_at=new Date().toISOString();
    badRead=true;await m.processGatewayEvents();assert.equal(stored(tx.id).status,'PENDING');badRead=false;
    sqlite.prepare("UPDATE gateway_events SET next_at=0 WHERE id LIKE 'bravopay:%'").run();await m.processGatewayEvents();assert.equal(stored(tx.id).status,'PAID');
    const readCount=reads.length;assert.equal((await run(hook(connectionA,secretA,raw,Math.floor(Date.now()/1000),true))).status,200);await m.processGatewayEvents();assert.equal(reads.length,readCount);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gateway_events WHERE id LIKE 'bravopay:%'").get().n,1);
    // An edit never changes the active account, and drafts retain a stable URL when completing the secret.
    const next=await m.saveBravo({token:tokenB},owner.email),connectionB=next.webhook_url.split('/').pop();assert.notEqual(connectionA,connectionB);assert.equal((await m.bravoOverview()).active_connection,connectionA);assert.equal((await m.bravoOverview()).webhook_configured,false);
    assert.equal((await m.saveBravo({webhook_secret:secretB},owner.email)).webhook_url,next.webhook_url);
    await m.activateGateway({gateway:'bravopay'},owner.email);
    await m.sync(stored(tx.id));assert.equal(reads.at(-1).token,tokenA);assert.equal(await m.setting('bravopay_connection:'+connectionA),sealed);
    const wrongConnection=JSON.stringify({id:'evt_wrong_account',type:'transaction.refunded',data:{id:entry.raw.id,external_reference:tx.id}});
    await run(hook(connectionB,secretB,wrongConnection));await m.processGatewayEvents();assert.equal(stored(tx.id).status,'PAID');assert.equal(reads.at(-1).token,tokenA);
    // Lost POST response: same upstream key, same transaction, no fallback to another gateway.
    lost=true;await assert.rejects(()=>m.createCharge('dashboard',payload,'bravo-timeout-test'),e=>e.code==='bravopay_unavailable');
    const uncertain=sqlite.prepare('SELECT * FROM transactions WHERE idempotency_key=?').get('bravo-timeout-test');
    await m.activateGateway({gateway:'pagpixhub'},owner.email);lost=false;
    const retry=await m.createCharge('dashboard',payload,'bravo-timeout-test');assert.equal(retry.id,uncertain.id);assert.equal(posts.at(-1).key,posts.at(-2).key);assert.equal(posts.at(-1).token,tokenB);assert.equal(retry.gateway,'bravopay');
    await m.activateGateway({gateway:'bravopay'},owner.email);
    lost=true;await assert.rejects(()=>m.createCharge('dashboard',payload,'bravo-reconcile-test'));lost=false;
    const unresolved=sqlite.prepare('SELECT * FROM transactions WHERE idempotency_key=?').get('bravo-reconcile-test');const count=posts.length;
    assert.equal((await m.reconcileCharge(unresolved)).status,'PENDING');assert.equal(posts.length,count);
    const concurrent=await Promise.allSettled([m.createCharge('dashboard',payload,'bravo-concurrent'),m.createCharge('dashboard',payload,'bravo-concurrent')]);assert.ok(concurrent.some(x=>x.status==='fulfilled'));assert.equal(posts.length,count+1);
    createFailure=true;await assert.rejects(()=>m.createCharge('dashboard',payload,'bravo-rejected'),e=>e.code==='bravopay_http_422' && !e.message.includes('private'));createFailure=false;
    await assert.rejects(()=>m.activateGateway({gateway:'none',expected_gateway:'plowf'},owner.email),e=>e.code==='gateway_changed');
    await m.activateGateway({gateway:'none',expected_gateway:'bravopay'},owner.email);await assert.rejects(()=>m.createCharge('dashboard',payload,'bravo-paused'),e=>e.code==='gateway_disabled');
    await m.activateGateway({gateway:'bravopay'},owner.email);assert.equal((await m.bravoOverview()).current,connectionB);
    assert.equal((await m.createCharge('dashboard',payload,'bravo-charge-one')).status,'PAID');
  } finally {globalThis.fetch=previousFetch;globalThis.__testUser=owner;await m.putSetting('active_gateway',active || 'pagpixhub');}
});

const broskiSecret = 'whbroski_' + randomBytes(24).toString('hex');
const broskiEvent = (id = 'ord_portugal', changes = {}) => ({
  id: 'evt_portugal', type: 'order.paid', created: Math.floor(Date.now()/1000),
  data: { object: { object: 'order', id, status: 'paid', amount: 1990, currency: 'EUR', method: 'mbway', livemode: true, ...changes } },
});
const broskiHook = (event, signature) => {
  const raw = JSON.stringify(event);
  return req('webhooks/broski','POST',raw,undefined,{'Broski-Signature': signature ?? m.sign(raw,broskiSecret)});
};
await test('Broski configuration requires admin/origin, encrypts the secret and preserves the BR gateway', async () => {
  sqlite.exec('DELETE FROM rate_limits');
  const active = await m.setting('active_gateway');
  globalThis.__testUser = null;
  assert.equal((await run(req('admin/notifications/broski'))).status,401);
  assert.equal((await run(req('admin/notifications/broski','POST',{enabled:true,webhook_secret:broskiSecret}))).status,401);
  globalThis.__testUser = owner;
  assert.equal((await run(req('admin/notifications/broski','POST',{enabled:true,webhook_secret:broskiSecret},undefined,{Origin:'https://evil.example'}))).status,403);
  const initial = (await result(req('admin/notifications/broski'))).body;
  assert.equal(initial.configured,false);
  assert.equal(initial.webhook_url,env.APP_ORIGIN+'/api/webhooks/broski');
  assert.equal((await run(req('admin/notifications/broski','POST',{enabled:true}))).status,422);
  const saved = await result(req('admin/notifications/broski','POST',{enabled:true,webhook_secret:broskiSecret}));
  assert.equal(saved.status,200);assert.equal(saved.body.enabled,true);
  assert.ok(!JSON.stringify(saved.body).includes(broskiSecret));
  const encrypted = await m.setting('broski_notifications');
  assert.ok(!encrypted.includes(broskiSecret));
  assert.equal(JSON.parse(m.unseal(encrypted,env.APP_ENCRYPTION_KEY)).secret,broskiSecret);
  assert.equal(await m.setting('active_gateway'),active);
});
await test('Broski accepts only signed real EUR paid orders, deduplicates orders and never changes financial/tracking totals', async () => {
  const vector = '{"id":"evt_teste123","type":"order.paid","created":1750000000,"data":{"object":{"id":"ord_teste123","status":"paid"}}}';
  assert.ok(m.verify(vector,'t=1750000000,v1=5fb448226598b14dea45ff94ee317c2c1edd464f87cd720b0d8673ea89731d4c','whbroski_vetor_de_teste_nao_usar_em_producao',1750000000));
  const transactions = sqlite.prepare('SELECT COUNT(*) n,SUM(amount) total FROM transactions').get();
  const tracking = sqlite.prepare('SELECT COUNT(*) n FROM tracking_events').get();
  assert.equal((await run(broskiHook(broskiEvent(),'invalid'))).status,401);
  assert.equal((await run(broskiHook(broskiEvent(),m.sign(JSON.stringify(broskiEvent()),broskiSecret,Math.floor(Date.now()/1000)-301)))).status,401);
  assert.equal((await run(broskiHook(broskiEvent('altered'),m.sign(JSON.stringify(broskiEvent()),broskiSecret)))).status,401);
  assert.equal((await run(broskiHook({id:'evt_unknown',type:'future.event'}))).status,200);
  assert.equal((await run(broskiHook({...broskiEvent(),type:'order.awaiting_payment'}))).status,200);
  for(const change of [{livemode:false},{currency:'BRL'},{status:'pending'}])
    assert.equal((await run(broskiHook(broskiEvent('ignored',change)))).status,200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_events WHERE external_source='broski'").get().n,0);
  for(const change of [{amount:0},{amount:1.5},{object:'payout'}])
    assert.equal((await run(broskiHook(broskiEvent('invalid',change)))).status,422);
  // Signed webhooks work without a dashboard session.
  globalThis.__testUser = null;
  const attempts = await Promise.all([run(broskiHook(broskiEvent())),run(broskiHook({...broskiEvent(),id:'evt_retry_different_id'}))]);
  assert.ok(attempts.every(r=>r.status===200));
  globalThis.__testUser = owner;
  assert.equal((await run(broskiHook(broskiEvent('ord_multibanco',{method:'multibanco',amount:4990})))).status,200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_events WHERE external_source='broski'").get().n,2);
  assert.deepEqual(sqlite.prepare('SELECT COUNT(*) n,SUM(amount) total FROM transactions').get(),transactions);
  assert.deepEqual(sqlite.prepare('SELECT COUNT(*) n FROM tracking_events').get(),tracking);
  await run(req('admin/notifications/broski','POST',{enabled:false}));
  assert.equal((await run(broskiHook(broskiEvent('disabled')))).status,200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_events WHERE external_source='broski'").get().n,2);
  assert.equal((await result(req('admin/notifications/broski'))).body.configured,true);
  await run(req('admin/notifications/broski','POST',{enabled:true,webhook_secret:''}));
});
await test('Broski notifications deliver in EUR with retries while BRL notification formatting is preserved', async () => {
  await m.savePushSubscription(device,owner.email);
  sqlite.exec("UPDATE push_subscriptions SET created_at=0; UPDATE push_events SET fanout_at=1 WHERE external_source IS NULL; UPDATE push_deliveries SET sent_at=1");
  const originalFetch=globalThis.fetch;
  let status=500, sends=0;
  globalThis.fetch=async(url)=>{assert.equal(String(url),device.endpoint);sends++;return new Response(null,{status});};
  try {
    await m.dispatchPush();assert.equal(sends,2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM push_deliveries d JOIN push_events e ON e.id=d.event_id WHERE e.external_source='broski' AND d.sent_at IS NULL").get().n,2);
    await m.dispatchPush();assert.equal(sends,2);
    sqlite.exec("UPDATE push_deliveries SET next_at=0 WHERE event_id LIKE 'broski:%'");status=201;
    await Promise.all([m.dispatchPush(),m.dispatchPush()]);assert.equal(sends,4);
    await run(broskiHook(broskiEvent()));await m.dispatchPush();assert.equal(sends,4);
    for(const method of ['mbway','multibanco']) {
      const payload=m.paymentPushPayload({event:'PAID',transaction_id:'external',amount:1990,external_source:'broski',external_method:method});
      assert.match(payload.body,/19,90\s*€/);assert.match(payload.title,/Portugal/);
      assert.ok(payload.body.includes(method==='mbway'?'MB WAY':'Multibanco'));
      assert.equal(payload.url,'/topsdlsodo?section=Gateways');
    }
    const brazil=m.paymentPushPayload({event:'PENDING',transaction_id:'br',amount:1990});
    assert.match(brazil.body,/R\$\s*19,90/);assert.equal(brazil.title,'Transação Pendente!');
  } finally {globalThis.fetch=originalFetch;}
});

await test('Panel notifications start without historical alerts and share bounded authenticated updates', async () => {
  sqlite.exec('DELETE FROM rate_limits');
  const first = await result(req('admin/overview'));
  assert.equal(first.status,200);assert.deepEqual(first.body.notifications.events,[]);
  const cursor = first.body.notifications.cursor;
  assert.ok(Number.isSafeInteger(cursor));
  await run(broskiHook(broskiEvent('ord_in_app',{amount:2790})));
  const update = await result(req('admin/analytics?notification_cursor='+cursor));
  assert.equal(update.status,200);
  const feed=update.body.notifications;
  assert.equal(feed.events.length,1);assert.equal(feed.events[0].currency,'EUR');
  assert.equal(feed.events[0].event,'PAID');assert.equal(feed.events[0].amount,2790);
  assert.deepEqual(Object.keys(feed.events[0]).sort(),['amount','created_at','currency','event','id','sequence','source']);
  const next=await result(req('admin/overview?notification_cursor='+feed.cursor));
  assert.deepEqual(next.body.notifications.events,[]);
  const reopened=await result(req('admin/overview'));
  assert.deepEqual(reopened.body.notifications.events,[]);
  // A late insert after a cursor is observed is not lost, even for an old order.
  sqlite.prepare("INSERT INTO push_events(id,transaction_id,event,created_at) VALUES (?,?,'PAID',?)").run('panel-old-order',pushTx.id,Date.now());
  const older=await result(req('admin/overview?notification_cursor='+feed.cursor));
  assert.ok(older.body.notifications.events.some(e=>e.id==='panel-old-order'&&e.currency==='BRL'));
  // Suppress expired notifications and pending events after approval.
  const before=older.body.notifications.cursor;
  sqlite.prepare("INSERT INTO push_events(id,transaction_id,event,created_at) VALUES (?,?,'PENDING',?)").run('panel-stale-pending',pushTx.id,Date.now());
  sqlite.prepare("INSERT INTO push_events(id,transaction_id,event,created_at) VALUES (?,?,'PAID',?)").run('panel-stale-paid',pushTx.id,Date.now()-180000);
  const stale=await result(req('admin/overview?notification_cursor='+before));
  assert.deepEqual(stale.body.notifications.events,[]);assert.ok(stale.body.notifications.cursor>before);
  assert.equal((await run(req('admin/overview?notification_cursor=NaN'))).status,422);
  globalThis.__testUser=null;
  assert.equal((await run(req('admin/overview?notification_cursor=0'))).status,401);
  assert.equal((await run(req('admin/analytics?notification_cursor=0'))).status,401);
  globalThis.__testUser=owner;
  const plan=sqlite.prepare('EXPLAIN QUERY PLAN SELECT rowid,id FROM push_events WHERE rowid>? ORDER BY rowid LIMIT 50').all(1);
  assert.ok(plan.some(row=>row.detail.includes('INTEGER PRIMARY KEY')));
});

await test('Sales Pix review persists independently of payment and only authorized admins can change it', async () => {
  sqlite.exec('DELETE FROM rate_limits');
  const customer={name:'Review buyer',email:'review@example.com',phone:'11912345678',cpf:'12345678909'};
  sqlite.prepare('UPDATE transactions SET customer=?,created_at=? WHERE id=?').run(m.seal(JSON.stringify(customer),env.APP_ENCRYPTION_KEY),Date.now(),pushTx.id);
  const path='admin/transactions/'+pushTx.id+'/pix-review';
  const before=sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(pushTx.id);
  const events=sqlite.prepare('SELECT COUNT(*) AS n FROM push_events').get().n;
  const tracking=sqlite.prepare('SELECT COUNT(*) AS n FROM tracking_events').get().n;
  const marked=await result(req(path,'POST',{reviewed:true}));
  assert.equal(marked.status,200);assert.ok(marked.body.pix_reviewed_at>0);
  const again=await result(req(path,'POST',{reviewed:true}));
  assert.equal(again.body.pix_reviewed_at,marked.body.pix_reviewed_at);
  const after=sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(pushTx.id);
  assert.deepEqual({...after,pix_reviewed_at:null},{...before,pix_reviewed_at:null});
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM push_events').get().n,events);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM tracking_events').get().n,tracking);
  const listed=(await result(req('admin/overview'))).body.transactions.find(t=>t.id===pushTx.id);
  assert.equal(listed.copy_paste,before.copy_paste);
  assert.equal(listed.customer.phone,customer.phone);assert.equal(listed.customer.cpf,undefined);
  assert.equal(listed.pix_reviewed_at,marked.body.pix_reviewed_at);
  assert.equal((await result(req(path,'POST',{reviewed:false}))).body.pix_reviewed_at,null);
  assert.equal((await run(req(path,'POST',{reviewed:'yes'}))).status,422);
  assert.equal((await run(req(path,'POST',{reviewed:true,status:'PAID'}))).status,422);
  assert.equal((await run(req('admin/transactions/missing/pix-review','POST',{reviewed:true}))).status,404);
  assert.equal((await run(req(path,'POST',{reviewed:true},undefined,{Origin:'https://evil.example'}))).status,403);
  globalThis.__testUser=null;
  assert.equal((await run(req(path,'POST',{reviewed:true}))).status,401);
  globalThis.__testUser={...owner,email:'outsider@example.com'};
  assert.equal((await run(req(path,'POST',{reviewed:true}))).status,403);
  globalThis.__testUser=owner;
  assert.equal(sqlite.prepare('SELECT pix_reviewed_at FROM transactions WHERE id=?').get(pushTx.id).pix_reviewed_at,null);
});

await test('Brazilian checkout phone keeps full digits and distinguishes country 55 from DDD 55', () => {
  for (const [input,expected] of [
    ['11987654321','11987654321'],['5511987654321','11987654321'],['+55 (11) 98765-4321','11987654321'],
    ['1132345678','1132345678'],['551132345678','1132345678'],['(55) 99876-5432','55998765432'],
    ['5555998765432','55998765432'],['5532345678','5532345678'],['+55 55 3234-5678','5532345678'],
  ]) { assert.equal(m.normalizeBrazilPhone(input),expected);assert.equal(m.normalizeBrazilPhone(m.formatPhone(input)),expected); }
  assert.equal(m.normalizeBrazilPhone('+55 11 12345'),'1112345');
  assert.equal(m.normalizeBrazilPhone(m.formatPhone('11987654321000')),'11987654321000');
  assert.equal(m.formatPhone('5511987654321'),'(11) 98765-4321');
});

await test('Plowf own and marketplace profiles validate seller, preserve webhook and freeze each payment request', async () => {
  sqlite.exec('DELETE FROM rate_limits');
  const previousFetch=globalThis.fetch, posts=[], token='profile_test_token', secret='profile_test_webhook_secret';
  const original={active:await m.setting('active_gateway'),current:await m.setting('plowf_connection'),selected:await m.setting('plowf_active_connection')};
  let webhookUrl;
  globalThis.fetch=async(url,options={})=>{
    const u=new URL(url);if(u.origin!=='https://app.plowf.com')return previousFetch(url,options);
    if(u.pathname.endsWith('/providers'))return Response.json({data:[]});
    if(u.pathname.endsWith('/webhooks'))return Response.json({data:[{url:webhookUrl,token:secret,status:'ACTIVE',events:['PAYMENT']}]});
    assert.equal(options.method,'POST');const body=JSON.parse(options.body);posts.push(body);
    assert.ok(body.products?.length);assert.equal(body.products.reduce((sum,p)=>sum+Math.round(p.price*100)*p.quantity,0),Math.round(body.value*100));
    return Response.json({data:{uuid:crypto.randomUUID(),external_ref:body.external_ref,value:body.value,currency:'BRL',type:'PIX',status:'PENDING',payment:{payload:'profile-mock-pix'}}},{status:201});
  };
  try {
    const saved=await m.savePlowf({token,webhook_secret:secret},owner.email);webhookUrl=saved.webhook_url;
    const id=await m.setting('plowf_connection'),key='plowf_connection:'+id,credentials=await m.setting(key);
    await m.activateGateway({gateway:'plowf'},owner.email);
    const path='admin/gateways/plowf/profile',input={connection_id:id,mode:'marketplace',document:'11.222.333/0001-81'};
    globalThis.__testUser=null;assert.equal((await run(req(path,'POST',input))).status,401);globalThis.__testUser=owner;
    assert.equal((await run(req(path,'POST',input,undefined,{Origin:'https://evil.example'}))).status,403);
    assert.equal((await run(req(path,'POST',{...input,document:'11111111111111'}))).status,422);
    assert.equal((await run(req(path,'POST',{...input,document:''}))).status,422);
    const productId='prd_'+ 'M'.repeat(43);
    sqlite.prepare("INSERT INTO products(id,name,description,amount,image,shipping,delivery_days,product_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(productId,'Real test item','',500,'',0,'','digital',Date.now(),Date.now());
    const buyer={name:'Fixture buyer',email:'buyer@example.com',cpf:'12345678909',phone:'11999999999'};
    const charge=async(label,shipping=0)=>{
      sqlite.prepare('INSERT INTO product_orders(id,product_id,request_hash,snapshot,buyer,created_at) VALUES(?,?,?,?,?,?)').run(label,productId,'fixture',JSON.stringify({name:'Real test item',amount:500,shipping,shipping_method:'full'}),'fixture',Date.now());
      const data={amount_cents:500+shipping,description:'Real test item',external_reference:label,customer:buyer};
      return {data,tx:await m.createCharge('product:'+productId,data,label)};
    };
    const own=await charge('profile-own-sale');assert.equal(posts[0].final_beneficiary,undefined);
    assert.equal((await run(req(path,'POST',input))).status,200);
    assert.equal(await m.setting(key),credentials);assert.equal(await m.setting('plowf_connection'),id);assert.equal(await m.setting('plowf_active_connection'),id);
    assert.equal((await m.gatewayOverview()).plowf.webhook_url,webhookUrl);
    assert.equal(await m.checkoutRequiresBuyerName(),true);
    const missingName=await run(req('products/'+productId+'/order','POST',{attempt:crypto.randomUUID(),buyer:{email:buyer.email,cpf:buyer.cpf,phone:buyer.phone}}));
    assert.equal(missingName.status,422);assert.equal(posts.length,1);
    await assert.rejects(()=>m.createCharge('dashboard',{...own.data,external_reference:'avulsa'},'marketplace-avulsa'),e=>e.code==='plowf_products_required');
    const digital=await charge('profile-digital-sale'),physical=await charge('profile-physical-sale',998);
    for(const body of posts.slice(1)){assert.deepEqual(body.final_beneficiary,{document:'11222333000181'});assert.equal(body.customer.document,buyer.cpf);assert.equal(body.customer.name,buyer.name);}
    assert.equal(posts[1].products.length,1);assert.equal(posts[2].products.length,2);
    const profileCipher=sqlite.prepare('SELECT plowf_profile FROM transactions WHERE id=?').get(digital.tx.id).plowf_profile;
    assert.ok(!profileCipher.includes('11222333000181'));assert.equal(m.decodePlowfProfile(profileCipher).beneficiary.document,'11222333000181');
    assert.ok(!JSON.stringify(digital.tx).includes('11222333000181'));
    const summary=(await result(req('admin/gateways'))).body.plowf.sales_profile;
    assert.deepEqual(summary,{mode:'marketplace',document_last4:'0181'});
    assert.equal((await run(req(path,'POST',{...input,document:''}))).status,200);
    await m.savePlowfProfile({connection_id:id,mode:'own'},owner.email);
    assert.equal(await m.checkoutRequiresBuyerName('profile-digital-sale'),true);
    assert.equal(await m.checkoutRequiresBuyerName('profile-own-sale'),false);
    assert.equal((await m.createCharge('product:'+productId,digital.data,'profile-digital-sale')).id,digital.tx.id);
    assert.equal(posts.length,3);
    assert.equal(m.decodePlowfProfile(profileCipher).mode,'marketplace');
    const direct=await charge('profile-own-again');assert.equal(posts.at(-1).final_beneficiary,undefined);
    const next=await m.savePlowf({token:'profile_different_token',webhook_secret:secret},owner.email);
    assert.notEqual(next.webhook_url,webhookUrl);
    assert.equal((await m.gatewayOverview()).plowf.sales_profile.mode,'own');
    assert.equal((await run(req(path,'POST',input))).status,409);
    assert.equal((await m.plowfProfile(id)).mode,'own');
  } finally {
    globalThis.fetch=previousFetch;globalThis.__testUser=owner;
    await m.putSetting('active_gateway',original.active);await m.putSetting('plowf_connection',original.current);await m.putSetting('plowf_active_connection',original.selected);
  }
});


await test("TrackerOrder is tenant-local, encrypted and protected by admin and origin checks", async () => {
  const path='admin/integrations/trackerorder',config={enabled:true,token:'fixture-bearer-token-not-real',webhook_key:'fixture-project-key-123456'};
  const fetchBefore=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No request expected during configuration');};
  try {
    assert.equal((await m.trackerOrderOverview()).enabled,false);
    globalThis.__testUser=null;assert.equal((await run(req(path,'POST',config))).status,401);globalThis.__testUser=owner;
    assert.equal((await run(req(path,'POST',config,undefined,{Origin:'https://evil.example'}))).status,403);
    assert.equal((await run(req(path,'POST',{enabled:true}))).status,422);
    const saved=await result(req(path,'POST',config));assert.equal(saved.status,200);
    assert.equal(saved.body.enabled,true);assert.ok(!JSON.stringify(saved.body).includes(config.webhook_key));
    const sealed=await m.setting('trackerorder_config');assert.ok(!sealed.includes(config.token));assert.ok(!sealed.includes(config.webhook_key));
    assert.equal(await m.checkoutRequiresBuyerName(),true);
    const since=await m.setting('trackerorder_enabled_since');await m.saveTrackerOrder({enabled:true},owner.email);assert.equal(await m.setting('trackerorder_enabled_since'),since);
    assert.equal(calls,0,'saving settings must not create orders');
  } finally {globalThis.fetch=fetchBefore;globalThis.__testUser=owner;}
});

function trackerFixture(gateway='pagpixhub', options={}) {
  const id=m.randomToken('tx_'),pid=m.randomToken('prd_'),order='ord_'+m.hash(id),at=Date.now();
  const buyer={name:'Fixture Customer',email:'fixture@example.com',phone:'+55 (11) 99876-5432',cpf:'12345678909',address:{street:'Do not send address'}};
  if(options.missingName) delete buyer.name;
  const snapshot={name:'Original sold product',amount:1499,shipping:1995,product_type:options.digital?'digital':'physical'};
  sqlite.prepare('INSERT INTO product_orders(id,product_id,request_hash,snapshot,buyer,created_at) VALUES(?,?,?,?,?,?)').run(order,pid,'fixture',JSON.stringify(snapshot),m.seal(JSON.stringify(buyer),env.APP_ENCRYPTION_KEY),at);
  sqlite.prepare("INSERT INTO transactions(id,key_id,idempotency_key,request_hash,provider_id,external_reference,amount,status,description,customer,checkout_hash,checkout_token,created_at,updated_at,gateway) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,options.manual?'dashboard':'product:'+pid,order,'fixture','provider:'+id,order,3494,'PENDING','Changed gateway description',m.seal(JSON.stringify(buyer),env.APP_ENCRYPTION_KEY),m.hash(id),m.seal(m.randomToken('co_'),env.APP_ENCRYPTION_KEY),at,at,gateway);
  const tx=sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(id);
  return {id,order,tx,provider:{id:tx.provider_id,amount_cents:3494,status:'PAID'}};
}
await test("TrackerOrder queues confirmed product payments from all gateways once, with frozen items and no extra PII",async()=>{
  const original=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,opts)=>{assert.equal(String(url),'https://api.trackerorders.online/functions/v1/create-order');requests.push(JSON.parse(opts.body));assert.equal(opts.redirect,'error');assert.match(opts.headers.Authorization,/^Bearer /);return Response.json({success:true,tracking_code:'TRACK-'+requests.length,pending_credits:false},{status:201});};
  try {
    const fixtures=[];
    for(const gateway of ['plowf','bravopay','pagpixhub']){
      const f=trackerFixture(gateway);fixtures.push(f);
      await m.applyProvider(f.tx,{...f.provider,status:'PENDING'});
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM trackerorder_jobs WHERE transaction_id=?').get(f.id).n,0);
      await m.applyProvider(f.tx,f.provider);await m.applyProvider(f.tx,f.provider);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM trackerorder_jobs WHERE transaction_id=?').get(f.id).n,1);
    }
    assert.equal(requests.length,0,'payment application must not wait for TrackerOrder network');
    await Promise.all([m.dispatchTrackerOrders(5),m.dispatchTrackerOrders(5)]);
    assert.equal(requests.length,3);
    for(const body of requests){assert.equal(body.customer_phone,'+5511998765432');assert.equal(body.total_value,34.94);assert.deepEqual(JSON.parse(body.order_items),[{name:'Original sold product',qty:1,price:14.99},{name:'Frete',qty:1,price:19.95}]);assert.equal(body.email_flow_enabled,true);assert.equal(body.customer_cpf,undefined);assert.equal(body.customer_address,undefined);assert.ok(fixtures.some(f=>f.order===body.external_order_id));}
    for(const f of fixtures){const tx=sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(f.id);assert.match(tx.trackerorder_code,/^TRACK-/);assert.equal(m.serialize(tx).tracking_code,tx.trackerorder_code);await m.applyProvider(tx,f.provider);}
    await m.dispatchTrackerOrders();assert.equal(requests.length,3);
    const manual=trackerFixture('plowf',{manual:true});await m.applyProvider(manual.tx,manual.provider);assert.equal(sqlite.prepare('SELECT * FROM trackerorder_jobs WHERE transaction_id=?').get(manual.id),undefined);
    const old=trackerFixture();await m.applyProvider(old.tx,{...old.provider,paid_at:new Date(0).toISOString()});assert.equal(sqlite.prepare('SELECT * FROM trackerorder_jobs WHERE transaction_id=?').get(old.id),undefined);
    const invalid=trackerFixture();await assert.rejects(()=>m.applyProvider(invalid.tx,{...invalid.provider,amount_cents:3500}));assert.equal(sqlite.prepare('SELECT * FROM trackerorder_jobs WHERE transaction_id=?').get(invalid.id),undefined);
  }finally{globalThis.fetch=original;}
});
await test("TrackerOrder preserves payment during failures and never blindly repeats uncertain delivery",async()=>{
  const original=globalThis.fetch;
  try{
    for(const scenario of ['timeout','html','server','rejected','credits','rate','missingName','refund']){
      const f=trackerFixture('plowf',{missingName:scenario==='missingName'});await m.applyProvider(f.tx,f.provider);
      if(scenario==='refund')await m.applyProvider(f.tx,{...f.provider,status:'REFUNDED'});
      let calls=0;globalThis.fetch=async()=>{calls++;if(scenario==='timeout')throw Error('timeout');if(scenario==='html')return new Response('unexpected HTML');if(scenario==='server')return new Response('',{status:500});if(scenario==='rejected')return new Response('',{status:401});if(scenario==='rate')return new Response('',{status:429});return Response.json({success:true,tracking_code:'TRACK-CREDITS',pending_credits:true});};
      await m.dispatchTrackerOrders();await m.dispatchTrackerOrders();
      const job=sqlite.prepare('SELECT * FROM trackerorder_jobs WHERE transaction_id=?').get(f.id);
      assert.equal(job.state,scenario==='credits'?'SENT':scenario==='rate'?'PENDING':scenario==='refund'?'CANCELLED':['missingName','rejected'].includes(scenario)?'FAILED':'REVIEW');
      assert.equal(calls,['missingName','refund'].includes(scenario)?0:1);
      assert.equal(sqlite.prepare('SELECT status FROM transactions WHERE id=?').get(f.id).status,scenario==='refund'?'REFUNDED':'PAID');
      if(scenario==='credits')assert.equal(job.pending_credits,1);
      if(scenario==='rate')sqlite.prepare("UPDATE trackerorder_jobs SET state='FAILED' WHERE transaction_id=?").run(f.id);
    }
    const lost=trackerFixture();await m.applyProvider(lost.tx,lost.provider);sqlite.prepare("UPDATE trackerorder_jobs SET state='SENDING',started_at=1 WHERE transaction_id=?").run(lost.id);
    let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};await m.dispatchTrackerOrders();assert.equal(calls,0);assert.equal(sqlite.prepare('SELECT state FROM trackerorder_jobs WHERE transaction_id=?').get(lost.id).state,'REVIEW');
    const paused=trackerFixture();await m.applyProvider(paused.tx,paused.provider);await m.saveTrackerOrder({enabled:false},owner.email);await m.dispatchTrackerOrders();assert.equal(calls,0);
    const disabled=trackerFixture();await m.applyProvider(disabled.tx,disabled.provider);assert.equal(sqlite.prepare('SELECT * FROM trackerorder_jobs WHERE transaction_id=?').get(disabled.id),undefined);
    await m.saveTrackerOrder({enabled:true,webhook_key:'different-project-key-123456'},owner.email);await m.dispatchTrackerOrders();assert.equal(calls,0);assert.equal(sqlite.prepare('SELECT last_error FROM trackerorder_jobs WHERE transaction_id=?').get(paused.id).last_error,'project_changed');
  }finally{globalThis.fetch=original;await m.saveTrackerOrder({enabled:false},owner.email);}
});

await test("Checkout quantities enforce server prices, freeze retries, preserve shipping and reach TrackerOrder/TikTok", async () => {
  const originalGateway=await m.setting('active_gateway');await m.putSetting('active_gateway','pagpixhub');
  const pixel='QUANTITYPIXEL0001';await m.saveTrackingPixel({pixel_id:pixel,access_token:'quantity-pixel-test-token',label:'Quantity fixture',is_active:true},owner.email);
  try {
    const pid=m.randomToken('prd_'),now=Date.now();
    sqlite.prepare("INSERT INTO products(id,name,description,amount,image,shipping,delivery_days,active,created_at,updated_at,product_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(pid,'Quantity product','',5790,'',500,'3 days',1,now,now,'physical');
    const buyer={name:'Quantity Fixture',email:'quantity@example.com',cpf:'12345678909',phone:'11999999999',address:{cep:'01001000',street:'Test Street',number:'1',complement:'',district:'Centro',city:'São Paulo',state:'SP'}};
    const body={attempt:crypto.randomUUID(),quantity:3,shipping_method:'full',buyer,tracking:{visit:crypto.randomUUID()}};
    const before=upstreamCalls;
    for(const quantity of [0,-1,1.5,100,1e9,'2',null]) assert.equal((await run(req('products/'+pid+'/order','POST',{...body,quantity}))).status,422);
    assert.equal(upstreamCalls,before);
    const created=await result(req('products/'+pid+'/order','POST',body));assert.equal(created.status,202);assert.equal(created.body.amount_cents,18368);assert.equal(created.body.product.quantity,3);assert.equal(created.body.product.amount,5790);assert.equal(created.body.product.shipping,998);
    const tx=sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(created.body.id),order=sqlite.prepare('SELECT * FROM product_orders WHERE id=?').get(tx.idempotency_key);
    assert.equal(JSON.parse(order.snapshot).quantity,3);assert.match(tx.description,/3 unidades/);
    const payload=m.trackerOrderPayload({...order,amount:tx.amount},'fixture-key');assert.deepEqual(JSON.parse(payload.order_items),[{name:'Quantity product',qty:3,price:57.9},{name:'Frete',qty:1,price:9.98}]);assert.equal(payload.total_value,183.68);
    await m.trackTransaction({...tx,copy_paste:'fixture-generated-pix'});
    const event=sqlite.prepare("SELECT payload FROM tracking_events WHERE pixel_id=? AND event='Purchase' ORDER BY created_at DESC LIMIT 1").get(pixel);
    const data=JSON.parse(m.unseal(event.payload,env.APP_ENCRYPTION_KEY));assert.equal(data.properties.contents[0].quantity,3);assert.equal(data.properties.value,183.68);
    sqlite.prepare('UPDATE products SET amount=9999 WHERE id=?').run(pid);
    const retry=await result(req('products/'+pid+'/order','POST',body));assert.equal(retry.body.id,created.body.id);assert.equal(retry.body.amount_cents,18368);assert.equal(upstreamCalls,before+1);
    assert.equal((await run(req('products/'+pid+'/order','POST',{...body,quantity:2}))).status,409);
    assert.equal((await run(req('products/'+pid+'/order','POST',{...body,quantity:undefined}))).status,409);
    const token=created.body.checkout_url.split('/').pop();const receipt=await result(req('checkout/'+token));assert.equal(receipt.body.product.quantity,3);assert.equal(receipt.body.amount_cents,18368);
    sqlite.prepare("UPDATE products SET amount=500,product_type='digital' WHERE id=?").run(pid);
    const {address,...digitalBuyer}=buyer;
    const digital=await result(req('products/'+pid+'/order','POST',{attempt:crypto.randomUUID(),quantity:99,buyer:digitalBuyer,shipping_method:'full'}));assert.equal(digital.body.amount_cents,49500);assert.equal(digital.body.product.shipping,0);assert.equal(digital.body.product.quantity,99);
    sqlite.prepare('UPDATE products SET amount=100000000 WHERE id=?').run(pid);
    const count=upstreamCalls;const overflow=await result(req('products/'+pid+'/order','POST',{attempt:crypto.randomUUID(),quantity:2,buyer:digitalBuyer}));assert.equal(overflow.status,422);assert.equal(upstreamCalls,count);
  } finally {await m.putSetting('active_gateway',originalGateway);await m.saveTrackingPixel({pixel_id:pixel,label:'Quantity fixture',is_active:false},owner.email);}
});


await test('Store orders: prices, session isolation, idempotency, 202, settlement and signed webhooks', async () => {
 const oldFetch=globalThis.fetch,oldGateway=await m.setting('active_gateway');
 env.STORE_ORDERS_ENABLED='true';env.STORE_API_KEY_ID='store-fixture';
 const session='a'.repeat(64),secret='fixture-webhook-secret';
 const key={id:'store-fixture',webhook_secret:m.seal(secret,env.APP_ENCRYPTION_KEY)};
 sqlite.prepare('INSERT INTO api_keys(id,name,hash,prefix,created_at,webhook_secret) VALUES(?,?,?,?,?,?)').run(key.id,'Store mock',m.hash('mock-store-key'),'mock',Date.now(),key.webhook_secret);
 await m.putSetting('active_gateway','pagpixhub');
 let posts=0,mode='pending';const rows=new Map();
 globalThis.fetch=async(url,opts={})=>{
  assert.ok(String(url).startsWith('https://pagpixhub.com/api/v1/'));
  if(opts.method==='POST'){
   posts++;const b=JSON.parse(opts.body);assert.equal(b.items,undefined);assert.equal(b.quantity,undefined);
   if(mode==='timeout')throw Error('mock timeout');
   const row={id:'mock-'+posts,status:'PENDING',amount_cents:b.amount_cents,external_reference:b.external_reference,pix:{copy_paste:mode==='instant'?'MOCK-PIX-NOT-PAYABLE':null,expires_at:new Date(Date.now()+3600000).toISOString()}};
   rows.set(row.id,row);return Response.json(row,{status:mode==='instant'?201:202});
  }
  return Response.json(rows.get(String(url).split('/').pop()));
 };
 const input={attempt:'store-attempt-00001',items:[{id:107,qty:2,variant:'Preto'}],customer:{name:'Cliente de Teste',email:'fixture@example.com',cpf:'52998224725',phone:'11999999999'},address:{cep:'01001000',street:'Rua de Teste',number:'1',neighborhood:'Centro',city:'São Paulo',state:'SP',complement:''},utm:{source:'mock'},shipping:'free',coupon:''};
 try{
  assert.equal(m.priceStoreOrder(input).amount,11180);
  assert.throws(()=>m.priceStoreOrder({...input,amount_cents:500}));
  assert.throws(()=>m.priceStoreOrder({...input,items:[{id:107,qty:0,variant:'Preto'}]}));
  assert.throws(()=>m.priceStoreOrder({...input,items:[{id:107,qty:1,variant:'Inventada'}]}));
  const [a,b]=await Promise.all([m.createStoreOrder(key.id,session,input),m.createStoreOrder(key.id,session,input)]);
  assert.equal(a.order_id,b.order_id);assert.equal(posts,1);assert.equal(a.amount_cents,11180);
  const retry=await m.createStoreOrder(key.id,session,input);assert.equal(retry.order_id,a.order_id);assert.equal(posts,1);
  await assert.rejects(()=>m.createStoreOrder(key.id,session,{...input,items:[{id:107,qty:1,variant:'Preto'}]}));
  await assert.rejects(()=>m.getStoreOrder(key.id,'b'.repeat(64),a.order_id));
  await assert.rejects(()=>m.getStoreOrder('another-key',session,a.order_id));
  const stored=sqlite.prepare('SELECT * FROM store_orders WHERE id=?').get(a.order_id);assert.ok(!stored.buyer.includes('52998224725'));assert.ok(!stored.charge_body.includes('fixture@example.com'));
  let tx=sqlite.prepare('SELECT * FROM transactions WHERE external_reference=?').get(a.order_id);const row=rows.get(tx.provider_id);
  row.status='PAID';await m.applyProvider(tx,row);await m.getStoreOrder(key.id,session,a.order_id);
  const raw=JSON.stringify({id:'store-event-paid',type:'transaction.paid',created:Math.floor(Date.now()/1000),data:{id:tx.id,external_reference:a.order_id,amount_cents:11180,status:'PAID'}});
  await assert.rejects(()=>m.receiveStoreEvent(key,raw,'invalid'));
  await assert.rejects(()=>m.receiveStoreEvent(key,raw,m.sign(raw,secret,Math.floor(Date.now()/1000)-301)));
  const wrong=raw.replace('11180','11181');await assert.rejects(()=>m.receiveStoreEvent(key,wrong,m.sign(wrong,secret)));
  await m.receiveStoreEvent(key,raw,m.sign(raw,secret));await m.receiveStoreEvent(key,raw,m.sign(raw,secret));
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM store_webhook_events WHERE order_id=?').get(a.order_id).n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM store_effects WHERE order_id=?').get(a.order_id).n,4);
  tx=sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(tx.id);await m.applyProvider(tx,{...row,status:'EXPIRED'});
  assert.equal((await m.getStoreOrder(key.id,session,a.order_id)).status,'PAID');
  mode='instant';const instant=await m.createStoreOrder(key.id,session,{...input,attempt:'store-instant-0001'});assert.equal(instant.pix.copy_paste,'MOCK-PIX-NOT-PAYABLE');
  const expTx=sqlite.prepare('SELECT * FROM transactions WHERE external_reference=?').get(instant.order_id);await m.applyProvider(expTx,{...rows.get(expTx.provider_id),status:'EXPIRED'});assert.equal((await m.getStoreOrder(key.id,session,instant.order_id)).status,'EXPIRED');
  mode='timeout';const uncertain=await m.createStoreOrder(key.id,session,{...input,attempt:'store-timeout-0001'});assert.equal(uncertain.status,'CREATING');
  const count=sqlite.prepare('SELECT COUNT(*) n FROM store_orders').get().n;
  await m.createStoreOrder(key.id,session,{...input,attempt:'store-timeout-0001'});assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM store_orders').get().n,count);
 }finally{globalThis.fetch=oldFetch;env.STORE_ORDERS_ENABLED='false';await m.putSetting('active_gateway',oldGateway);}
});
sqlite.close();
