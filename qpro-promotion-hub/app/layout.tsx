import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QPRO Promotion Hub",
  description: "A unified multi-brand back-office promotion management experience.",
  openGraph: {
    title: "QPRO Promotion Hub",
    description: "One workspace. Every brand. Built-in control.",
    images: [{ url: "/og.png", width: 1672, height: 943, alt: "QPRO Promotion Hub" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "QPRO Promotion Hub",
    description: "One workspace. Every brand. Built-in control.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
