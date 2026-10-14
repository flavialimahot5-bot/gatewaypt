"use client";
import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MAX_PRODUCT_REVIEWS, type ProductReview } from "../lib/product-reviews";
import "./product-reviews-editor.css";

type Props = {
  value: ProductReview[];
  onChange: (update: (rows: ProductReview[]) => ProductReview[]) => void;
  disabled: boolean;
  onUploadingChange: (busy: boolean) => void;
};

export default function ProductReviewsEditor({ value, onChange, disabled, onUploadingChange }: Props) {
  const uploading = useRef(false);
  function update(id: string, fields: Partial<ProductReview>) {
    onChange(rows => rows.map(row => row.id === id ? { ...row, ...fields } : row));
  }
  async function photo(id: string, file?: File) {
    if (!file || uploading.current) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8000000) {
      toast.error("Escolha JPG, PNG ou WebP de até 8 MB.");
      return;
    }
    uploading.current = true;
    onUploadingChange(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const ctx = canvas.getContext("2d")!;
      const size = Math.min(bitmap.width, bitmap.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 160, 160);
      ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 160, 160);
      bitmap.close();
      update(id, { photo: canvas.toDataURL("image/jpeg", 0.78) });
    } catch {
      toast.error("Não foi possível abrir a foto da avaliação.");
    } finally {
      uploading.current = false;
      onUploadingChange(false);
    }
  }
  return <section className="product-reviews-editor" aria-labelledby="product-reviews-title">
    <div className="section-heading">
      <div>
        <h3 id="product-reviews-title">Avaliações deste produto</h3>
        <p>Cadastre avaliações reais deste produto. Sem avaliações, a seção não aparece no checkout.</p>
      </div>
      <span>{value.length}/{MAX_PRODUCT_REVIEWS}</span>
    </div>
    <div className="product-review-fields">
      {value.map((review, index) => <fieldset className="product-review-editor" key={review.id} disabled={disabled}>
        <legend>Avaliação {index + 1}</legend>
        <div className="form-grid">
          <label className="field">Nome de quem avaliou
            <input required minLength={2} maxLength={100} value={review.name} onChange={e => update(review.id, { name: e.target.value })} />
          </label>
          <label className="field">Nota
            <select value={review.rating} onChange={e => update(review.id, { rating: Number(e.target.value) })}>
              {[5, 4, 3, 2, 1].map(rating => <option key={rating} value={rating}>{rating} {rating === 1 ? "estrela" : "estrelas"}</option>)}
            </select>
          </label>
        </div>
        <label className="field">Comentário
          <textarea required minLength={3} maxLength={1000} rows={3} value={review.text} onChange={e => update(review.id, { text: e.target.value })} />
        </label>
        <div className="product-review-photo-row">
          {review.photo && <img src={review.photo} alt={`Foto de ${review.name || "quem avaliou"}`} width={48} height={48} />}
          <label className="field">Foto opcional
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void photo(review.id, e.target.files?.[0]); e.target.value = ""; }} />
            <small>JPG, PNG ou WebP · até 8 MB</small>
          </label>
          {review.photo && <button type="button" className="secondary-button" onClick={() => update(review.id, { photo: "" })}>Remover foto</button>}
          <button type="button" className="secondary-button" aria-label={`Remover avaliação ${index + 1}`} onClick={() => onChange(rows => rows.filter(row => row.id !== review.id))}><Trash2 size={16} /> Remover avaliação</button>
        </div>
      </fieldset>)}
    </div>
    <button type="button" className="secondary-button" disabled={disabled || value.length >= MAX_PRODUCT_REVIEWS} onClick={() => onChange(rows => [...rows, { id: crypto.randomUUID(), name: "", rating: 5, text: "", photo: "" }])}>
      <Plus size={16} /> Adicionar avaliação
    </button>
  </section>;
}
