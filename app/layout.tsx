import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Financial Assistant — AI-Supported Personal Finance Decision Support",
  description: "Educational purchase-feasibility analysis and Kazakhstan deposit comparison. Prototype v1.0, Astana IT University, BDA-2402.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
