"use client";
import { useRef, useState } from "react";

import type { ProductReview } from "../../lib/product-reviews";

export default function StoreReviews({ reviews }: { reviews: ProductReview[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  if (!reviews.length) return null;
  return <section className="shop-reviews" aria-label="Avaliações do produto">
    <div className="shop-review-track" ref={track} onScroll={() => {
      const el = track.current;
      if (!el || el.children.length < 2) return;
      const first = el.children[0] as HTMLElement;
      const second = el.children[1] as HTMLElement;
      const step = second.offsetLeft - first.offsetLeft;
      if (step > 0) setCurrent(Math.max(0, Math.min(reviews.length - 1, Math.round(el.scrollLeft / step))));
    }}>
      {reviews.map((review) => <article className="shop-review" key={review.id}>
        {review.photo && <img src={review.photo} width={36} height={36} alt={review.name} loading="lazy" />}
        <div className="shop-stars" aria-label={`${review.rating} de 5 estrelas`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
        <strong>{review.name}</strong>
        <p>{review.text}</p>
      </article>)}
    </div>
    {reviews.length > 1 && <div className="shop-review-dots" aria-label="Navegar pelas avaliações">
      {reviews.map((review, i) => <button key={review.id} type="button" aria-label={`Avaliação ${i + 1}`} aria-current={current === i ? "true" : undefined} onClick={() => {
        const el = track.current;
        if (!el) return;
        const card = el.children[i] as HTMLElement;
        const first = el.children[0] as HTMLElement;
        el.scrollTo({ left: card.offsetLeft - first.offsetLeft, behavior: "smooth" });
      }} />)}
    </div>}
  </section>;
}
