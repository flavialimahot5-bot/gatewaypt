"use client";
import { Fragment, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Clock3, Copy, Filter, Plus, Search, X, ReceiptText, CircleAlert } from "lucide-react";
import { copy } from "./views";
import "./sales-history.css";

export type SaleRow = { id: string; external_reference: string; description: string; amount: number; status: string; gateway?: string; created_at: number; paid_at?: number | null; copy_paste?: string | null; trackerorder_code?: string | null; pix_reviewed_at?: number | null; customer?: { name?: string; email?: string; phone?: string } | null };
const labels: Record<string,string> = { PAID: "Pago", PENDING: "Pendente", CREATING: "Gerando Pix", FAILED: "Falhou", EXPIRED: "Expirado", REFUNDED: "Reembolsado", CHARGEBACK: "Contestado" };
const datePart = (value: number, time = false) => new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", ...(time ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" }) }).format(value);
const dayKey = (value: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year:"numeric",month:"2-digit",day:"2-digit" }).format(value);

export default function SalesHistory({ rows, hidden, onInspect, onCreate, onReview }: { rows: SaleRow[]; hidden: boolean; onInspect: (id:string)=>void; onCreate: ()=>void; onReview: (id: string, reviewed: boolean)=>Promise<void> }) {
  const [search,setSearch]=useState(""), [filters,setFilters]=useState(false), [status,setStatus]=useState("all"), [gateway,setGateway]=useState("all"), [from,setFrom]=useState(""), [to,setTo]=useState(""), [page,setPage]=useState(1), [size,setSize]=useState(10);
  const [reviewFilter,setReviewFilter]=useState("all"), [reviewBusy,setReviewBusy]=useState<string|null>(null);
  async function review(row: SaleRow) { setReviewBusy(row.id); try { await onReview(row.id, !row.pix_reviewed_at); } finally { setReviewBusy(null); } }
  const invalidDates=!!from && !!to && from>to;
  const filtered=rows.filter(row => !invalidDates && (reviewFilter==="all" || (reviewFilter==="reviewed" ? !!row.pix_reviewed_at : !row.pix_reviewed_at)) && (status==="all" || row.status===status) && (gateway==="all" || (row.gateway||"pagpixhub")===gateway) && (!from || dayKey(row.created_at)>=from) && (!to || dayKey(row.created_at)<=to) && [row.id,row.external_reference,row.description,row.customer?.name,row.customer?.email,row.customer?.phone].filter(Boolean).join(" ").toLocaleLowerCase("pt-PT").includes(search.trim().toLocaleLowerCase("pt-PT")));
  const pages=Math.max(1,Math.ceil(filtered.length/size)), current=Math.min(page,pages), start=(current-1)*size, visible=filtered.slice(start,start+size);
  const filterCount=Number(status!=="all")+Number(gateway!=="all")+Number(!!from)+Number(!!to)+Number(reviewFilter!=="all");
  const reset=()=>{setSearch("");setReviewFilter("all");setStatus("all");setGateway("all");setFrom("");setTo("");setPage(1);};
  return <section className="sales-history" aria-label="Histórico de cobranças">
    <div className="sales-toolbar">
      <div className="sales-title"><span className="sales-dot"/><div><h2>Histórico de cobranças</h2><p>Acompanhe cada etapa das suas vendas</p></div></div>
      <div className="sales-actions"><button className="sales-create" onClick={onCreate}><Plus size={17}/> Nova cobrança</button><button className={"sales-filter-button"+(filters?" is-open":"")} aria-expanded={filters} aria-controls="sales-filters" onClick={()=>setFilters(!filters)}><Filter size={16}/> Filtros{filterCount>0 && <span>{filterCount}</span>}</button></div>
    </div>
    <div className="sales-search-row"><label className="sales-search"><Search size={17}/><span className="sr-only">Buscar cobranças</span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Buscar por cliente, telefone, produto ou pedido…"/>{search && <button aria-label="Limpar busca" onClick={()=>{setSearch("");setPage(1);}}><X size={15}/></button>}</label><span className="sales-scope">Últimas {rows.length} cobranças · limite de 100</span></div>
    {filters && <div className="sales-filters" id="sales-filters">
      <label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">Todos os status</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Gateway<select value={gateway} onChange={e=>{setGateway(e.target.value);setPage(1);}}><option value="all">Todos os gateways</option><option value="pagpixhub">PagPixHub</option><option value="plowf">Plowf</option><option value="bravopay">BravoPay</option></select></label>
      <label>Conferência do Pix<select value={reviewFilter} onChange={e=>{setReviewFilter(e.target.value);setPage(1);}}><option value="all">Todos</option><option value="unreviewed">Não conferidos</option><option value="reviewed">Conferidos</option></select></label>
      <label>Criadas a partir de<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label>
      <label>Até<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label>
      <button className="sales-clear" onClick={reset}>Limpar filtros</button>
      {invalidDates && <p className="sales-date-error" role="alert">A data final deve ser igual ou posterior à data inicial.</p>}
    </div>}
    <div className="sales-table-scroll" role="region" aria-label="Tabela de cobranças, deslize para ver todas as colunas" tabIndex={0}>
      <table className="sales-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Tipo</th><th>Status</th><th>Produto</th><th>Gateway</th><th className="sales-amount">Valor</th><th>Pagamento</th><th>Criado em</th><th><span className="sr-only">Detalhes</span></th></tr></thead>
        <tbody>{visible.map(row=><Fragment key={row.id}><tr>
          <td><div className="sales-id"><button className="sales-order-link" onClick={()=>onInspect(row.id)} title={row.external_reference}>{row.external_reference}</button><button className="sales-copy" aria-label={"Copiar pedido "+row.external_reference} onClick={()=>void copy(row.external_reference)}><Copy size={13}/></button></div></td>
          <td><div className="sales-customer"><span title={row.customer?.name || ""}>{row.customer?.name || (row.customer?.email ? "Cliente" : "Não informado")}</span><small title={row.customer?.email || ""}>{row.customer?.email || "—"}</small>{row.customer?.phone ? <button className="sales-phone" title="Copiar telefone do checkout" aria-label={"Copiar telefone " + row.customer.phone} onClick={()=>void copy(row.customer!.phone!)}><span>{row.customer.phone}</span><Copy size={12}/></button> : <small>Telefone não informado</small>}</div></td>
          <td><span className="sales-pix"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 10 10-10 10L2 12 12 2Zm-6 6 4 4-4 4m12-8-4 4 4 4M8 6l4 4 4-4M8 18l4-4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>Pix</span></td>
          <td><span className={"sales-status sales-status-"+row.status}>{row.status==="PAID"?<Check size={13}/>: ["PENDING","CREATING"].includes(row.status)?<Clock3 size={13}/>:<CircleAlert size={13}/>} {labels[row.status]||row.status}</span></td>
          <td><span className="sales-product" title={row.description}>{row.description}</span></td>
          <td><span className="sales-gateway">{row.gateway==="plowf"?"Plowf":row.gateway==="bravopay"?"BravoPay":"PagPixHub"}</span></td>
          <td className="sales-amount">{hidden?"••••":new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR"}).format(row.amount/100)}</td>
          <td>{row.paid_at?<span className="sales-date">{datePart(row.paid_at)}<small>{datePart(row.paid_at,true)}</small></span>:<span className="sales-muted">Não pago</span>}</td>
          <td><span className="sales-date">{datePart(row.created_at)}<small>{datePart(row.created_at,true)}</small></span></td>
          <td><button className="sales-details" aria-label={"Ver pedido "+row.external_reference} onClick={()=>onInspect(row.id)}><ArrowUpRight size={17}/></button></td>
        </tr><tr className="sales-review-row"><td colSpan={10}><div className="sales-review-tools">
          <button className="sales-pix-copy" disabled={!row.copy_paste} onClick={()=>void copy(row.copy_paste!)} aria-label={"Copiar Pix do pedido "+row.external_reference}><Copy size={14}/> {row.copy_paste ? "Copiar Pix" : "Pix indisponível"}</button>
          <button className={"sales-review-button"+(row.pix_reviewed_at?" is-reviewed":"")} disabled={reviewBusy!==null} aria-pressed={!!row.pix_reviewed_at} onClick={()=>void review(row)} title={row.pix_reviewed_at?"Desfazer conferência":"Marcar que você já conferiu este código"}>{row.pix_reviewed_at?<Check size={14}/>:<Clock3 size={14}/>} {reviewBusy===row.id?"Salvando…":row.pix_reviewed_at?"Conferido · desfazer":"Marcar como conferido"}</button>
          {row.trackerorder_code && <button className="sales-pix-copy" onClick={()=>void copy(row.trackerorder_code!)}><Copy size={14}/> Acompanhamento: {row.trackerorder_code}</button>}
          <span className="sales-review-help">{row.pix_reviewed_at?`Conferido em ${datePart(row.pix_reviewed_at)} às ${datePart(row.pix_reviewed_at,true)}`:"Ainda não conferido"} · Controle manual, não altera o pagamento</span>
        </div></td></tr></Fragment>)}</tbody>
      </table>
    </div>
    {!visible.length && <div className="sales-empty"><ReceiptText size={28}/><h3>{rows.length?"Nenhuma cobrança encontrada":"Suas vendas aparecem aqui"}</h3><p>{rows.length?"Ajuste a busca ou os filtros para encontrar o pedido.":"Crie uma cobrança ou compartilhe o link de um produto."}</p>{rows.length>0 && <button className="sales-clear" onClick={reset}>Limpar busca e filtros</button>}</div>}
    <div className="sales-pagination"><span aria-live="polite">Exibindo {filtered.length?start+1:0}–{Math.min(start+size,filtered.length)} de {filtered.length} resultados</span><div><label>Por página<select value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1);}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><button aria-label="Página anterior" disabled={current===1} onClick={()=>setPage(current-1)}><ChevronLeft size={17}/></button><span>{current} / {pages}</span><button aria-label="Próxima página" disabled={current===pages} onClick={()=>setPage(current+1)}><ChevronRight size={17}/></button></div></div>
  </section>;
}
