/** Íconos SVG compartidos por avisos, diálogos y banners (sin dependencias). */

export type FeedbackTone = "success" | "error" | "warning" | "info";

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconSuccess({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconError({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

export function IconWarning({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 8.5v5" />
      <path d="M12 17.2v.1" strokeWidth={2.8} />
      <path d="M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    </svg>
  );
}

export function IconInfo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 11v6" />
      <path d="M12 7.2v.1" strokeWidth={2.8} />
    </svg>
  );
}

export function IconOffline({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M2 8.8a15 15 0 0120 0M5 12.4a10 10 0 0114 0M8.5 15.9a5 5 0 017 0" />
      <path d="M12 19.5v.1" strokeWidth={2.8} />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function IconClose({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

/** Colores por tono: chip del ícono, borde lateral y textos (contraste AA sobre blanco). */
export const TONE_STYLES: Record<FeedbackTone, { chip: string; bar: string; title: string }> = {
  success: { chip: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500", title: "text-emerald-800" },
  error: { chip: "bg-rose-100 text-rose-700", bar: "bg-rose-500", title: "text-rose-800" },
  warning: { chip: "bg-amber-100 text-amber-700", bar: "bg-amber-500", title: "text-amber-900" },
  info: { chip: "bg-brand-100 text-brand-600", bar: "bg-brand-500", title: "text-brand-700" },
};

export function ToneIcon({ tone, className }: { tone: FeedbackTone; className?: string }) {
  if (tone === "success") return <IconSuccess className={className} />;
  if (tone === "error") return <IconError className={className} />;
  if (tone === "warning") return <IconWarning className={className} />;
  return <IconInfo className={className} />;
}
