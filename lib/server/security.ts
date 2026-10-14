import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const randomToken = (prefix = "") =>
  prefix + randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encryptionKeyStatus(key: string) {
  const normalized = key.trim();
  return !normalized ? "missing" : /^[a-f0-9]{64}$/i.test(normalized) ? "ready" : "invalid";
}
function encryptionKey(key: string) {
  if (encryptionKeyStatus(key) !== "ready")
    throw new ApiError(503, "encryption_unavailable",
      "APP_ENCRYPTION_KEY ausente ou inválida na hospedagem. Configure os 64 caracteres hexadecimais da chave e faça um novo deploy.");
  return Buffer.from(key.trim(), "hex");
}
export function seal(value: string, key: string) {
  const keyBytes = encryptionKey(key);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes, iv);
  const ciphertext = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function unseal(value: string, key: string) {
  const [iv, tag, body] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const c = createDecipheriv("aes-256-gcm", encryptionKey(key), iv);
  c.setAuthTag(tag);
  return Buffer.concat([c.update(body), c.final()]).toString("utf8");
}
export function sign(
  raw: string,
  secret: string,
  t = Math.floor(Date.now() / 1000),
) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
}
export function verify(
  raw: string,
  header: string | null,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  if (!header || !secret) return false;
  const m = /^t=(\d{10}),v1=([a-f0-9]{64})$/i.exec(header);
  if (!m || Math.abs(now - Number(m[1])) > 300) return false;
  return equal(
    sign(raw, secret, Number(m[1])).split("v1=")[1],
    m[2].toLowerCase(),
  );
}
export function safeCallback(value: string, allowed: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new ApiError(
      422,
      "invalid_callback",
      "Informe uma URL HTTPS válida.",
    );
  }
  const hosts = allowed
    .toLowerCase()
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    !hosts.includes(u.hostname.toLowerCase()) ||
    /^[\d.]+$/.test(u.hostname) ||
    u.hostname.includes(":") ||
    u.hostname === "localhost" ||
    u.hostname.endsWith(".local")
  )
    throw new ApiError(
      422,
      "callback_not_allowed",
      "O domínio do webhook precisa estar na lista de destinos autorizados da hospedagem.",
    );
  return u.href;
}
function configuredOrigin(value: string) {
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
export function assertOrigin(request: Request, expected: string) {
  const allowed = new Set<string>();
  const configured = configuredOrigin(expected);
  if (configured) allowed.add(configured);
  // Trust only server-provided deployment metadata, never Host/forwarded headers.
  // Production's domain must not authorize writes to a preview deployment.
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
    const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    const production = domain && configuredOrigin(`https://${domain}`);
    if (production) allowed.add(production);
  }
  const origin = request.headers.get("origin");
  if (
    !origin || !allowed.has(origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(
      403,
      "invalid_origin",
      "Origem da solicitação não autorizada.",
    );
}
export function advance(current: string, next: string) {
  if (current === next) return current;
  if (["REFUNDED", "CHARGEBACK"].includes(current)) return current;
  if (current === "PAID" && !["REFUNDED", "CHARGEBACK"].includes(next))
    return current;
  return next;
}
export async function readJson(request: Request, max = 32768) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "invalid_content_type", "Envie application/json.");
  return JSON.parse(await readBody(request, max));
}
export async function readBody(request: Request, max = 65536) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new ApiError(413, "body_too_large", "Solicitação muito grande.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
