import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "kibisis.dev",
  description: "Semantic search and 3D atlas for Greco-Roman classics.",
  icons: {
    icon: "/favicon.ico"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
