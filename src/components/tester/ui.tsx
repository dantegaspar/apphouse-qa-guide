"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Texto con **negritas** (único formato que usan las guías). */
export function Rich({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-slate-900">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "success" | "danger" | "ghost" | "outline";
  size?: "md" | "lg";
};
export function Button({ variant = "primary", size = "md", className = "", ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
  const sizes = { md: "px-4 py-2.5 text-sm", lg: "px-5 py-3.5 text-base" };
  const variants = {
    primary: "bg-brand-500 text-white hover:bg-brand-600",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    danger: "bg-white text-rose-700 ring-2 ring-rose-200 hover:bg-rose-50",
    outline: "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50",
    ghost: "text-brand-600 hover:bg-brand-50",
  };
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />;
}

/** Hoja modal que sube desde abajo (móvil) o centrada (escritorio). */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "wide": modal amplio en pantallas grandes (p. ej. tablas de datos en la guía de escritorio). */
  size?: "default" | "wide";
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className={`animate-pop relative flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl ${size === "wide" ? "lg:max-h-[86vh] lg:max-w-4xl" : ""}`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="pb-safe border-t border-slate-100 px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Captura del manual; al tocarla se abre en pantalla completa (Lightbox). Las capturas de celular
 * (verticales) se muestran angostas; las de computadora (horizontales) usan todo el ancho.
 * `desktop`: versión para la guía de escritorio en pantallas grandes (lg): la captura ocupa todo el
 * ancho de su columna (hasta 75 % de la altura de la pantalla) y muestra el botón «Pantalla completa».
 */
export function StepImage({
  src,
  caption,
  desktop = false,
  captionAside = false,
}: {
  src: string;
  caption?: string;
  desktop?: boolean;
  /** En escritorio la leyenda ya se muestra junto a la captura (no se repite abajo). */
  captionAside?: boolean;
}) {
  const [open, setOpen] = useState<null | "tap" | "button">(null);
  const [wide, setWide] = useState(false);
  const measure = (img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth) setWide(img.naturalWidth > img.naturalHeight * 1.1);
  };
  const box = desktop
    ? wide
      ? "w-full"
      : "mx-auto w-full max-w-[280px] lg:max-w-none"
    : wide
      ? "w-full"
      : "mx-auto w-full max-w-[280px]";
  return (
    <figure className={`${box} ${desktop ? "group relative" : ""}`} data-wide={wide ? "true" : "false"}>
      <button
        type="button"
        onClick={() => setOpen("tap")}
        className={`block w-full overflow-hidden bg-white shadow-md ring-1 ring-slate-200 ${wide ? "rounded-xl" : "rounded-2xl"} ${
          desktop ? "lg:cursor-zoom-in lg:rounded-xl lg:bg-slate-50 lg:p-2 lg:shadow-sm lg:transition lg:hover:ring-brand-500/40" : ""
        }`}
        aria-label="Ver imagen en pantalla completa"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={measure}
          onLoad={(e) => measure(e.currentTarget)}
          src={src}
          alt={caption || "Captura de la app"}
          className={`block h-auto w-full ${desktop ? "lg:mx-auto lg:max-h-[75vh] lg:rounded-md lg:object-contain" : ""}`}
          loading="lazy"
        />
      </button>
      {desktop && (
        <button
          type="button"
          onClick={() => setOpen("button")}
          className="absolute right-3 top-3 hidden items-center gap-1.5 rounded-lg bg-slate-900/75 px-3 py-1.5 text-sm font-medium text-white shadow-sm backdrop-blur transition hover:bg-slate-900 lg:inline-flex"
        >
          <span aria-hidden="true">⤢</span> Pantalla completa
        </button>
      )}
      {desktop ? (
        <figcaption className="mt-2 text-center text-xs text-slate-500">
          {caption && <span className="lg:hidden">{caption} · toca para ampliar</span>}
          <span className="hidden lg:inline">
            {caption && !captionAside ? `${caption} · ` : ""}Haz clic en la captura para verla en pantalla completa
          </span>
        </figcaption>
      ) : (
        caption && <figcaption className="mt-2 text-center text-xs text-slate-500">{caption} · toca para ampliar</figcaption>
      )}
      {open && <Lightbox src={src} caption={caption} nativeFullscreen={open === "button"} onClose={() => setOpen(null)} />}
    </figure>
  );
}

/**
 * Visor a pantalla completa: fondo oscuro, captura ajustada a la pantalla y botón para verla a
 * tamaño real (se recorre con scroll). Esc o ✕ lo cierran. Con `nativeFullscreen` además pide el
 * modo pantalla completa del navegador (si existe; en iOS basta con el visor).
 */
export function Lightbox({
  src,
  caption,
  onClose,
  nativeFullscreen = false,
}: {
  src: string;
  caption?: string;
  onClose: () => void;
  nativeFullscreen?: boolean;
}) {
  const [actual, setActual] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    // En captura: se cierra el visor antes que una hoja (Sheet) que esté abajo
    window.addEventListener("keydown", onKey, true);
    const el = ref.current;
    let wentFullscreen = false;
    const onFs = () => {
      // Al salir del modo pantalla completa del navegador (p. ej. con Esc) también se cierra el visor
      if (document.fullscreenElement) wentFullscreen = true;
      else if (wentFullscreen) closeRef.current();
    };
    if (nativeFullscreen && el?.requestFullscreen) {
      document.addEventListener("fullscreenchange", onFs);
      el.requestFullscreen().catch(() => {});
    }
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [nativeFullscreen]);

  return createPortal(
    <div
      ref={ref}
      className="animate-pop fixed inset-0 z-[70] flex flex-col bg-slate-950/95 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={caption ? `Captura: ${caption}` : "Captura en pantalla completa"}
      data-testid="lightbox"
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={() => setActual((v) => !v)}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
          aria-pressed={actual}
        >
          {actual ? "⤡ Ajustar a la pantalla" : "🔍 Tamaño real"}
        </button>
        <span className="hidden text-xs text-white/50 sm:inline">
          {actual ? "Desplázate para recorrer la captura" : "Esc para cerrar"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg hover:bg-white/20"
          aria-label="Cerrar"
          autoFocus
        >
          ✕
        </button>
      </div>
      <div
        className={`min-h-0 flex-1 overflow-auto ${actual ? "" : "flex items-center justify-center p-2 sm:p-4"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={caption || ""}
          onClick={() => setActual((v) => !v)}
          className={
            actual
              ? "m-auto block h-auto w-auto max-w-none cursor-zoom-out"
              : "block h-full max-h-full w-full max-w-full cursor-zoom-in rounded-md object-contain"
          }
        />
      </div>
      {caption && <p className="pb-safe shrink-0 px-4 pt-2 text-center text-sm text-white/80">{caption}</p>}
    </div>,
    document.body
  );
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-200 ${className}`}>
      <div className="bg-brand-gradient h-full rounded-full transition-all duration-500" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function Callout({ tone = "warn", children }: { tone?: "warn" | "info"; children: ReactNode }) {
  const tones = {
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    info: "bg-brand-50 text-brand-700 ring-brand-100",
  };
  return <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${tones[tone]}`}>{children}</div>;
}

export const inputCls =
  "w-full rounded-xl border-0 bg-white px-3.5 py-3 text-base text-slate-900 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 focus:outline-none";
