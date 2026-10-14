"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "./gateway";

export default function PlowfSalesProfile({ connectionId, profile, disabled, onSaved }: {
  connectionId: string; profile: { mode: "own" | "marketplace"; document_last4: string | null }; disabled: boolean; onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState(profile.mode), [document, setDocument] = useState(""), [name, setName] = useState(""), [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      await api("admin/gateways/plowf/profile", { method: "POST", body: JSON.stringify({ connection_id: connectionId, mode, ...(mode === "marketplace" ? { document, name } : {}) }) });
      setDocument(""); setName(""); await onSaved(); toast.success("Modo de venda salvo. A URL do webhook continua a mesma.");
    } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  return <form className="section-stack" onSubmit={save}>
    <h4>Tipo de operação da Plowf</h4>
    <label className="field">Modo de venda<select value={mode} disabled={busy || disabled} onChange={event => setMode(event.target.value as "own" | "marketplace")}><option value="own">Vendas próprias</option><option value="marketplace">PSP / marketplace</option></select></label>
    {mode === "own" ? <p>Para vendas da própria empresa. Não envia beneficiário final. A modalidade deve corresponder à sua conta na Plowf.</p> : <>
      <p>Identifique o vendedor real que recebe pelas vendas desta conexão. O comprador é informado separadamente pelo checkout.</p>
      <div className="form-grid">
        <label className="field">CPF/CNPJ do beneficiário final<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={30} required={!profile.document_last4} value={document} onChange={event => setDocument(event.target.value)} placeholder={profile.document_last4 ? `Salvo · final ${profile.document_last4} · vazio mantém` : "Documento do vendedor real"}/></label>
        <label className="field">Nome do beneficiário (opcional)<input value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Nome ou razão social do vendedor"/></label>
      </div>
      <small>Use os links dos produtos cadastrados: enviamos os itens e os dados completos do comprador, inclusive em produtos digitais. Este beneficiário vale para as novas vendas desta conexão.</small>
    </>}
    <div><button className="primary" disabled={busy || disabled}>{busy ? "Salvando…" : "Salvar modo de venda"}</button></div>
    <small>Esta configuração não troca o gateway ativo nem muda o webhook. Pedidos existentes mantêm os dados originais.</small>
  </form>;
}
