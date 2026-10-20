"use client";
type Attribution = { visit: string; ttclid?: string; ttp?: string; fbc?: string; fbp?: string; utm?: Record<string,string> };
const memory = new Map<string, Attribution>();
export function checkoutAttribution(product: string): Attribution {
  let value = memory.get(product);
  if (!value) {
    try {
      const stored = JSON.parse(sessionStorage.getItem("tiktok:" + product) || "null");
      if (stored && /^[a-f0-9-]{36}$/i.test(stored.visit)) value = stored;
    } catch {}
    value ||= { visit: crypto.randomUUID() };
  }
  const params = new URL(location.href).searchParams;
  const utmKeys = ["src", "sck", "utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"];
  if (utmKeys.some(k => params.has(k))) {
    value.utm = {};
    for (const k of utmKeys) {
      const entry = params.get(k);
      if (entry) value.utm[k] = entry.slice(0,500);
    }
  }
  const click = params.get("ttclid");
  if (click && /^[A-Za-z0-9_.~-]{1,500}$/.test(click)) value.ttclid = click;
  // The sales page and checkout use separate domains, so its _ttp cookie is
  // forwarded explicitly. Never generate a replacement TikTok identifier.
  const forwarded = params.get("ttp");
  const cookie = document.cookie.split(/;\s*/).find(c => c.startsWith("_ttp="))?.slice(5);
  const ttp = forwarded && /^[A-Za-z0-9_.~-]{1,250}$/.test(forwarded) ? forwarded : cookie;
  if (ttp && /^[A-Za-z0-9_.~-]{1,250}$/.test(ttp)) value.ttp = ttp;
  const metaCookie = (name: string) => document.cookie.split(/;\s*/).find(c => c.startsWith(name + "="))?.slice(name.length + 1);
  const fbc = params.get("fbc") || metaCookie("_fbc");
  const fbp = params.get("fbp") || metaCookie("_fbp");
  if (fbc && /^fb\.\d+\.\d{13}\.[A-Za-z0-9_-]{1,500}$/.test(fbc)) value.fbc = fbc;
  if (fbp && /^fb\.\d+\.\d{13}\.\d{1,30}$/.test(fbp)) value.fbp = fbp;
  const fbclid = params.get("fbclid");
  if (fbclid && /^[A-Za-z0-9_-]{1,500}$/.test(fbclid) && !value.fbc?.endsWith("." + fbclid))
    value.fbc = `fb.1.${Date.now()}.${fbclid}`;
  memory.set(product, value);
  try { sessionStorage.setItem("tiktok:" + product, JSON.stringify(value)); } catch {}
  return value;
}
// Events API sends the three conversions. No token or purchase trigger in browser code.
export async function initiateCheckout(product: string) {
  try {
    await fetch("/api/tracking/start", { method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: product, tracking: checkoutAttribution(product) }),
    });
  } catch { /* Advertising must never prevent checkout. */ }
}
