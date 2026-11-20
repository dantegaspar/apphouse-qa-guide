"use client";

import type { ReactNode } from "react";
import { IconClose, IconOffline, ToneIcon, type FeedbackTone } from "./icons";

export type BannerTone = FeedbackTone | "offline";

const STYLES: Record<BannerTone, { box: string; chip: string; action: string; close: string }> = {
  success: {
    box: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    chip: "bg-emerald-100 text-emerald-700",
    action: "bg-white text-emerald-800 ring-emerald-300 hover:bg-emerald-100",
    close: "text-emerald-700 hover:bg-emerald-100",
  },
  error: {
    box: "bg-rose-50 text-rose-900 ring-rose-200",
    chip: "bg-rose-100 text-rose-700",
    action: "bg-white text-rose-800 ring-rose-300 hover:bg-rose-100",
    close: "text-rose-700 hover:bg-rose-100",
  },
  warning: {
    box: "bg-amber-50 text-amber-950 ring-amber-200",
    chip: "bg-amber-100 text-amber-700",
    action: "bg-white text-amber-900 ring-amber-300 hover:bg-amber-100",
    close: "text-amber-800 hover:bg-amber-100",
  },
  info: {
    box: "bg-brand-50 text-brand-700 ring-brand-100",
    chip: "bg-brand-100 text-brand-600",
    action: "bg-white text-brand-700 ring-brand-100 hover:bg-brand-100",
    close: "text-brand-600 hover:bg-brand-100",
  },
  offline: {
    box: "bg-slate-800 text-white ring-slate-900/20",
    chip: "bg-white/15 text-white",
    action: "bg-white/10 text-white ring-white/30 hover:bg-white/20",
    close: "text-slate-200 hover:bg-white/15",
  },
};

export type BannerProps = {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Botón opcional dentro del banner (p. ej. "Reintentar"). */
  action?: { label: string; onClick: () => void };
  /** Si se pasa, muestra una "X" para cerrar. */
  onClose?: () => void;
  /** Reemplaza el ícono del tono. `null` = sin ícono. */
  icon?: ReactNode;
  /** Por defecto "alert" para error y "status" para el resto. */
  role?: "status" | "alert" | "note";
  /** Más compacto (una línea en teléfonos), para barras fijas. */
  compact?: boolean;
  className?: string;
};

/** Aviso persistente dentro de la página: sin conexión, guardado, advertencias, etc. */
export function Banner({
  tone = "info",
  title,
  children,
  action,
  onClose,
  icon,
  role,
  compact = false,
  className = "",
}: BannerProps) {
  const s = STYLES[tone];
  const glyph =
    icon !== undefined ? icon : tone === "offline" ? <IconOffline className="h-5 w-5" /> : <ToneIcon tone={tone} className="h-5 w-5" />;
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      data-banner={tone}
      className={`flex items-start gap-3 rounded-2xl ring-1 ${compact ? "px-3 py-2" : "p-3.5"} ${s.box} ${className}`}
    >
      {glyph && (
        <span className={`grid shrink-0 place-items-center rounded-full ${compact ? "h-8 w-8" : "h-9 w-9"} ${s.chip}`}>{glyph}</span>
      )}
      <div className={`flex min-w-0 flex-1 flex-col justify-center ${compact ? "min-h-8" : "min-h-9"}`}>
        {title && <p className="text-base font-semibold leading-snug">{title}</p>}
        {children && <div className={`leading-snug ${compact ? "text-sm sm:text-base" : "text-base"} ${title ? "mt-0.5 opacity-90" : ""}`}>{children}</div>}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className={`mt-2 inline-flex min-h-10 items-center self-start rounded-lg px-3 text-sm font-semibold ring-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 ${s.action}`}
          >
            {action.label}
          </button>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar aviso"
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 ${compact ? "-my-1" : ""} ${s.close}`}
        >
          <IconClose className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
