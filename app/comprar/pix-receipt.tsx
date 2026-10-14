"use client";
import { useEffect, useState } from "react";
import { Copy, LockKeyhole, CheckCircle2, Info } from "lucide-react";

export default function PixReceipt({ tx, qr, error }: { tx: any; qr: string; error: string }) {
  const [clock, setClock] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => { window.scrollTo(0, 0); setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const deadline = Date.parse(tx?.pix?.expires_at || "");
  const remaining = Number.isFinite(deadline) && clock ? Math.max(0, Math.ceil((deadline - clock) / 1000)) : null;
  const paid = tx?.status === "PAID";
  useEffect(() => {
    if (!paid || !tx?.redirect_url) return;
    let target: URL;
    try {
      target = new URL(tx.redirect_url);
      if (target.protocol !== "https:" || target.username || target.password) return;
    } catch { return; }
    const timer = setTimeout(() => window.location.replace(target.href), 1200);
    return () => clearTimeout(timer);
  }, [paid, tx?.redirect_url]);
  const ended = ["FAILED", "EXPIRED", "REFUNDED", "CHARGEBACK"].includes(tx?.status);
  const expired = !paid && (ended || remaining === 0);
  const code = tx?.pix?.copy_paste;
  return <main className="shop-page">
    <header className="shop-header"><img className="shop-brand-image" src="/checkout-brand/mercado-livre.png" alt="Mercado Livre" width={922} height={235} /><div className="shop-secure"><LockKeyhole size={18} /><span>PAGAMENTO<br />100% SEGURO</span></div></header>
    <section className="pix-receipt">
      <h1>{paid ? "Pagamento confirmado!" : expired ? "Cobrança encerrada" : "Quase lá..."}</h1>
      <p>{paid ? "Recebemos seu pagamento. Seu pedido foi confirmado." : expired ? "Este código não está mais disponível. Entre em contato com a loja." : code ? <>Pague via pix {remaining !== null && <>em até <strong>{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</strong> </>}para confirmar seu pedido.</> : "Estamos preparando seu código Pix. Aguarde nesta página."}</p>
      <div className={`pix-status ${paid ? "is-paid" : ""}`} role="status">{paid ? "Pagamento aprovado" : expired ? "Pagamento indisponível" : code ? "Aguardando pagamento ..." : "Gerando Pix ..."}</div>
      {paid ? <CheckCircle2 className="pix-confirmed" size={110} /> : <img className="pix-illustration" src="/checkout-brand/pix-checkout.png" width={192} height={192} alt="Pagar com Pix" />}
      {paid && tx?.redirect_url && <p role="status">Pagamento aprovado. Redirecionando para a próxima oferta… <a href={tx.redirect_url} rel="noreferrer">Continuar</a></p>}
      {tx && <p className="pix-receipt-total">Total via Pix: <strong>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(tx.amount_cents / 100)}</strong></p>}
      {(error || copyError) && <div className="shop-error" role="alert">{error || copyError}</div>}
      {!paid && !expired && code && <div className="pix-receipt-body">
        <input className="pix-code" readOnly value={code} aria-label="Código Pix copia e cola" onFocus={event => event.target.select()} />
        <button className="pix-copy" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setCopyError(""); } catch { setCopyError("Selecione e copie o código no campo acima."); } }}><Copy size={16} />{copied ? "Código copiado!" : "Copiar código"}</button>
        <div className="pix-notice"><Info size={16} /><span>Antes de confirmar, confira o valor e o recebedor no aplicativo do banco. Se houver um alerta de segurança, verifique com a loja.</span></div>
        <h2>Como pagar o pix</h2>
        <ol><li>Clique em <strong>copiar o código</strong>, logo acima</li><li>Abra o aplicativo do seu banco</li><li>Selecione a opção <strong>PIX</strong></li><li>Toque em <strong>"Pix Copia e Cola"</strong></li><li>Insira o código copiado e finalize seu pagamento</li></ol>
        {qr && <details className="pix-qr"><summary>Prefere escanear? Ver QR Code</summary><img src={qr} width={250} height={250} alt="QR Code Pix desta cobrança" /></details>}
      </div>}
      {paid && tx.tracking_code && <p>Código de acompanhamento: <strong>{tx.tracking_code}</strong></p>}
      {paid && <p className="pix-order-id">Pedido: {tx.id}</p>}
    </section>
  </main>;
}
