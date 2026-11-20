"use client";

import { useEffect, useState, type ReactNode } from "react";

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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
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
      <div className="animate-pop relative flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
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
 * Captura del manual; al tocarla se abre en grande. Las capturas de celular (verticales) se
 * muestran angostas; las de computadora (horizontales) usan todo el ancho.
 */
export function StepImage({ src, caption }: { src: string; caption?: string }) {
  const [zoom, setZoom] = useState(false);
  const [wide, setWide] = useState(false);
  const measure = (img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth) setWide(img.naturalWidth > img.naturalHeight * 1.1);
  };
  return (
    <figure className={wide ? "w-full" : "mx-auto w-full max-w-[280px]"} data-wide={wide ? "true" : "false"}>
      <button
        type="button"
        onClick={() => setZoom(true)}
        className={`block w-full overflow-hidden bg-white shadow-md ring-1 ring-slate-200 ${wide ? "rounded-xl" : "rounded-2xl"}`}
        aria-label="Ver imagen en grande"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={measure}
          onLoad={(e) => measure(e.currentTarget)}
          src={src}
          alt={caption || "Captura de la app"}
          className="block h-auto w-full"
          loading="lazy"
        />
      </button>
      {caption && <figcaption className="mt-2 text-center text-xs text-slate-500">{caption} · toca para ampliar</figcaption>}
      {zoom && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={() => setZoom(false)}>
          <div className="flex justify-end p-3">
            <button className="rounded-full bg-white/10 px-3 py-1.5 text-white" aria-label="Cerrar">
              ✕ Cerrar
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {/* En pantallas angostas la captura ancha se muestra más grande y se desplaza con el dedo */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={caption || ""}
              className={wide ? "mx-auto h-auto w-[200vw] max-w-none sm:w-auto sm:max-w-full" : "mx-auto h-auto max-w-full"}
            />
          </div>
          {caption && <p className="pb-safe px-4 pt-2 text-center text-sm text-white/80">{caption}</p>}
        </div>
      )}
    </figure>
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
