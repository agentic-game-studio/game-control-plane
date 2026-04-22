import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Game Studio Control Plane",
  description: "Multi-agent game development orchestration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}