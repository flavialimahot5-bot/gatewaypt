const terminal = new Set(["PAID", "EXPIRED", "FAILED", "REFUNDED", "CHARGEBACK"]);

// A product link starts another purchase; a /checkout/token link remains a receipt.
export function finishProductSession(productId: string, token: string, status: string, resumed: boolean) {
  if (!terminal.has(status)) return false;
  try {
    const key = "product-order:" + productId;
    const stored = JSON.parse(sessionStorage.getItem(key) || "{}");
    // Never clear a newer attempt when an older request finishes late.
    if (stored.token === token) sessionStorage.removeItem(key);
  } catch { /* A browser storage restriction must not prevent another purchase. */ }
  return resumed;
}
