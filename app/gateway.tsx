"use client";
import "./products.css";
import ProductsView from "./products-view";
import GatewaysView from "./gateways-view";
import PushPanel from "./push-panel";
import AnalyticsDashboard from "./analytics-dashboard";
import { usePanelNotifications, PanelNoticeStack, PanelNoticeSettings } from "./panel-notifications";
import "./mobile-app.css";
import { logout } from "./auth-actions";

import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  Wallet,
  Store,
  Code2,
  UserRound,
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  Activity,
  ReceiptText,
  Eye,
  EyeOff,
  ChevronRight,
  ShieldCheck,
  Plug,
  RefreshCw,
  LogOut,
  Bell,
  Smartphone,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { AccountView, DeveloperView, FinanceView, SalesView } from "./views";
export const money = (n: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(
    n / 100,
  );
export const dateTime = (n: number) =>
  new Date(n).toLocaleString("pt-PT", {
    timeZone: "Europe/Lisbon",
    dateStyle: "short",
    timeStyle: "short",
  });
export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch("/api/" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
  const body: any = await response.json();
  if (!response.ok)
    throw new Error(
      body.error?.message || "Não foi possível concluir a solicitação.",
    );
  return body;
}
const sections = [
  ["Dashboard", LayoutDashboard],
  ["Financeiro", Wallet],
  ["Vendas", Store],
  ["Produtos", Store],
  ["Gateways", Plug],
  ["Desenvolvedor", Code2],
  ["Conta", UserRound],
] as const;
const subtitles: Record<string, string> = {
  Dashboard: "Resumo de transações",
  Financeiro: "Saldos e movimentações",
  Vendas: "Visualize e gerencie o histórico das suas cobranças",
  Produtos: "Catálogo e checkout da sua loja",
  Gateways: "Processadores e novas cobranças",
  Desenvolvedor: "Sua API. Suas integrações.",
  Conta: "Acesso e segurança do workspace",
};
export function NoRows({
  title = "Nenhum lançamento encontrado",
  description = "Quando houver movimentações, elas aparecem aqui.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <ReceiptText className="empty-icon" />
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
export default function Gateway() {
  const notifications = usePanelNotifications();
  const { withCursor, receive } = notifications;
  const [section, setSection] = useState("Dashboard"),
    [hidden, setHidden] = useState(false),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [dashboardRevision, setDashboardRevision] = useState(0);
  const [date] = useState(
    new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" }),
  );
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api(withCursor("admin/overview?date=" + date));
      setData(result);
      receive(result.notifications);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [date, withCursor, receive]);
  useEffect(() => {
    void refresh();
    const resume = () => { if(document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", resume);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange",resume); };
  }, [refresh]);
  useEffect(() => {
    const target = new URL(location.href).searchParams.get("section");
    if (target && sections.some(([name]) => name === target)) setSection(target);
  }, []);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "navigate_gateway",
          description:
            "Abre uma seção do painel Goti Pay; não cria cobranças nem altera configurações.",
          inputSchema: {
            type: "object",
            properties: {
              section: { type: "string", enum: sections.map(([name]) => name) },
            },
            required: ["section"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: async (input: unknown) => {
            const s = (input as any)?.section;
            if (!sections.some(([n]) => n === s))
              throw new Error("Seção inválida.");
            setSection(s);
            await new Promise((r) => requestAnimationFrame(r));
            return { section: s };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
    return () => controller.abort();
  }, []);
  const name = data?.user.name || "Minha conta";
  return (
    <SidebarProvider>
      <Sidebar className="side">
        <SidebarHeader>
          <a className="brand" href="/topsdlsodo">
            <span className="goti-logo"><img src="/goti-pay-avatar.jpg" alt="" width={40} height={40} /><span>Goti <span>Pay</span></span></span>
            
          </a>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-caption">WORKSPACE</div>
          <SidebarMenu>
            {sections.map(([n, Icon]) => (
              <SidebarMenuItem key={n}>
                <SidebarMenuButton
                  isActive={section === n}
                  onClick={() => setSection(n)}
                  className="nav-item"
                >
                  <Icon />
                  <span>{n}</span>
                  {n !== "Dashboard" && <ChevronRight className="ml-auto" />}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="side-security">
            <ShieldCheck size={17} />
            <span>Acesso privado</span>
          </div>
          <div className="workspace-user">
            <span className="avatar">{name[0].toUpperCase()}</span>
            <div>
              <strong>Minha operação</strong>
              <small>Workspace privado</small>
            </div>
          </div>
          <form action={logout}>
            <button className="secondary-button" type="submit">
              <LogOut size={15} /> Sair da conta
            </button>
          </form>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className={"workspace" + (section === "Vendas" ? " sales-workspace" : "")}>
        <header className="topbar">
          <div className="heading">
            <SidebarTrigger />
            <div>
              <div className="eyebrow">
                {section === "Dashboard" ? "VISÃO GERAL" : "MINHA OPERAÇÃO"}
              </div>
              <h1>{section}</h1>
              <p>{subtitles[section]}</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="icon-button" aria-label="App e notificações" onClick={() => setSection("Conta")}><Bell size={19}/></button>
            <button
              className="icon-button"
              disabled={busy}
              aria-label="Atualizar dados"
              onClick={() => { void refresh(); setDashboardRevision(n => n+1); }}
            >
              <RefreshCw size={17} className={busy ? "animate-spin" : ""} />
            </button>
            <button
              className="icon-button"
              aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
              onClick={() => setHidden(!hidden)}
            >
              {hidden ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
            <span className="vertical-rule" />
            <span className="avatar">{name[0].toUpperCase()}</span>
            <strong>{name}</strong>
          </div>
        </header>
        {error && (
          <div className="error-note" role="alert">
            {error}{" "}
            <button className="secondary-button" onClick={() => { void refresh(); setDashboardRevision(n => n+1); }}>
              Tentar novamente
            </button>
          </div>
        )}
        {!data && !error && (
          <div className="stats-grid">
            {[1, 2, 3, 4].map((n) => (
              <Skeleton key={n} className="h-36 rounded-2xl" />
            ))}
          </div>
        )}
        {data && (
          <>
            {!data.provider.enabled && (
              <div className="connection-note">
                <span>
                  <Plug size={17} />
                  {data.provider.connected
                    ? "Recebimentos aguardando liberação externa"
                    : "Ligue a Broski para começar a receber"}
                </span>
                <button onClick={() => setSection("Desenvolvedor")}>
                  Configurar integração <ArrowUpRight size={15} />
                </button>
              </div>
            )}
            {section === "Dashboard" && <AnalyticsDashboard hidden={hidden} revision={dashboardRevision} withCursor={withCursor} receiveNotifications={receive} />}
            {section === "Financeiro" && (
              <FinanceView data={data} hidden={hidden} />
            )}
            {section === "Vendas" && (
              <SalesView data={data} refresh={refresh} hidden={hidden} />
            )}
            {section === "Desenvolvedor" && (
              <DeveloperView data={data} refresh={refresh} />
            )}
            {section === "Produtos" && <ProductsView />}
            {section === "Gateways" && <GatewaysView refresh={refresh} />}
            {section === "Conta" && <div className="section-stack"><PanelNoticeSettings enabled={notifications.enabled} toggle={notifications.toggle} test={notifications.test}/><PushPanel/><AccountView data={data} /></div>}
          </>
        )}
        <footer className="page-footer">
          <span>
            <ShieldCheck size={14} /> Workspace privado · Goti Pay
          </span>
          <span>Valores em euros (EUR)</span>
        </footer>
        <nav className="gateway-mobile-nav" aria-label="Navegação do aplicativo">
          {[["Dashboard",LayoutDashboard],["Vendas",Store],["Produtos",ReceiptText],["Conta",Bell]].map(([label, Icon]) => {
            const ItemIcon = Icon as typeof Bell;
            return <button key={String(label)} aria-current={section===label?"page":undefined} onClick={()=>{setSection(String(label));window.scrollTo({top:0,behavior:"smooth"});}}><ItemIcon size={21}/><span>{label as string}</span></button>;
          })}
        </nav>
      </SidebarInset>
      <PanelNoticeStack notices={notifications.notices} hidden={hidden} dismiss={notifications.dismiss}/>
      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  );
}
