"use client";
import {useEffect,useState} from 'react';
import {api} from './gateway';
export default function GatewaysView({refresh}:{refresh:()=>Promise<void>}) {
 const [data,setData]=useState<any>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{setData(await api('pt/admin'));}catch(e){setMessage((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 return <div className="section-stack"><h2>Broski · Portugal</h2><p>MB WAY e Multibanco · EUR</p><section className="surface section-stack">
 <h3>Ligação ao gateway</h3><p>{data?.configured?'Chave guardada':'Chave por configurar'} · {data?.webhook_configured?'Segredo guardado':'Webhook por configurar'} · {data?.enabled?'Pagamentos ativados':'Pagamentos desativados'}</p>
 <form className="section-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);const form=e.currentTarget;const f=new FormData(form);try{await api('pt/admin',{method:'POST',body:JSON.stringify({token:f.get('token')||undefined,secret:f.get('secret')||undefined})});form.reset();await load();await refresh();setMessage('Credenciais guardadas. Cadastre o webhook abaixo no painel Broski.');}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}}>
 <label className="field">Chave secreta<input name="token" type="password" autoComplete="new-password" placeholder="sk_live_…"/></label>
 <label className="field">Segredo do webhook<input name="secret" type="password" autoComplete="new-password" placeholder="whbroski_…"/></label>
 <button className="primary" disabled={busy}>Guardar ligação</button></form>
 <p>URL do webhook: <code>{data?.webhook_url}</code></p><p>Envio de referências por email: {data?.email_configured?'configurado':'configure RESEND_API_KEY e MAIL_FROM no servidor'}.</p><p role="status">{message}</p></section>
 <section className="surface"><h3>Pagamentos Portugal</h3><div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Pedido</th><th>Método</th><th>Valor</th><th>Estado</th><th>Ação</th></tr></thead><tbody>{data?.orders?.map((o:any)=><tr key={o.id}><td>{o.id.slice(0,16)}…</td><td>{o.method==='mbway'?'MB WAY':'Multibanco'}</td><td>{(o.amount/100).toLocaleString('pt-PT',{style:'currency',currency:'EUR'})}</td><td>{o.status}</td><td>{o.status==='paid'&&<button onClick={async()=>{if(!confirm('Confirmar reembolso total desta encomenda?'))return; const storageKey='refund:'+o.id;let key=sessionStorage.getItem(storageKey);if(!key){key=crypto.randomUUID();sessionStorage.setItem(storageKey,key);}try{await api('pt/refunds/'+o.id,{method:'POST',headers:{'Idempotency-Key':key},body:'{}'});setMessage('Reembolso recebido. A confirmação será atualizada por webhook.');await load();}catch(e){setMessage((e as Error).message);}}}>Reembolsar</button>}</td></tr>)}</tbody></table></div></section></div>;
}
