"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff, Smartphone, Share2, Send, CheckCircle2 } from "lucide-react";
import { api } from "./gateway";

export default function PushPanel() {
  const [supported,setSupported]=useState(false),[installed,setInstalled]=useState(false),[ios,setIos]=useState(false);
  const [ready,setReady]=useState(false),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState(''),[failure,setFailure]=useState(false);
  const [registration,setRegistration]=useState<ServiceWorkerRegistration|null>(null);
  const [publicKey,setPublicKey]=useState('');
  useEffect(()=>{
    let stopped=false;
    const onHome=matchMedia('(display-mode: standalone)').matches || !!(navigator as any).standalone;
    const onIos=/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
    setInstalled(onHome);setIos(onIos);
    const canPush='serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(canPush);
    if(!canPush || (onIos&&!onHome)){setReady(true);return;}
    (async()=>{
      try {
        const reg=await navigator.serviceWorker.register('/braks-sw.js',{scope:'/'});
        await navigator.serviceWorker.ready;
        const config=await api('admin/push');
        const subscription=await reg.pushManager.getSubscription();
        const status=subscription ? await api('admin/push/status',{method:'POST',body:JSON.stringify({endpoint:subscription.endpoint})}) : {enabled:false};
        if(!stopped){setRegistration(reg);setPublicKey(config.public_key);setEnabled(status.enabled);}
      }catch{if(!stopped){setFailure(true);setMessage('Não foi possível preparar as notificações. Atualize o painel e tente novamente.');}}
      finally{if(!stopped)setReady(true);}
    })();
    return()=>{stopped=true;};
  },[]);
  async function enable() {
    if(!registration || !publicKey)return;
    setBusy(true);setMessage('');setFailure(false);
    try {
      // Called directly from a click: required by iOS, before network awaits.
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw Error('Permissão não concedida. Ative os avisos da Goti Pay nos Ajustes → Notificações do iPhone.');
      const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      const subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      await api('admin/push',{method:'POST',body:JSON.stringify(subscription.toJSON())});
      setEnabled(true);setMessage('Pronto! Este aparelho receberá avisos de Pix pendente e venda aprovada.');
    }catch(e){setFailure(true);setMessage((e as Error).message);}
    finally{setBusy(false);}
  }
  async function disable() {
    if(!registration)return;
    setBusy(true);setFailure(false);
    try {
      const sub=await registration.pushManager.getSubscription();
      if(sub){await api('admin/push',{method:'DELETE',body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe();}
      setEnabled(false);setMessage('Notificações desativadas neste aparelho.');
    }catch(e){setFailure(true);setMessage((e as Error).message);}
    finally{setBusy(false);}
  }
  async function test() {
    if(!registration)return;
    setBusy(true);setFailure(false);
    try {
      const sub=await registration.pushManager.getSubscription();
      if(!sub)throw Error('Ative as notificações primeiro.');
      await api('admin/push/test',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});
      setMessage('Aviso de teste enviado. Confira a Central de Notificações.');
    }catch(e){setFailure(true);setMessage((e as Error).message);}
    finally{setBusy(false);}
  }
  return <section className="surface push-panel" id="notificacoes">
    <div className="panel-heading"><div><h3><Smartphone size={19}/> Goti Pay no seu celular</h3><p>Suas vendas acompanham você.</p></div>
      <span className="badge">{enabled ? 'Avisos ativos' : installed ? 'App instalado' : 'Sem App Store'}</span></div>
    {!installed && <div className="push-install"><Share2 size={22}/><div><strong>Instale no iPhone</strong><p>Abra este painel no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”. Abra pelo ícone Goti Pay e entre na sua conta.</p></div></div>}
    <div className="push-preview"><span className="push-preview-icon"><img src="/goti-pay-avatar.jpg" alt="" width={42} height={42} style={{borderRadius:10}}/></span><div><small>GOTI PAY · AGORA</small><strong>Transação Paga! 🤹🏻</strong><p>from Goti Pay<br/>Valor: € 75,90</p></div></div>
    <p className="muted">Avisos de Pix gerado/pendente e pagamento confirmado. No iPhone, requer iOS 16.4 ou mais recente e permissão de notificações. O valor da venda pode aparecer na tela bloqueada.</p>
    {ready && !supported && <p className="info-note">{ios ? 'Abra pelo ícone na Tela de Início para ativar os avisos.' : 'Este navegador não suporta notificações push. Use um navegador compatível ou o app instalado.'}</p>}
    <div className="form-actions">
      {enabled ? <><button className="primary" disabled={busy} onClick={test}><Send size={16}/> Enviar aviso de teste</button><button className="secondary-button" disabled={busy} onClick={disable}><BellOff size={16}/> Desativar neste aparelho</button></>
        : <button className="primary" disabled={!ready || !registration || busy || (ios&&!installed)} onClick={enable}><Bell size={17}/> {busy?'Ativando…':'Ativar notificações'}</button>}
    </div>
    {message && <p role="status" className={failure?'error-note':'info-note'}>{!failure && <CheckCircle2 size={16}/>} {message}</p>}
  </section>;
}
