import type { Metadata } from "next";
import "../../comprar/checkout.css";
import Checkout from "./checkout";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pagamento Seguro",
  description: "Finalize seu pedido e acompanhe o pagamento.",
  icons: { icon: "/checkout-brand/pagamento-seguro.png", shortcut: "/checkout-brand/pagamento-seguro.png" },
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <Checkout token={token} />;
}
