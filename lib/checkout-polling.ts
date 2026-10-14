const terminal = new Set(["PAID", "FAILED", "EXPIRED", "REFUNDED", "CHARGEBACK"]);

export function watchCheckout(token: string, onData: (data: any) => void, onError: (message: string) => void) {
  const visible = () => document.visibilityState !== "hidden";
  let stopped = false, running = false, finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  async function poll() {
    if (stopped || running || finished || !visible()) return;
    clearTimeout(timer);
    running = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 20000);
    try {
      const response = await fetch("/api/checkout/" + encodeURIComponent(token), { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Não foi possível consultar o pagamento.");
      if (stopped) return;
      finished = terminal.has(data.status);
      onData(data);
      onError("");
    } catch (error) {
      if (!stopped) onError(error instanceof Error && error.name !== "AbortError" ? error.message : "A consulta está demorando. Verificando novamente…");
    } finally {
      clearTimeout(timeout);
      running = false;
      if (!stopped && !finished && visible()) timer = setTimeout(() => void poll(), 3000);
    }
  }
  const resume = () => { if (visible()) void poll(); else clearTimeout(timer); };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", resume);
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pageshow", resume);
  };
}
