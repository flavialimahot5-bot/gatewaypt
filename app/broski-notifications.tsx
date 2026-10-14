"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "./gateway";
import { copy } from "./views";

type Configuration = { configured: boolean; enabled: boolean; webhook_url: string };
export default function BroskiNotifications() {
  const [data, setData] = useState<Configuration | null>(null);
  const [secret, setSecret] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load() {
    try { setData(await api("admin/notifications/broski")); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void load(); }, []);
  async function save(enabled: boolean) {
    setBusy(true);
    try {
      setData(await api("admin/notifications/broski", { method: "POST", body: JSON.stringify({ enabled, webhook_secret: secret }) }));
      setSecret(""); setError("");
      toast.success(enabled ? "Broski ativada para receber avisos de pagamentos aprovados." : "Novos avisos da Broski desativados. O segredo continua salvo.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="surface section-stack">
    <div className="section-heading"><h3>Notificações externas · Broski</h3><span className="badge">{data?.enabled ? "Ativadas" : data?.configured ? "Desativadas · segredo salvo" : "Não configuradas"}</span></div>
    <p>Receba no Goti Pay somente os pagamentos aprovados de Portugal, em euros. Funciona junto com o gateway brasileiro ativo.</p>
    <p>Os avisos de Portugal ficam separados do faturamento em reais. Ative as notificações do Goti Pay no aparelho em que deseja recebê-los.</p>
    {error && <div role="alert"><p className="error-note">{error}</p><button className="secondary-button" onClick={() => void load()}>Tentar novamente</button></div>}
    {!data && !error && <p>Carregando configuração…</p>}
    {data && <>
      <ol><li>Na Broski, abra Configurações → Webhooks e cadastre a URL abaixo.</li><li>Selecione o evento <strong>order.paid</strong> (pagamento aprovado).</li><li>Copie o segredo da Broski, cole abaixo e salve para ativar os avisos.</li></ol>
      <code className="code" style={{ overflowWrap: "anywhere" }}>{data.webhook_url}</code>
      <div><button className="secondary-button" onClick={() => void copy(data.webhook_url)}>Copiar webhook Broski</button></div>
      <form className="section-stack" onSubmit={e => { e.preventDefault(); void save(true); }}>
        <label className="field">Segredo do webhook Broski<input type="password" autoComplete="new-password" required={!data.configured} maxLength={500} value={secret} onChange={e => setSecret(e.target.value)} placeholder={data.configured ? "Salvo · vazio mantém o atual" : "whbroski_…"}/><small>Use o segredo de assinatura fornecido pela Broski.</small></label>
        <div className="form-actions" style={{ flexWrap: "wrap" }}><button className="primary" disabled={busy}>{busy ? "Salvando…" : data.enabled ? "Salvar configuração" : "Salvar e ativar notificações"}</button>{data.enabled && <button type="button" className="secondary-button" disabled={busy} onClick={() => void save(false)}>Desativar notificações Broski</button>}</div>
      </form>
      <small>MB WAY e Multibanco aprovados. Eventos de geração, teste e outros estados são ignorados. A entrega depende de a Broski enviar o webhook e de o aparelho aceitar notificações.</small>
      <a href="https://docs.broski.pt/" target="_blank" rel="noreferrer">Documentação da Broski</a>
    </>}
  </section>;
}
