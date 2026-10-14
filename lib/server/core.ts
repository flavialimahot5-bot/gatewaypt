import { env, allowedEmails } from "./config";
import { database } from "./database";
import { getCurrentUser } from "./auth";
import { ApiError, assertOrigin, hash, randomToken } from "./security";
export { env, allowedEmails };
export const db = () => database;
export const now = () => Date.now();
export async function admin(request?: Request) {
  const user = await getCurrentUser();
  if (!user)
    throw new ApiError(
      401,
      "unauthorized",
      "Entre na sua conta para continuar.",
    );
  if (!allowedEmails().includes(user.email.toLowerCase()))
    throw new ApiError(
      403,
      "forbidden",
      "Esta conta não tem acesso a este workspace.",
    );
  if (request && request.method !== "GET")
    assertOrigin(request, env.APP_ORIGIN || "");
  return user;
}
export async function setting(id: string) {
  const row = await db()
    .prepare("SELECT value FROM settings WHERE id=?")
    .bind(id)
    .first<{ value: string }>();
  return row?.value || null;
}
export async function putSetting(id: string, value: string) {
  await db()
    .prepare(
      "INSERT INTO settings (id,value,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    )
    .bind(id, value, now())
    .run();
}
export async function audit(actor: string, action: string, target: string) {
  await db()
    .prepare(
      "INSERT INTO audit (id,actor,action,target,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(randomToken("log_"), actor, action, target, now())
    .run();
}
export async function rateLimit(id: string, max = 60, windowMs = 60000) {
  const bucket = Math.floor(now() / windowMs);
  const row = await db()
    .prepare(
      "INSERT INTO rate_limits (id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count",
    )
    .bind(hash(id + ":" + bucket), (bucket + 1) * windowMs)
    .first<{ count: number }>();
  if (!row || row.count > max)
    throw new ApiError(
      429,
      "rate_limited",
      "Muitas solicitações. Aguarde um minuto.",
    );
  if (Math.random() < 0.01)
    await db()
      .prepare("DELETE FROM rate_limits WHERE expires_at<?")
      .bind(now() - windowMs)
      .run();
}
export async function apiClient(request: Request) {
  if (env.PUBLIC_API_ENABLED !== "true")
    throw new ApiError(
      503,
      "api_not_enabled",
      "O recebimento externo ainda não está habilitado.",
    );
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !/^pl_live_[A-Za-z0-9_-]{43}$/.test(token))
    throw new ApiError(401, "unauthorized", "Credencial inválida.");
  const key = await db()
    .prepare("SELECT * FROM api_keys WHERE hash=? AND revoked_at IS NULL")
    .bind(hash(token))
    .first<any>();
  if (!key) throw new ApiError(401, "unauthorized", "Credencial inválida.");
  await rateLimit("key:" + key.id);
  return key;
}
export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
}
export async function route(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError)
      return json(
        { error: { code: e.code, message: e.message } },
        e.status,
        e.status === 429 ? { "Retry-After": "60" } : {},
      );
    if (e instanceof SyntaxError || (e as any)?.name === "ZodError")
      return json(
        {
          error: {
            code: "validation_error",
            message: "Confira os campos enviados.",
          },
        },
        422,
      );
    console.error(
      "Gateway request failed",
      e instanceof Error ? e.name : "Unknown",
    );
    return json(
      {
        error: {
          code: "internal_error",
          message: "Não foi possível concluir. Tente novamente.",
        },
      },
      500,
    );
  }
}
