import { createClient, type Client, type InValue } from "@libsql/client";
import { ApiError } from "./security";
let client: Client | undefined;
export function getClient() {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url)
    throw new ApiError(
      503,
      "database_unavailable",
      "Configure o banco de dados da hospedagem.",
    );
  if (
    process.env.VERCEL &&
    !url.startsWith("libsql://") &&
    !url.startsWith("https://")
  )
    throw new ApiError(
      503,
      "database_unavailable",
      "Use um banco remoto persistente na Vercel.",
    );
  if (process.env.VERCEL && !process.env.TURSO_AUTH_TOKEN)
    throw new ApiError(
      503,
      "database_unavailable",
      "Configure a credencial do banco remoto.",
    );
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}
class Statement {
  constructor(
    readonly sql: string,
    readonly args: InValue[] = [],
  ) {}
  bind(...args: InValue[]) {
    return new Statement(this.sql, args);
  }
  async first<T = Record<string, unknown>>() {
    const r = await getClient().execute({ sql: this.sql, args: this.args });
    return (r.rows[0] as unknown as T) || null;
  }
  async all<T = Record<string, unknown>>() {
    const r = await getClient().execute({ sql: this.sql, args: this.args });
    return { results: r.rows as unknown as T[] };
  }
  async run() {
    const r = await getClient().execute({ sql: this.sql, args: this.args });
    return { success: true, meta: { changes: r.rowsAffected } };
  }
}
export const database = {
  prepare: (sql: string) => new Statement(sql),
  async batch(statements: Statement[]) {
    const results = await getClient().batch(
      statements.map((s) => ({ sql: s.sql, args: s.args })),
      "write",
    );
    return results.map((r) => ({
      success: true,
      meta: { changes: r.rowsAffected },
    }));
  },
};
