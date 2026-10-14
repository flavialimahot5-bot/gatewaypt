"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Copy,
  ExternalLink,
  Package,
  ImagePlus,
  Pencil,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Status } from "./views";
import { api, money, dateTime } from "./gateway";
import ProductReviewsEditor from "./product-reviews-editor";
import type { ProductReview } from "../lib/product-reviews";
const fresh = {
  product_type: "physical",
  name: "",
  description: "",
  amount: "",
  shipping: "0,00",
  delivery_days: "5 a 10 dias úteis",
  active: true,
  upsell_enabled: false,
  upsell_url: "",
  image: "",
  reviews: [] as ProductReview[],
};
function cents(v: string) {
  return Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
}
export default function ProductsView() {
  const [products, setProducts] = useState<any[]>([]),
    [orders, setOrders] = useState<any[]>([]),
    [tab, setTab] = useState("products"),
    [form, setForm] = useState(fresh),
    [editing, setEditing] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [reviewUploading, setReviewUploading] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  async function load() {
    try {
      setError("");
      const [p, o] = await Promise.all([
        api("admin/products"),
        api("admin/product-orders"),
      ]);
      setProducts(p.products);
      setOrders(o.orders);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function photo(file?: File) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 8000000
    ) {
      toast.error("Escolha JPG, PNG ou WebP de até 8 MB.");
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      setForm((f) => ({ ...f, image: canvas.toDataURL("image/jpeg", 0.82) }));
    } catch {
      toast.error("Não foi possível abrir a imagem.");
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || reviewUploading) return;
    setBusy(true);
    try {
      const body = {
        ...form,
        amount: cents(form.amount),
        shipping: form.product_type === "digital" ? 0 : cents(form.shipping),
        delivery_days: form.product_type === "digital" ? "Digital" : form.delivery_days,
        image: form.image || undefined,
      };
      await api("admin/products" + (editing ? "/" + editing : ""), {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(editing ? "Produto atualizado" : "Produto criado");
      setOpen(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function edit(selected: any) {
    setBusy(true);
    try {
      const p = await api("admin/products/" + selected.id);
      setEditing(p.id);
      setForm({
        product_type: p.product_type || "physical",
        name: p.name,
        description: p.description,
        amount: (p.amount / 100).toFixed(2).replace(".", ","),
        shipping: (p.shipping / 100).toFixed(2).replace(".", ","),
        delivery_days: p.delivery_days,
        active: p.active,
        upsell_enabled: !!p.upsell_enabled,
        upsell_url: p.upsell_url || "",
        image: "",
        reviews: p.reviews || [],
      });
      setOpen(true);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="section-stack">
      <div className="section-heading">
        <div>
          <h2>Produtos e checkout</h2>
          <p>Seu catálogo, seus links de pagamento.</p>
        </div>
        <button
          className="primary"
          disabled={busy || reviewUploading}
          onClick={() => {
            setTab("products");
            setEditing(null);
            setForm(fresh);
            setOpen(true);
          }}
        >
          <Plus size={18} />
          Novo produto
        </button>
      </div>
      <div className="form-actions" style={{ flexWrap: "wrap" }}>
        <button
          className={tab === "products" ? "primary" : "secondary-button"}
          onClick={() => setTab("products")}
        >
          Produtos
        </button>
        <button
          className={tab === "orders" ? "primary" : "secondary-button"}
          onClick={() => {
            setTab("orders");
            void load();
          }}
        >
          Pedidos e entregas
        </button>
      </div>
      {error && (
        <div className="error-note" role="alert">
          {error}
          <button className="secondary-button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      )}
      {open && (
        <section className="surface">
          <button className="secondary-button" disabled={busy || reviewUploading} onClick={() => setOpen(false)}>
            <ArrowLeft size={16} />
            Voltar
          </button>
          <h3 style={{ margin: "20px 0" }}>
            {editing ? "Editar produto" : "Novo produto"}
          </h3>
          <form onSubmit={save} className="section-stack">
            <div className="form-grid">
              <div>
                <label className="product-upload">
                  <ImagePlus />
                  <span>Escolher foto do produto</span>
                  <small>JPG, PNG ou WebP · até 8 MB</small>
                  <input
                    type="file"
                    disabled={busy || reviewUploading}
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => void photo(e.target.files?.[0])}
                  />
                </label>
                {(form.image || editing) && (
                  <img
                    className="product-photo-preview"
                    src={form.image || `/api/admin/products/${editing}/image`}
                    alt="Prévia do produto"
                  />
                )}
              </div>
              <div className="section-stack">
                <label className="field">
                  Tipo de produto
                  <select value={form.product_type} onChange={e => setForm({ ...form, product_type: e.target.value })}>
                    <option value="physical">Físico</option><option value="digital">Digital</option>
                  </select>
                  <small>Digital solicita e-mail, CPF e telefone, sem endereço ou frete. Nome quando exigido pelo gateway.</small>
                </label>
                <label className="field">
                  Nome do produto
                  <input
                    required
                    minLength={2}
                    maxLength={150}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  Descrição
                  <textarea
                    maxLength={2000}
                    rows={4}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    Preço (€)
                    <input
                      required
                      inputMode="decimal"
                      placeholder="57,90"
                      value={form.amount}
                      onChange={(e) =>
                        setForm({ ...form, amount: e.target.value })
                      }
                    />
                    <small>Mínimo € 5,00</small>
                  </label>
                  {form.product_type === "physical" && <label className="field">
                    Frete (€)
                    <input
                      required
                      inputMode="decimal"
                      value={form.shipping}
                      onChange={(e) =>
                        setForm({ ...form, shipping: e.target.value })
                      }
                    />
                    <small>0,00 para frete grátis</small>
                  </label>}
                </div>
                {form.product_type === "physical" && <label className="field">
                  Prazo de entrega
                  <input
                    required
                    maxLength={100}
                    value={form.delivery_days}
                    onChange={(e) =>
                      setForm({ ...form, delivery_days: e.target.value })
                    }
                  />
                </label>}
                <label>
                  <input type="checkbox" checked={form.upsell_enabled} onChange={e => setForm({ ...form, upsell_enabled: e.target.checked })}/>{" "}
                  Redirecionar após pagamento aprovado
                </label>
                {form.upsell_enabled && <label className="field">Link do upsell
                  <input type="url" required maxLength={2048} placeholder="https://sualoja.com/oferta" value={form.upsell_url} onChange={e => setForm({ ...form, upsell_url: e.target.value })}/>
                  <small>O cliente será redirecionado após a confirmação do pagamento. Válido para novos pedidos deste produto.</small>
                </label>}
                <label>
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) =>
                      setForm({ ...form, active: e.target.checked })
                    }
                  />{" "}
                  Produto ativo
                </label>
              </div>
            </div>
            <ProductReviewsEditor value={form.reviews} onChange={update => setForm(f => ({ ...f, reviews: update(f.reviews) }))} disabled={busy || reviewUploading} onUploadingChange={setReviewUploading} />
            <div>
              <button className="primary" disabled={busy || reviewUploading}>
                {reviewUploading ? "Preparando foto…" : busy ? "Salvando…" : "Salvar produto"}
              </button>
            </div>
          </form>
        </section>
      )}
      {loading ? (
        <p>Carregando catálogo…</p>
      ) : tab === "products" ? (
        <div className="product-grid">
          {!products.length && (
            <section className="surface">
              <Package />
              <h3>Seu primeiro produto começa aqui</h3>
              <p>
                Adicione uma foto e um preço para criar seu link de checkout.
              </p>
            </section>
          )}
          {products.map((p) => (
            <article className="surface product-tile" key={p.id}>
              {p.active ? (
                <img src={p.image_url} alt={p.name} />
              ) : (
                <div className="product-paused">
                  <Package />
                  Produto pausado
                </div>
              )}
              <div className="product-tile-body">
                <span className="badge">{p.active ? "Ativo" : "Pausado"}</span>
                <h3>{p.name}</h3>
                <strong>{money(p.amount)}</strong>
                <p>
                  {p.product_type === "digital" ? "Produto digital · sem frete" : p.shipping ? `Frete: ${money(p.shipping)}` : "Frete grátis"}
                </p>
                <div className="form-actions">
                  <button className="secondary-button" disabled={busy || reviewUploading} onClick={() => void edit(p)}>
                    <Pencil size={15} />
                    Editar
                  </button>
                  <button
                    className="secondary-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(p.checkout_url);
                        toast.success("Link copiado");
                      } catch {
                        toast.error(
                          "Não foi possível copiar. Abra o checkout e copie o endereço.",
                        );
                      }
                    }}
                  >
                    <Copy size={15} />
                    Copiar link
                  </button>
                  <a
                    className="secondary-button"
                    href={p.checkout_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={15} />
                    Checkout
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="section-stack">
          {!orders.length && (
            <section className="surface">
              <h3>Nenhum pedido ainda</h3>
              <p>
                Os pedidos do checkout aparecerão aqui com os dados de entrega.
              </p>
            </section>
          )}
          {orders.map((o) => (
            <article className="surface" key={o.id}>
              <div className="section-heading">
                <div>
                  <h3>{o.product.name}</h3>
                  <small>{dateTime(o.created_at)}</small>
                </div>
                <Status value={o.status} />
                <strong>{money(o.product.amount + o.product.shipping)}</strong>
              </div>
              <p>
                {o.buyer.name ? o.buyer.name + " · " : ""}{o.buyer.email} · {o.buyer.phone}
              </p>
              {o.buyer.address ? <><p>
                {o.buyer.address.street}, {o.buyer.address.number}{" "}
                {o.buyer.address.complement} — {o.buyer.address.district}
              </p>
              <p>
                {o.buyer.address.city}/{o.buyer.address.state} · CEP{" "}
                {o.buyer.address.cep}
              </p></> : <p>Produto digital · sem endereço de entrega</p>}
              <small>Pedido: {o.id}</small>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
