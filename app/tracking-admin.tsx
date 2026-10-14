"use client";
import { useEffect, useState } from "react";
import { api } from "./gateway";
import { toast } from "sonner";

export default function TrackingAdmin() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    try { setData(await api("admin/tracking")); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void load(); }, []);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    try {
      await api("admin/tracking", { method: "POST", body: JSON.stringify({
        pixel_id: String(fields.get("pixel_id") || "").trim(),
        label: fields.get("label"),
        access_token: String(fields.get("access_token") || "").trim() || undefined,
        is_active: true,
      }) });
      form.reset(); await load(); toast.success("Pixel salvo. O token fica protegido no servidor.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  async function toggle(pixel: any) {
    setBusy(true);
    try {
      await api("admin/tracking", { method: "POST", body: JSON.stringify({
        pixel_id: pixel.pixel_id, label: pixel.label, is_active: !pixel.is_active,
      }) });
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="section-stack">
    <section className="surface">
      <div className="panel-heading"><div><h3>TikTok · Pixels</h3><p>Loja gateway · Brasil · BRL</p></div>
        <button className="secondary-button" onClick={load}>Atualizar</button></div>
      <p>Entrada: InitiateCheckout · Pix gerado: Purchase + AddPaymentInfo + PixGenerated.</p>
      <p>Nos novos pedidos, Purchase representa o Pix gerado, mesmo antes do pagamento. A aprovação não envia outro Purchase. Use os indicadores do gateway para conferir vendas pagas; compras e receita no TikTok podem incluir Pix não pagos. Pedidos anteriores mantêm o gatilho original.</p>
      {data?.test_mode && <p className="notice">Modo de teste ativo neste ambiente.</p>}
      {error && <p role="alert">{error}</p>}
      {data?.pixels.map((pixel: any) => <div className="panel-heading" key={pixel.pixel_id}>
        <div><strong>{pixel.label}</strong><p>{pixel.pixel_id} · {pixel.is_active ? "Ativo" : "Pausado"}</p></div>
        <button className="secondary-button" disabled={busy} onClick={() => toggle(pixel)}>{pixel.is_active ? "Pausar" : "Ativar"}</button>
      </div>)}
      <form onSubmit={save} className="section-stack">
        <label className="field">Pixel ID<input name="pixel_id" required pattern="[A-Z0-9]{16,32}" placeholder="ID do pixel TikTok" /></label>
        <label className="field">Nome<input name="label" required maxLength={80} placeholder="TikTok principal" /></label>
        <label className="field">Access Token<input name="access_token" type="password" autoComplete="new-password" placeholder="Obrigatório para novos pixels" maxLength={500} /></label>
        <button className="primary" disabled={busy}>Salvar pixel</button>
      </form>
    </section>
    <section className="surface"><h3>Envios ao TikTok</h3>
      <p>“Enviado” confirma o aceite da API. A atribuição aos anúncios é calculada pelo TikTok.</p>
      {!data?.events.length && <p>Nenhum evento registrado ainda.</p>}
      {data?.events.map((e: any) => <p key={e.pixel_id + e.event}>{e.pixel_id} · {e.event}: {e.sent} enviados, {e.pending} aguardando, {e.total} registrados.</p>)}
      {data?.failures.map((e: any, i: number) => <p key={i} role="status">{e.pixel_id} · {e.event}: {e.last_error} · tentativa {e.attempts}</p>)}
    </section>
  </div>;
}
