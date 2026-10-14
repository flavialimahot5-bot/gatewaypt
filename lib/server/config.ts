export const env = process.env;
export function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
}
export function adminUsers(): Record<string, string> {
  try {
    const parsed = JSON.parse(process.env.ADMIN_USERS || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return Object.create(null);
    const result: Record<string, string> = Object.create(null);
    for (const [email, hash] of Object.entries(parsed)) {
      if (typeof hash === "string" && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash)) result[email.trim().toLowerCase()] = hash;
    }
    return result;
  } catch { return Object.create(null); }
}
export function authConfigured() {
  return !!(process.env.AUTH_SECRET && process.env.APP_ORIGIN && process.env.TURSO_DATABASE_URL &&
    (!process.env.VERCEL || process.env.TURSO_AUTH_TOKEN) && allowedEmails().some(email => adminUsers()[email]));
}
