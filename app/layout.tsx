import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RCFM · Catálogo de jogos",
  description: "Baixe instaladores portáteis dos jogos do catálogo RCFM.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
