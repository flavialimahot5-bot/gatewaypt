import Gateway from "../gateway";
import { getCurrentUser } from "@/lib/server/auth";
import { allowedEmails, authConfigured } from "@/lib/server/config";
import { login, logout } from "../auth-actions";
import { ShieldCheck, ArrowUpRight, LockKeyhole } from "lucide-react";
import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  manifest: "/braks.webmanifest",
  appleWebApp: { capable: true, title: "Goti Pay", statusBarStyle: "black-translucent" },
  icons: { apple: "/goti-pay-avatar.jpg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#071d22" };
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const ready = authConfigured();
  if (user && allowedEmails().includes(user.email.toLowerCase()))
    return <Gateway />;
  return (
    <main className="login-page">
      <section className="login-story">
        <div>
          <a className="brand" href="/topsdlsodo">
            <span className="goti-logo"><img src="/goti-pay-avatar.jpg" alt="" width={40} height={40} /><span>Goti <span>Pay</span></span></span>
            
          </a>
        </div>
        <div>
          <span className="eyebrow">SUA OPERAÇÃO, EM UM SÓ LUGAR</span>
          <h1>
            O controle está
            <br />
            nas <em>suas mãos.</em>
          </h1>
          <p>Pagamentos, integrações e o próximo passo do seu negócio.</p>
        </div>
        <small className="muted">Goti Pay · Gateway privado</small>
      </section>
      <section className="login-form">
        <div className="login-card">
          <div className="login-icon">
            <LockKeyhole size={24} />
          </div>
          <h2>{user ? "Acesso restrito" : "Bem-vindo de volta"}</h2>
          <p>
            {user
              ? "Esta conta não está autorizada a acessar o workspace."
              : "Entre na sua conta para acompanhar sua operação."}
          </p>
          {params.error && (
            <div className="error-note" role="alert" style={{ marginTop: 20 }}>
              Não foi possível entrar. Confira e-mail e senha ou aguarde alguns minutos antes de tentar novamente.
            </div>
          )}
          {!ready && (
            <div className="info-note" style={{ marginTop: 20 }}>
              O acesso está aguardando a configuração da hospedagem.
            </div>
          )}
          {user ? (
            <>
              <div className="info-note" style={{ marginTop: 20 }}>
                {user.email}
              </div>
              <form action={logout}>
                <button className="primary">
                  Trocar de conta <ArrowUpRight size={18} />
                </button>
              </form>
            </>
          ) : (
            <form action={login} style={{ display: "grid", gap: 16, marginTop: 24 }}>
              <label className="field">E-mail
                <input name="email" type="email" autoComplete="username" required maxLength={254} disabled={!ready} />
              </label>
              <label className="field">Senha
                <input name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={!ready} />
              </label>
              <button className="primary" disabled={!ready}>
                Entrar no painel <ArrowUpRight size={18} />
              </button>
            </form>
          )}
          <small>
            <ShieldCheck
              size={15}
              style={{ display: "inline", marginRight: 6 }}
            />
            Somente contas autorizadas podem entrar.
            <br />
            Suas credenciais de pagamento ficam protegidas no servidor.
          </small>
        </div>
      </section>
    </main>
  );
}
