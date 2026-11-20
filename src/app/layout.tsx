import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FeedbackProviders } from "@/components/feedback/FeedbackProviders";

export const metadata: Metadata = {
  title: "AppHouse · Guía de pruebas QA",
  description: "Guía interactiva para las pruebas de QA de AppHouse",
  icons: { icon: "/logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f5da8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {/* Avisos (toasts), confirmaciones y banner de conexión para todas las páginas */}
        <FeedbackProviders>{children}</FeedbackProviders>
      </body>
    </html>
  );
}
