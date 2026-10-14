import { build } from "esbuild";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import assert from "node:assert/strict";
// Windows npm can prune these optional entries; Vercel's clean install requires them.
const locked = JSON.parse(readFileSync("package-lock.json", "utf8"));
for (const dependency of ["core", "runtime"])
  assert.equal(locked.packages["node_modules/@rolldown/binding-wasm32-wasi/node_modules/@emnapi/" + dependency]?.version, "1.10.0", "Preserve the Vercel wasm dependency lock after npm install");
mkdirSync(".sites-runtime", { recursive: true });
const dir = mkdtempSync(join(process.cwd(), ".sites-runtime", "db-test-"));
process.env.TURSO_DATABASE_URL =
  "file:" + join(dir, "gateway.db").replaceAll("\\", "/");
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
for (let i = 0; i < 2; i++) {
  const p = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(p.status, 0, p.stderr);
  console.log(p.stdout.trim());
}
await build({
  entryPoints: ["lib/server/database.ts"],
  outfile: join(dir, "adapter.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { database, getClient } = await import(
  "file:///" + join(dir, "adapter.mjs").replaceAll("\\", "/")
);
await database
  .prepare("INSERT INTO settings(id,value,updated_at) VALUES (?,?,?)")
  .bind("test", "one", 1)
  .run();
await assert.rejects(() =>
  database.batch([
    database
      .prepare("UPDATE settings SET value=? WHERE id=?")
      .bind("two", "test"),
    database
      .prepare("INSERT INTO settings(id,value,updated_at) VALUES (?,?,?)")
      .bind("test", "duplicate", 2),
  ]),
);
assert.equal(
  (
    await database
      .prepare("SELECT value FROM settings WHERE id=?")
      .bind("test")
      .first()
  ).value,
  "one",
);
const results = await database
  .prepare("SELECT * FROM gateway_migrations")
  .all();
assert.equal(results.results.length, 18);
getClient().close();
await build({
  entryPoints: ["lib/server/config.ts"],
  outfile: join(dir, "config.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
});
const { adminUsers, authConfigured } = await import(
  "file:///" + join(dir, "config.mjs").replaceAll("\\", "/")
);
process.env.ADMIN_USERS = "invalid json";
assert.deepEqual(Object.keys(adminUsers()), []);
delete process.env.AUTH_SECRET;
assert.equal(authConfigured(), false);
console.log(
  "Vercel adapter: migrations idempotent, batch rollback, reads and fail-closed configuration passed.",
);
