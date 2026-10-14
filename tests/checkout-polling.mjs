import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

mkdirSync(".sites-runtime", { recursive: true });
await build({ entryPoints: ["lib/checkout-polling.ts"], outfile: ".sites-runtime/checkout-polling.mjs", bundle: true, platform: "node", format: "esm" });
const { watchCheckout } = await import("../.sites-runtime/checkout-polling.mjs");
await test("checkout polls promptly, pauses hidden tabs, resumes on return and never overlaps or polls after payment", async () => {
  const original = { fetch: globalThis.fetch, document: globalThis.document, window: globalThis.window, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const timers = new Map(), calls = [], data = [], errors = [];
  let sequence = 0, stop;
  globalThis.document = new EventTarget(); document.visibilityState = "visible";
  globalThis.window = new EventTarget();
  globalThis.setTimeout = (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    calls.push({ url, options, resolve });
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  const flush = () => new Promise(setImmediate);
  const fire = delay => { const entry = [...timers].find(([, t]) => t.delay === delay); assert.ok(entry); timers.delete(entry[0]); entry[1].fn(); };
  const respond = async status => { calls.at(-1).resolve(Response.json({ status, pix: { copy_paste: "test" } })); await flush(); };
  try {
    stop = watchCheckout("co_test", value => data.push(value), message => errors.push(message));
    assert.equal(calls.length, 1);
    window.dispatchEvent(new Event("pageshow")); document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls.length, 1, "return events cannot overlap an in-flight lookup");
    await respond("PENDING");
    fire(3000); assert.equal(calls.length, 2);
    await respond("PENDING");
    document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(timers.size, 0);
    document.visibilityState = "visible"; document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls.length, 3, "returning from a bank app refreshes immediately");
    await respond("PAID");
    window.dispatchEvent(new Event("pageshow")); document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls.length, 3); assert.equal(timers.size, 0); assert.equal(data.at(-1).status, "PAID");
    stop();
    stop = watchCheckout("co_timeout", value => data.push(value), message => errors.push(message));
    fire(20000); await flush(); assert.match(errors.at(-1), /demorando/);
    fire(3000); const last = calls.at(-1); assert.equal(last.options.method, undefined, "polling only reads; never creates charges");
    const count = data.length; stop(); await flush();
    assert.equal(last.options.signal.aborted, true); assert.equal(data.length, count); assert.equal(timers.size, 0);
  } finally { stop?.(); Object.assign(globalThis, original); }
});
