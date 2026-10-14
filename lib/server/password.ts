import { createHash, scrypt, timingSafeEqual } from "node:crypto";
import { adminUsers, allowedEmails, authConfigured } from "./config";
import { database } from "./database";
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
});
const pattern = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
const dummy = "scrypt$" + "0".repeat(32) + "$" + "0".repeat(128);
export function credentialVersion(email: string) {
  const stored = adminUsers()[email];
  return stored && allowedEmails().includes(email)
    ? createHash("sha256").update(stored).digest("hex") : null;
}
export async function verifyPassword(password: string, stored: string) {
  if (!pattern.test(stored) || password.length > 256) return false;
  const [, salt, expected] = stored.split("$");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export async function authenticatePassword(credentials: Partial<Record<string, unknown>>) {
  if (!authConfigured()) return null;
  const email = typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (!email || email.length > 254 || !password || password.length > 256) return null;
  // Shared persistent counters protect all Vercel instances, including direct auth requests.
  const windowMs = 15 * 60 * 1000;
  const bucket = Math.floor(Date.now() / windowMs);
  for (const [scope, limit] of [["global", 100], [email, 10]] as const) {
    const id = createHash("sha256").update(`login:${scope}:${bucket}`).digest("hex");
    const row = await database.prepare("INSERT INTO rate_limits(id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count")
      .bind(id, (bucket + 1) * windowMs).first<{count: number}>();
    if (!row || row.count > limit) return null;
  }
  const stored = adminUsers()[email];
  const valid = await verifyPassword(password, stored || dummy);
  if (!valid || !stored || !allowedEmails().includes(email)) return null;
  return { id: email, email, name: email.split("@")[0], credentialVersion: credentialVersion(email) };
}
