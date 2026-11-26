"use client";

import { useState, type ReactNode } from "react";
import { downloadFile } from "@/components/feedback";
import { useViewRound, withRoundParam } from "@/components/admin/ViewRound";

/**
 * Enlace de descarga con avisos: "Preparando…" → "Descargado" (o error con "Reintentar").
 * Sigue siendo un <a href>, así que "abrir en otra pestaña" también funciona.
 * Agrega ?round= con la ronda que el admin tiene en pantalla.
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
  const url = withRoundParam(href, useViewRound());
  return (
    <a
      href={url}
      aria-busy={busy || undefined}
      onClick={async (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        await downloadFile(url, { label });
        setBusy(false);
      }}
      className={`${className ?? ""} ${busy ? "cursor-progress opacity-70" : ""}`}
    >
      {children}
    </a>
  );
}
