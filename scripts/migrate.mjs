import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
if (!process.env.TURSO_DATABASE_URL)
  throw new Error(
    "Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN antes de migrar.",
  );
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
try {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS gateway_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  for (const name of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    // Git checks out LF on Vercel; ignore Windows line endings in the checksum.
    const sql = readFileSync("drizzle/" + name, "utf8").replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const tx = await client.transaction("write");
    try {
      const applied = await tx.execute({
        sql: "SELECT checksum FROM gateway_migrations WHERE name=?",
        args: [name],
      });
      if (applied.rows.length) {
        if (applied.rows[0].checksum !== checksum)
          throw new Error("Migração aplicada foi alterada: " + name);
        await tx.rollback();
        console.log("Já aplicada: " + name);
        continue;
      }
      const statements = sql
        .split("--> statement-breakpoint")
        .map((x) => x.trim())
        .filter(Boolean);
      for (const statement of statements) await tx.execute(statement);
      await tx.execute({
        sql: "INSERT INTO gateway_migrations(name,checksum,applied_at) VALUES (?,?,?)",
        args: [name, checksum, Date.now()],
      });
      await tx.commit();
      console.log("Aplicada: " + name);
    } catch (e) {
      if (!tx.closed) await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
  }
} finally {
  client.close();
}
