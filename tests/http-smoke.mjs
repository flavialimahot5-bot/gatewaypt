import assert from "node:assert/strict";
const origin = process.env.SMOKE_ORIGIN || "http://localhost:5173";
const request = (path, options = {}) =>
  fetch(origin + path, { ...options, signal: AbortSignal.timeout(15000) });
const login = await request("/");
assert.equal(login.status, 200);
assert.match(await login.text(), /Entrar no painel/);
assert.equal((await request("/api/admin/overview")).status, 401);
assert.equal(
  (
    await request("/api/admin/overview", {
      headers: {
        "oai-authenticated-user-id": "spoof",
        "oai-authenticated-user-email": "flavialimahot5@gmail.com",
        Cookie: "__sites_local_auth=1",
      },
    })
  ).status,
  401,
);
assert.equal((await request("/api/v1/transactions")).status, 503);
assert.equal((await request("/api/cron")).status, 401);
const spec = await request("/api-spec.json");
assert.equal(spec.status, 200);
assert.equal((await spec.json()).openapi, "3.1.0");
console.log(
  "HTTP: Password login surface, old identity headers/cookie rejected, unauthorized admin and cron rejected, payments locked and OpenAPI valid.",
);
