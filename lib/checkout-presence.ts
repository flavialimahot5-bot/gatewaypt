"use client";
import { useEffect } from "react";
import { checkoutAttribution } from "./tiktok-tracking";

// Only an anonymous visit identifier and step number leave the browser.
export function useCheckoutPresence(product: string, stage: number) {
  useEffect(() => {
    let stopped = false;
    let running = false;
    const send = async () => {
      if (stopped || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await fetch("/api/tracking/presence", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: product, visit: checkoutAttribution(product).visit, stage }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* Presence never interrupts checkout. */ }
      finally { running = false; }
    };
    void send();
    const timer = setInterval(() => void send(), 20000);
    document.addEventListener("visibilitychange", send);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", send); };
  }, [product, stage]);
}
