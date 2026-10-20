"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "./gateway";

const states: Record<string,string> = { waiting_payment:"Pendente",paid:"Pago",refused:"Recusado/expirado",refunded:"Reembolsado" };
const errors: Record<string,string> = { payment_method_rejected:"Método recusado pela UTMify",token_rejected:"Token recusado",network:"Falha de conexão; nova tentativa agendada",outside_api_window:"Pedido fora do prazo permitido pela UTMify",attempts_exhausted:"Limite de tentativas atingido",configuration_changed:"Configuração alterada",invalid_response:"Resposta inválida",invalid_order_data:"Dados do pedido inválidos" };
export default function UtmifyAdmin() {
  const [data,setData]=useState<any>(null);
  const [token,setToken]=useState("");
  const [method,setMethod]=useState("mbway");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  function update(value:any) {setData(value);setMethod(value.method);setError("");}
  async function load() {
    try { update(await api("admin/integrations/utmify")); }
    catch(e) {setError((e as Error).message);}
  }
  useEffect(()=>{void load();},[]);
  async function save(enabled:boolean) {
    setBusy(true);setError("");
    try {
      update(await api("admin/integrations/utmify",{method:"POST",body:JSON.stringify({token:token.trim()||undefined,enabled,method})}));
      setToken("");toast.success(enabled?"UTMify ativada para novos pedidos.":"Configuração salva. Envios pausados.");
    } catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  async function validate() {
    setBusy(true);setError("");
    try {
      update(await api("admin/integrations/utmify/test",{method:"POST",body:"{}"}));
      toast.success("Conexão validada. Nenhuma venda foi registrada. Você já pode ativar.");
    } catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  return <section className="surface section-stack">
    <div className="panel-heading"><div><h3>UTMify · Rastreamento de vendas</h3><p>MB WAY gerado → pendente · MB WAY confirmado → pago · Valores em EUR.</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={load}>Atualizar</button></div>
    <p>Capture as UTMs do link do checkout e acompanhe as atualizações do mesmo pedido. Apenas pedidos criados com a integração ativa são enviados.</p>
    <p role="status">{data?.enabled ? "Ativa" : "Pausada"} · {data?.configured ? "Token salvo com criptografia" : "Token ainda não configurado"}</p>
    {error && <p role="alert">{error}</p>}
    <form className="section-stack" onSubmit={e=>{e.preventDefault();void save(false);}}>
      <label className="field">Token da API UTMify
        <input type="password" autoComplete="new-password" value={token} onChange={e=>setToken(e.target.value)} maxLength={4000}
          placeholder={data?.configured?"Deixe vazio para manter o token salvo":"Cole a credencial da UTMify"} disabled={busy} required={!data?.configured}/></label>
      <p>Na UTMify: Integrações → Webhooks → Credenciais de API. Salve, valide a conexão e depois ative os envios.</p>
      <details><summary>Compatibilidade do método de pagamento</summary>
        <p>A documentação fornecida não lista MB WAY. O teste verifica se a API aceita esse método. Só escolha outra classificação se o suporte da UTMify orientar; isso altera apenas o relatório da UTMify.</p>
        <label className="field">Método enviado à UTMify<select value={method} onChange={e=>setMethod(e.target.value)} disabled={busy}>
          <option value="mbway">MB WAY (validar com a API)</option><option value="pix">Pix (somente com orientação da UTMify)</option>
          <option value="credit_card">Cartão (somente com orientação da UTMify)</option><option value="paypal">PayPal (somente com orientação da UTMify)</option>
          <option value="boleto">Boleto (somente com orientação da UTMify)</option><option value="free_price">Free price (somente com orientação da UTMify)</option>
        </select></label>
      </details>
      <button className="primary" disabled={busy}>Salvar configuração</button>
    </form>
    <div className="panel-heading">
      <button type="button" className="secondary-button" disabled={busy||!data?.configured||!!token||method!==data?.method} onClick={validate}>Validar conexão (sem venda)</button>
      <button type="button" className="primary" disabled={busy||!!token||method!==data?.method||(!data?.enabled&&!data?.validated)} onClick={()=>save(!data?.enabled)}>{data?.enabled?"Pausar envios":"Ativar envios"}</button>
    </div>
    <p>O token nunca é exibido novamente. As taxas da Broski não estão disponíveis nesta integração; a UTMify recebe o valor bruto como comissão.</p>
    <h4>Últimos pedidos acompanhados</h4>
    {!data?.jobs?.length && <p>Nenhum pedido acompanhado ainda.</p>}
    {data?.jobs?.map((j:any)=><div key={j.order_id}><strong>{j.order_id}</strong><p>{j.sent_status?"Último estado aceito: "+states[j.sent_status]:"Aguardando envio"}{j.last_error?" · "+(errors[j.last_error]||j.last_error):""}</p></div>)}
  </section>;
}
