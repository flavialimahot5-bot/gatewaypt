"use client";
import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, CheckCheck, CircleDollarSign, Eye, Radio, RefreshCw, ShoppingBag, Users, Wallet } from "lucide-react";
import "./analytics-dashboard.css";
import type { NoticeFeed } from "./panel-notifications";

const labels = ["No checkout", "Dados pessoais", "Entrega", "Pagamento", "pagamento gerado", "Compra aprovada"];
const periods = [["today", "Hoje"], ["yesterday", "Ontem"], ["week", "7 dias"], ["month", "Mês"], ["year", "Ano"]];
const money = (value: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value / 100);
const percentage = (part: number, total: number) => total ? (100 * part / total).toLocaleString("pt-PT", { maximumFractionDigits: 1 }) + "%" : "0%";
export default function AnalyticsDashboard({ hidden, revision, withCursor, receiveNotifications }: { hidden: boolean; revision: number; withCursor: (path: string) => string; receiveNotifications: (feed?: NoticeFeed) => void }) {
  const [period, setPeriod] = useState("today"), [date, setDate] = useState(""), [data, setData] = useState<any>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false, running = false;
    const controller = new AbortController();
    setData(null);
    const load = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const response = await fetch(withCursor(`/api/admin/analytics?period=${period}&date=${date}`), { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "Não foi possível atualizar a dashboard.");
        if (!cancelled) { setData(result); receiveNotifications(result.notifications); setError(""); }
      } catch (e) { if (!cancelled) setError((e as Error).message); }
      finally { running = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    document.addEventListener("visibilitychange", load);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [period, date, refresh, revision, withCursor, receiveNotifications]);
  const fmt = (n: number) => hidden ? "••••" : money(n || 0);
  const number = (n: number) => hidden ? "••" : String(n || 0);
  const ratio = (a: number, b: number) => hidden ? "••" : percentage(a, b);
  const funnel = data ? [data.funnel.arrivals, data.funnel.filling, data.funnel.shipping, data.funnel.payment, data.funnel.pix, data.funnel.paid] : [];
  const totalLive = data?.live.reduce((sum: number, row: any) => sum + row.count, 0) || 0;
  return <div className="analytics-dashboard">
    <div className="analytics-toolbar"><div><h2>Desempenho das vendas</h2><p>Do primeiro acesso à confirmação do pagamento.</p></div><div className="analytics-filters">
      {periods.map(([key,label]) => <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>)}
      <input type="date" aria-label="Escolher data da dashboard" value={date} onChange={e => { if(e.target.value) { setDate(e.target.value); setPeriod("custom"); } }}/>
    </div></div>
    {error && <div className="analytics-error" role="alert">{error} Os números podem estar desatualizados. <button onClick={() => setRefresh(n => n+1)}>Tentar novamente</button></div>}
    {!data ? <div className="surface analytics-loading" role="status"><RefreshCw size={22}/> Carregando indicadores…</div> : <>
      <div className="analytics-cards">
        <article className="surface analytics-card"><span><ShoppingBag size={18}/> Vendas totais</span><strong>{fmt(data.sales.total)}</strong><p>{number(data.sales.orders)} cobranças criadas no período</p><small>Inclui pendentes e encerradas; não é saldo disponível.</small></article>
        <article className="surface analytics-card analytics-highlight"><span><CircleDollarSign size={18}/> Recebido</span><strong>{fmt(data.received.amount)}</strong><p>{number(data.received.count)} pagamentos confirmados no período</p><small>Confirmação pelo gateway de cada cobrança.</small></article>
        <article className="surface analytics-card"><span><Wallet size={18}/> {data.received.estimated_net ? "Líquido estimado após taxas" : "Líquido após taxas"}</span><strong>{data.received.missing_fees ? "—" : fmt(data.received.amount - data.received.fees)}</strong><p>{data.received.missing_fees ? "Aguardando taxas do processador" : `${fmt(data.received.fees)} em taxas do processador`}</p><small>Não desconta anúncios, produto ou frete; não é lucro.</small></article>
        <article className="surface analytics-card"><span><ArrowUpRight size={18}/> Ticket médio</span><strong>{fmt(data.received.count ? Math.round(data.received.amount / data.received.count) : 0)}</strong><p>Valor médio dos pagamentos confirmados</p></article>
        <article className="surface analytics-card"><span><CheckCheck size={18}/> Conversão de pagamento</span><strong>{ratio(data.sales.converted, data.sales.generated)}</strong><p>{number(data.sales.generated)} gerados · {number(data.sales.converted)} pagos</p><small>Cobranças geradas no período, com status atual.</small></article>
        <article className="surface analytics-card"><span><Users size={18}/> Conversão do checkout</span><strong>{ratio(data.funnel.paid, data.funnel.arrivals)}</strong><p>{number(data.funnel.paid)} compras / {number(data.funnel.arrivals)} visitas acompanhadas</p><small>Visitas iniciadas no período, com pagamento confirmado.</small></article>
      </div>
      <section className="surface analytics-live">
        <div className="analytics-heading"><div><h3><Radio size={19}/> Checkout ao vivo</h3><p>Presença nos últimos 90 segundos · última etapa alcançada</p></div><span className={error ? "analytics-status stale" : "analytics-status"}><i/>{error ? "Atualização interrompida" : `${number(totalLive)} ativos agora`}</span></div>
        <div className="analytics-stages">{labels.map((label, i) => <div key={label}><span className="analytics-stage-dot">{i === 5 ? <CheckCheck size={19}/> : i+1}</span><strong>{number(data.live.find((row: any) => row.stage === i)?.count || 0)}</strong><span>{label}</span></div>)}</div>
        <div className="analytics-sync"><Activity size={14}/> Atualiza a cada 10s · última leitura {new Date(data.updated_at).toLocaleTimeString("pt-PT")}</div>
      </section>
      <div className="analytics-details">
        <section className="surface analytics-funnel"><div className="analytics-heading"><div><h3>Funil do período</h3><p>Visitas únicas por sessão e produto · etapas acumuladas</p></div></div>
          {labels.map((label,i) => <div className="analytics-funnel-row" key={label}><div><span>{label}</span><b>{number(funnel[i])} <small>{ratio(funnel[i],funnel[0])}</small></b></div><div className="analytics-track"><i style={{width: hidden ? 0 : `${funnel[0] ? 100*funnel[i]/funnel[0] : 0}%`}}/></div></div>)}
          <p className="analytics-note">O acompanhamento começa nesta atualização. Visitas antigas não têm etapas reconstruídas.</p>
        </section>
        <section className="surface analytics-abandoned"><Eye size={24}/><h3>Saídas sem pedido</h3><strong>{number(data.funnel.abandoned)}</strong><p>Visitas do período sem pedido criado e sem atividade há mais de 10 minutos.</p><div><span>pagamento aguardando pagamento</span><b>{number(data.sales.pending)}</b></div><small>Fechar ou deixar o checkout em segundo plano encerra a presença após 90 segundos. São sinais de atividade, não identificação de pessoas.</small></section>
      </div>
      <section className="surface analytics-visitors"><div className="analytics-heading"><div><h3>Atividade dos últimos 10 minutos</h3><p>Sem nomes, CPF ou conteúdo digitado nos campos.</p></div><span>{number(data.visitors.length)} visitas exibidas</span></div>
        {!data.visitors.length ? <p className="analytics-empty">Nenhuma visita recente. As etapas aparecem quando alguém abre um checkout.</p> : <div className="analytics-table-wrap"><table><thead><tr><th>Visita</th><th>Produto</th><th>Etapa alcançada</th><th>Presença</th></tr></thead><tbody>{data.visitors.map((visit: any) => <tr key={visit.id}><td>#{hidden ? "••••" : visit.id.slice(0,8)}</td><td>{hidden ? "••••" : visit.product || "Produto"}</td><td><span className="analytics-pill">{labels[visit.stage]}</span>{["EXPIRED","FAILED","REFUNDED","CHARGEBACK"].includes(visit.status) && <small> · {({EXPIRED:"Expirado",FAILED:"Falhou",REFUNDED:"Reembolsado",CHARGEBACK:"Contestado"} as Record<string,string>)[visit.status]}</small>}</td><td>{data.updated_at - visit.last_seen <= 90000 ? "Ativa agora" : "Inativa"}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="surface analytics-visitors"><div className="analytics-heading"><div><h3>Últimas cobranças do período</h3><p>Valores e situação registrados no gateway</p></div></div>{!data.recent.length ? <p className="analytics-empty">Nenhuma cobrança neste período.</p> : <div className="analytics-table-wrap"><table><thead><tr><th>Descrição</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{data.recent.map((tx:any) => <tr key={tx.id}><td>{hidden ? "••••" : tx.description}</td><td>{fmt(tx.amount)}</td><td>{({PAID:"Aprovada",PENDING:"Pendente",CREATING:"Gerando pagamento",EXPIRED:"Expirada",FAILED:"Falhou",REFUNDED:"Reembolsada",CHARGEBACK:"Contestada"} as Record<string,string>)[tx.status] || tx.status}</td></tr>)}</tbody></table></div>}</section>
    </>}
  </div>;
}
