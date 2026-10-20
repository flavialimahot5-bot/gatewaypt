"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "./gateway";

const states: Record<string,string> = { waiting_payment:"Pendente",paid:"Pago",refused:"Recusado/expirado",refunded:"Reembolsado" };
const errors: Record<string,string> = { payment_method_rejected:"Método recusado pela UTMify",token_rejected:"Token recusado",network:"Falha de conexão; nova tentativa agendada",outside_api_window:"Pedido fora do prazo permitido pela UTMify",attempts_exhausted:"Limite de tentativas atingido",configuration_changed:"Configuração alterada",invalid_response:"Resposta inválida",invalid_order_data:"Dados do pedido inválidos" };
async function request(path:string, options:RequestInit={}) {
  try {return await api(path,{...options,signal:AbortSignal.timeout(25000)});}
  catch(e) {
    if (e instanceof Error && (e.name==="TimeoutError" || e.name==="AbortError"))
      throw new Error("A solicitação demorou demais. Clique em Atualizar para conferir o estado e tente novamente.");
    throw e;
  }
}
export default function UtmifyAdmin() {
  const [data,setData]=useState<any>(null);
  const [token,setToken]=useState("");
  const [method,setMethod]=useState("mbway");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [progress,setProgress]=useState("");
  function report(e:unknown) {const message=(e as Error).message;setError(message);toast.error(message);}
  function update(value:any) {setData(value);setMethod(value.method);setError("");}
  async function load() {
    try { update(await request("admin/integrations/utmify")); }
    catch(e) {setError((e as Error).message);}
  }
  useEffect(()=>{void load();},[]);
  async function save(enabled:boolean) {
    setBusy(true);setError("");
    try {
      update(await request("admin/integrations/utmify",{method:"POST",body:JSON.stringify({token:token.trim()||undefined,enabled,method})}));
      setToken("");toast.success(enabled?"UTMify ativada para novos pedidos.":"Configuração salva. Envios pausados.");
    } catch(e) {report(e);}
    finally {setBusy(false);}
  }
  async function validate() {
    setBusy(true);setError("");
    try {
      update(await request("admin/integrations/utmify/test",{method:"POST",body:"{}"}));
      toast.success("Conexão validada. Nenhuma venda foi registrada. Você já pode ativar.");
    } catch(e) {report(e);}
    finally {setBusy(false);}
  }
  async function activate() {
    if (data?.enabled && !token.trim() && method===data.method) {await save(false);return;}
    if (!token.trim() && !data?.configured) {report(new Error("Cole o token da UTMify para ativar os envios."));return;}
    setBusy(true);setError("");
    try {
      setProgress("Salvando configuração…");
      let current=await request("admin/integrations/utmify",{method:"POST",body:JSON.stringify({token:token.trim()||undefined,enabled:false,method})});
      update(current);setToken("");
      if (!current.validated) {
        setProgress("Validando na UTMify (sem registrar venda)…");
        current=await request("admin/integrations/utmify/test",{method:"POST",body:"{}"});update(current);
      }
      setProgress("Ativando envios…");
      update(await request("admin/integrations/utmify",{method:"POST",body:JSON.stringify({enabled:true,method:current.method})}));
      toast.success("UTMify ativa: MB WAY gerado envia pendente e confirmado envia pago.");
    } catch(e) {report(e);}
    finally {setBusy(false);setProgress("");}
  }
  return <section className="surface section-stack">
    <div className="panel-heading"><div><h3>UTMify · Rastreamento de vendas</h3><p>MB WAY gerado → pendente · MB WAY confirmado → pago · Valores em EUR.</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={load}>Atualizar</button></div>
    <p>Capture as UTMs do link do checkout e acompanhe as atualizações do mesmo pedido. Apenas pedidos criados com a integração ativa são enviados.</p>
    <p role="status">{data?.enabled ? "Ativa" : "Pausada"} · {data?.configured ? "Token salvo com criptografia" : "Token ainda não configurado"}</p>
    <form className="section-stack" onSubmit={e=>{e.preventDefault();void save(false);}}>
      <label className="field">Token da API UTMify
        <input type="password" autoComplete="new-password" value={token} onChange={e=>setToken(e.target.value)} maxLength={4000}
          placeholder={data?.configured?"Deixe vazio para manter o token salvo":"Cole a credencial da UTMify"} disabled={busy} required={!data?.configured}/></label>
      <p>Na UTMify: Integrações → Webhooks → Credenciais de API. Cole o token e clique em Ativar envios. A conexão será validada automaticamente, sem registrar uma venda.</p>
      <details><summary>Compatibilidade do método de pagamento</summary>
        <p>A API da UTMify não aceita MB WAY. Se escolher Pix, essa categoria aparecerá somente no relatório da UTMify. A cobrança continua sendo MB WAY em euros, com pendente e pago conforme a Broski.</p>
        <label className="field">Método enviado à UTMify<select value={method} onChange={e=>setMethod(e.target.value)} disabled={busy}>
          <option value="mbway">MB WAY (não aceito pela UTMify)</option><option value="pix">Pix (categoria apenas no relatório UTMify)</option>
          <option value="credit_card">Cartão (somente com orientação da UTMify)</option><option value="paypal">PayPal (somente com orientação da UTMify)</option>
          <option value="boleto">Boleto (somente com orientação da UTMify)</option><option value="free_price">Free price (somente com orientação da UTMify)</option>
        </select></label>
      </details>
      <button className="primary" disabled={busy}>Salvar configuração</button>
    </form>
    {method==="pix" && <p>Categoria na UTMify: Pix · Pagamento real: MB WAY · Moeda: EUR.</p>}
    {error && <p role="alert" style={{color:"#ffb4b4",border:"1px solid #994444",borderRadius:8,padding:12}}>{error}</p>}
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    <div className="panel-heading">
      <button type="button" className="secondary-button" disabled={busy||!data?.configured||!!token||method!==data?.method} onClick={validate}>Validar conexão (sem venda)</button>
      <button type="button" className="primary" disabled={busy} onClick={activate}>{busy?"Aguarde…":data?.enabled&&!token.trim()&&method===data.method?"Pausar envios":"Ativar envios"}</button>
    </div>
    <p>O token nunca é exibido novamente. As taxas da Broski não estão disponíveis nesta integração; a UTMify recebe o valor bruto como comissão.</p>
    <h4>Últimos pedidos acompanhados</h4>
    {!data?.jobs?.length && <p>Nenhum pedido acompanhado ainda.</p>}
    {data?.jobs?.map((j:any)=><div key={j.order_id}><strong>{j.order_id}</strong><p>{j.sent_status?"Último estado aceito: "+states[j.sent_status]:"Aguardando envio"}{j.last_error?" · "+(errors[j.last_error]||j.last_error):""}</p></div>)}
  </section>;
}
