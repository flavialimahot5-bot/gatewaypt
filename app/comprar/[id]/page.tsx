import type { Metadata } from "next";
import "../checkout.css";
import { notFound } from "next/navigation";
import { findProduct, checkoutProduct } from "@/lib/server/products";
import { ApiError } from "@/lib/server/security";
import ProductCheckout from "./product-checkout";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pagamento Seguro",
  description: "Finalize seu pedido e acompanhe o pagamento.",
  icons: { icon: "/checkout-brand/pagamento-seguro.png", shortcut: "/checkout-brand/pagamento-seguro.png" },
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let product;
  try {
    product = await checkoutProduct(await findProduct(id));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return <ProductCheckout key={product.id} product={product} />;
}
