"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "./gateway";
import { copy } from "./views";

type Job = { transaction_id: string; order_id: string; state: string; tracking_code: string | null; pending_credits: number; last_status: number | null; last_error: string | null };
type Configuration = { configured: boolean; enabled: boolean; jobs: Job[] };
const states: Record<string, string> = { PENDING: "Aguardando envio", SENDING: "Enviando", SENT: "Pedido criado", FAILED: "Não enviado", REVIEW: "Conferir no TrackerOrder", CANCELLED: "Pagamento não elegível" };
const errors: Record<string, string> = {
  customer_data_invalid: "Confira nome, e-mail e dados do pedido.",
  project_changed: "O projeto foi alterado. Confira o destino antes de continuar.",
  request_rejected: "O TrackerOrder recusou a solicitação. Confira as credenciais e a configuração do projeto.",
  delivery_uncertain: "A resposta não foi confirmada. Confira pelo ID do pedido no TrackerOrder antes de qualquer reenvio.",
  invalid_response: "Não recebemos um código válido. Confira pelo ID do pedido no TrackerOrder.",
  rate_limited: "Limite temporário da API; nova tentativa agendada.", paused: "Envio pausado.",
};
export default function TrackerOrderIntegration() {
  const [data, setData] = useState<Configuration | null>(null);
  const [token, setToken] = useState(""), [key, setKey] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load() {
    try { setData(await api("admin/integrations/trackerorder")); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void load(); }, []);
  async function save(enabled: boolean) {
    setBusy(true);
    try {
      setData(await api("admin/integrations/trackerorder", { method: "POST", body: JSON.stringify({ enabled, token, webhook_key: key }) }));
      setToken(""); setKey(""); setError("");
      toast.success(enabled ? "TrackerOrder ativado para os próximos pagamentos confirmados." : "Envios do TrackerOrder pausados.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="surface section-stack">
    <div className="section-heading"><h3>Pós-compra · TrackerOrder</h3><span className="badge">{data?.enabled ? "Ativado" : data?.configured ? "Pausado · dados salvos" : "Não configurado"}</span></div>
    <p>Cria um pedido no TrackerOrder após a confirmação do pagamento de um produto, com qualquer gateway brasileiro. O código fica salvo no histórico de vendas.</p>
    <p>Ative o SMS e configure os e-mails no projeto do TrackerOrder. O envio das mensagens depende dessas configurações e do saldo de créditos. O código é de acompanhamento interno do pedido.</p>
    {error && <p className="error-note" role="alert">{error}</p>}
    {!data && !error && <p>Carregando integração…</p>}
    {data && <>
      <form className="section-stack" onSubmit={e => { e.preventDefault(); void save(true); }}>
        <label className="field">Token Bearer<input type="password" autoComplete="new-password" required={!data.configured} maxLength={4000} value={token} onChange={e => setToken(e.target.value)} placeholder={data.configured ? "Salvo · vazio mantém o atual" : "Token da API"}/></label>
        <label className="field">Webhook Key do projeto<input type="password" autoComplete="new-password" required={!data.configured} maxLength={200} value={key} onChange={e => setKey(e.target.value)} placeholder={data.configured ? "Salva · vazio mantém a atual" : "Chave da sua loja no TrackerOrder"}/></label>
        <div className="form-actions" style={{ flexWrap: "wrap" }}><button className="primary" disabled={busy}>{busy ? "Salvando…" : data.enabled ? "Salvar configuração" : "Salvar e ativar TrackerOrder"}</button>{data.enabled && <button className="secondary-button" type="button" disabled={busy} onClick={() => void save(false)}>Pausar envios</button>}</div>
      </form>
      <small>Não envia vendas antigas nem cobranças avulsas. Enquanto ativo, o checkout também pede o nome nos produtos digitais. Pausar interrompe os próximos envios; uma solicitação já em andamento pode terminar.</small>
      <div className="section-heading"><h4>Últimos envios</h4><button className="secondary-button" disabled={busy} onClick={() => void load()}>Atualizar</button></div>
      {!data.jobs.length && <p>Os próximos pedidos pagos aparecerão aqui.</p>}
      {data.jobs.map(job => <div key={job.transaction_id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <p style={{ overflowWrap: "anywhere" }}>{job.order_id}</p>
        <p><strong>{states[job.state] || job.state}</strong>{job.pending_credits ? " · Aguardando créditos no TrackerOrder" : ""}{job.last_status && job.state !== "SENT" ? ` · HTTP ${job.last_status}` : ""}</p>
        {job.tracking_code && <button className="secondary-button" onClick={() => void copy(job.tracking_code!)}>Copiar código · {job.tracking_code}</button>}
        {job.last_error && <p>{errors[job.last_error] || "Confira este pedido no TrackerOrder."}</p>}
      </div>)}
    </>}
    <a href="https://trackerorders.online/" target="_blank" rel="noreferrer">Abrir TrackerOrder</a>
  </section>;
}
