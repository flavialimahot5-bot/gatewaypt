"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "./gateway";
import { copy } from "./views";

export default function BravoPayGateway({ data, active, busy, setBusy, reload, activate }: {
  data: any; active: string; busy: boolean; setBusy: (busy: boolean) => void;
  reload: () => Promise<void>; activate: (gateway: string, expected?: string) => Promise<void>;
}) {
  const [form, setForm] = useState({ token: "", webhook_secret: "" }), [editing, setEditing] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await api("admin/gateways/bravopay", { method: "POST", body: JSON.stringify(form) });
      setForm({ token: "", webhook_secret: "" }); setEditing(false);
      await reload(); toast.success("BravoPay salva. Confira o webhook antes de ativar para novas vendas.");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const ready = data.configured && data.webhook_configured;
  return <section className="surface section-stack">
    <div className="section-heading"><h3>BravoPay</h3><span className="badge">{active === "bravopay" ? "Ativo" : ready ? "Desativado — dados salvos" : data.configured ? "Falta configurar o webhook" : "Não configurado"}</span></div>
    <p>Receba por Pix com a BravoPay, incluindo produtos físicos, digitais e upsells. As credenciais ficam salvas para as próximas ativações.</p>
    <ol><li>Salve seu token da API BravoPay para obter a URL abaixo.</li><li>Na BravoPay, abra Integrações e cadastre essa URL como webhook com os eventos de transação.</li><li>Copie o segredo gerado pela BravoPay, salve neste formulário e ative a conexão.</li></ol>
    {ready && <div><button className="secondary-button" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "Fechar edição" : "Editar credenciais salvas"}</button></div>}
    {(!ready || editing) && <form className="section-stack" onSubmit={e => void save(e)}>
      <label className="field">Token da API BravoPay<input required={!data.configured} type="password" autoComplete="new-password" maxLength={8000} placeholder={data.configured ? "Salvo · vazio mantém o atual" : "bp_live_…"} value={form.token} onChange={e => setForm({ ...form, token: e.target.value })}/></label>
      <label className="field">Segredo do webhook BravoPay<input type="password" autoComplete="new-password" minLength={16} maxLength={500} placeholder={data.webhook_configured ? "Salvo · vazio mantém o atual" : "whsec_… · preencha após cadastrar a URL"} value={form.webhook_secret} onChange={e => setForm({ ...form, webhook_secret: e.target.value })}/><small>Use o segredo fornecido pela BravoPay. Você pode salvar só o token primeiro.</small></label>
      <div><button className="primary" disabled={busy}>{busy ? "Validando…" : "Validar e salvar BravoPay"}</button></div>
      {data.configured && <small>Alterar credenciais já utilizadas cria outra conexão. Cadastre a nova URL na BravoPay; a conexão anterior permanece vinculada aos pedidos existentes.</small>}
    </form>}
    {data.webhook_url && <><p>URL do webhook BravoPay</p><code className="code" style={{ overflowWrap: "anywhere" }}>{data.webhook_url}</code><div><button className="secondary-button" onClick={() => void copy(data.webhook_url)}>Copiar webhook BravoPay</button></div><small>Marque transaction.created, transaction.paid, transaction.expired, transaction.failed, transaction.refunded e transaction.chargeback. A API da BravoPay não permite conferir esse cadastro automaticamente; confirme a URL e os eventos no painel dela.</small></>}
    {active === "bravopay" && data.current !== data.active_connection && <p>A conexão anterior continua ativa. Após cadastrar o novo webhook, ative a nova conexão abaixo.</p>}
    <div className="form-actions">{active === "bravopay" && <button className="secondary-button" disabled={busy} onClick={() => void activate("none", "bravopay")}>Desativar BravoPay</button>}{(active !== "bravopay" || data.current !== data.active_connection) && <button className="primary" disabled={busy || !ready} onClick={() => void activate("bravopay")}>{active === "bravopay" ? "Ativar nova conexão salva" : "Ativar BravoPay"}</button>}</div>
    <a href="https://bravopay.club/docs" target="_blank" rel="noreferrer">Documentação da BravoPay</a>
    {data.previous?.length > 0 && <details><summary>Conexões utilizadas em cobranças</summary><p>Mantenha os tokens e webhooks antigos ativos para acompanhar os pedidos existentes.</p>{data.previous.map((c: any) => <div key={c.id} style={{ marginTop: 18 }}><p>{c.pending} cobranças pendentes · {c.total} no total</p><code style={{ overflowWrap: "anywhere" }}>{c.webhook_url}</code></div>)}</details>}
  </section>;
}
