"use client";

import { useState, type ReactNode } from "react";
import { downloadFile } from "@/components/feedback";

/**
 * Enlace de descarga con avisos: "Preparando…" → "Descargado" (o error con "Reintentar").
 * Sigue siendo un <a href>, así que "abrir en otra pestaña" también funciona.
 */
export function ExportButton({
  href,
  label,
  className,
  children,
}: {
  href: string;
  /** Nombre corto para los avisos ("Excel", "CSV de Pasos"). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <a
      href={href}
      aria-busy={busy || undefined}
      onClick={async (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        await downloadFile(href, { label });
        setBusy(false);
      }}
      className={`${className ?? ""} ${busy ? "cursor-progress opacity-70" : ""}`}
    >
      {children}
    </a>
  );
}
