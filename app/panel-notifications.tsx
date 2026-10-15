"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import "./panel-notifications.css";

export type PanelNotice = { id: string; sequence: number; event: string; created_at: number; amount: number; currency: string; source: string };
export type NoticeFeed = { cursor: number; events: PanelNotice[] };
export function usePanelNotifications() {
  const cursor = useRef<number | null>(null), enabledRef = useRef(true);
  const [enabled, setEnabled] = useState(true), [notices, setNotices] = useState<PanelNotice[]>([]);
  useEffect(() => {
    try { const value = localStorage.getItem("goti-panel-notifications") !== "off"; enabledRef.current = value; setEnabled(value); } catch {}
  }, []);
  const withCursor = useCallback((path: string) => cursor.current === null ? path : `${path}${path.includes("?") ? "&" : "?"}notification_cursor=${cursor.current}`, []);
  const receive = useCallback((feed?: NoticeFeed) => {
    if (!feed || !Number.isSafeInteger(feed.cursor)) return;
    const previous = cursor.current;
    cursor.current = Math.max(previous ?? 0, feed.cursor);
    if (previous === null || !enabledRef.current || document.visibilityState !== "visible") return;
    const incoming = feed.events.filter(event => event.sequence > previous);
    if (incoming.length) setNotices(current => [...current, ...incoming].slice(-3));
  }, []);
  const dismiss = useCallback((id: string) => setNotices(current => current.filter(item => item.id !== id)), []);
  const toggle = () => {
    const value = !enabledRef.current; enabledRef.current = value; setEnabled(value);
    if (!value) setNotices([]);
    try { localStorage.setItem("goti-panel-notifications", value ? "on" : "off"); } catch {}
  };
  const test = () => setNotices(current => [...current, { id: crypto.randomUUID(), sequence: 0, event: "TEST", created_at: Date.now(), amount: 0, currency: "EUR", source: "test" }].slice(-3));
  return { enabled, notices, withCursor, receive, dismiss, toggle, test };
}
function Notice({ notice, hidden, dismiss }: { notice: PanelNotice; hidden: boolean; dismiss: (id: string) => void }) {
  useEffect(() => { const timer = setTimeout(() => dismiss(notice.id), 9000); return () => clearTimeout(timer); }, [notice.id, dismiss]);
  const test = notice.event === "TEST", paid = notice.event === "PAID";
  const title = test ? "Aviso de teste" : paid ? "Venda aprovada!" : "Pagamento pendente!";
  return <article className={`sale-notice ${paid || test ? "sale-notice-paid" : "sale-notice-pending"}`}>
    <img src="/goti-pay-avatar.jpg" alt="" width={42} height={42}/>
    <div className="sale-notice-content"><strong>{title}</strong><span>Goti Pay{notice.source === "broski" ? " · Portugal" : ""}</span>
      <p>{test ? "Este aviso aparece somente dentro da plataforma." : `Valor: ${hidden ? "••••" : new Intl.NumberFormat(notice.currency === "EUR" ? "pt-PT" : "pt-PT", { style: "currency", currency: notice.currency }).format(notice.amount / 100)}`}</p>
    </div>
    <div className="sale-notice-actions"><time>{new Date(notice.created_at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</time><button type="button" onClick={() => dismiss(notice.id)} aria-label="Fechar notificação"><X size={14}/></button></div>
  </article>;
}
export function PanelNoticeStack({ notices, hidden, dismiss }: { notices: PanelNotice[]; hidden: boolean; dismiss: (id: string) => void }) {
  return <div className="sale-notice-stack" role="status" aria-live="polite" aria-label="Notificações de vendas">{notices.map(notice => <Notice key={notice.id} notice={notice} hidden={hidden} dismiss={dismiss}/>)}</div>;
}
export function PanelNoticeSettings({ enabled, toggle, test }: { enabled: boolean; toggle: () => void; test: () => void }) {
  return <section className="surface section-stack"><div className="section-heading"><h3><Bell size={18}/> Avisos dentro da plataforma</h3><span className="badge">{enabled ? "Ativos neste navegador" : "Desativados"}</span></div>
    <p>Pagamento pendente e venda aprovada aparecem no canto superior direito enquanto você usa o painel. Não precisa permitir notificações do Windows.</p>
    <div className="form-actions"><button className="primary" type="button" onClick={test}>Testar aviso no painel</button><button className="secondary-button" type="button" onClick={toggle}>{enabled ? "Desativar avisos no painel" : "Ativar avisos no painel"}</button></div>
  </section>;
}
