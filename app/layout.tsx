import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Goti Pay Portugal | Gateway privado",
  description: "A sua operação MB WAY e Multibanco num só lugar.",
  robots: { index: false, follow: false },
  icons: { icon: "/goti-pay-avatar.jpg", shortcut: "/goti-pay-avatar.jpg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT">
      <body>{children}</body>
    </html>
  );
}
