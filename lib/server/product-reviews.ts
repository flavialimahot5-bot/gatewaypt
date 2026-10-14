import { z } from "zod";
import sharp from "sharp";
import { ApiError } from "./security";
import { MAX_PRODUCT_REVIEWS, type ProductReview } from "../product-reviews";

export const productReviewsSchema = z.array(z.object({
  id: z.string().uuid(), name: z.string().trim().min(2).max(100),
  rating: z.number().int().min(1).max(5), text: z.string().trim().min(3).max(1000),
  photo: z.string().max(100000).default(""),
}).strict()).max(MAX_PRODUCT_REVIEWS).refine(rows => new Set(rows.map(r => r.id)).size === rows.length, "Avaliações duplicadas.");

export function readProductReviews(value: unknown): ProductReview[] {
  try { return productReviewsSchema.parse(JSON.parse(typeof value === "string" ? value : "[]")); }
  catch { return []; }
}

export async function prepareProductReviews(reviews: ProductReview[], previous: ProductReview[]) {
  const result: ProductReview[] = [];
  for (const review of reviews) {
    if (!review.photo || previous.some(old => old.id === review.id && old.photo === review.photo)) {
      result.push(review); continue;
    }
    const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(review.photo);
    if (!match) throw new ApiError(422, "review_photo_invalid", "Use uma foto JPG, PNG ou WebP na avaliação.");
    try {
      const image = await sharp(Buffer.from(match[1], "base64"), { limitInputPixels: 4000000, animated: false })
        .rotate().resize(160, 160, { fit: "cover", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
      if (image.length > 50000) throw new Error("large");
      result.push({ ...review, photo: "data:image/jpeg;base64," + image.toString("base64") });
    } catch { throw new ApiError(422, "review_photo_invalid", "Foto da avaliação inválida. Escolha outra imagem."); }
  }
  return result;
}
