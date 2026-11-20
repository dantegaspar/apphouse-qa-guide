"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { IconClose, Spinner, TONE_STYLES, ToneIcon, type FeedbackTone } from "./icons";

/*
 * Avisos flotantes ("toasts"). El estado vive en un store de módulo, así que `toast.success(...)`
 * funciona desde cualquier componente cliente (o código cliente fuera de React) mientras
 * <ToastProvider> esté montado en el layout raíz.
 */

export type ToastType = FeedbackTone | "loading";
export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = {
  /** Mismo id = reemplaza el aviso existente en su lugar (útil para "Preparando…" → "Listo"). */
  id?: string;
  title?: string;
  action?: ToastAction;
  /** Milisegundos visibles. `Infinity` o 0 = no se cierra solo. */
  duration?: number;
  /** Se llama cuando el aviso se cierra (por tiempo, por el usuario o con `toast.dismiss`). */
  onDismiss?: () => void;
};

type ToastItem = {
  id: string;
  type: ToastType;
  message: ReactNode;
  title?: string;
  action?: ToastAction;
  duration: number;
  onDismiss?: () => void;
  leaving: boolean;
  /** Cambia en cada actualización: reinicia el temporizador. */
  version: number;
};

const MAX_VISIBLE = 3;
const EXIT_MS = 200;
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  error: 9000,
  loading: Infinity,
};

type Announcement = { text: string; n: number };
type State = { toasts: ToastItem[]; polite: Announcement; assertive: Announcement };

let state: State = { toasts: [], polite: { text: "", n: 0 }, assertive: { text: "", n: 0 } };
const listeners = new Set<() => void>();
let seq = 0;

function setState(next: State) {
  state = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getState = () => state;

function plainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  return "";
}

function show(type: ToastType, message: ReactNode, opts: ToastOptions = {}): string {
  const id = opts.id ?? `t${++seq}`;
  const base = DEFAULT_DURATION[type];
  const duration =
    opts.duration === 0 ? Infinity : opts.duration ?? (opts.action && Number.isFinite(base) ? Math.max(base, 8000) : base);
  const existing = state.toasts.find((t) => t.id === id);
  const item: ToastItem = {
    id,
    type,
    message,
    title: opts.title,
    action: opts.action,
    duration,
    onDismiss: opts.onDismiss,
    leaving: false,
    version: (existing?.version ?? 0) + 1,
  };
  let toasts = existing ? state.toasts.map((t) => (t.id === id ? item : t)) : [...state.toasts, item];

  // Máximo 3 visibles: los más viejos salen.
  const active = toasts.filter((t) => !t.leaving);
  const extra = active.length - MAX_VISIBLE;
  if (extra > 0) {
    const drop = new Set(active.slice(0, extra).map((t) => t.id));
    toasts = toasts.map((t) => (drop.has(t.id) ? { ...t, leaving: true } : t));
    drop.forEach(scheduleRemoval);
  }

  // Lector de pantalla: errores con aria-live="assertive", el resto "polite".
  const text = [opts.title, plainText(message)].filter(Boolean).join(". ");
  const key = type === "error" ? "assertive" : "polite";
  setState({ ...state, toasts, [key]: { text, n: state[key].n + 1 } });
  return id;
}

function scheduleRemoval(id: string) {
  setTimeout(() => {
    const t = state.toasts.find((x) => x.id === id);
    if (!t || !t.leaving) return;
    setState({ ...state, toasts: state.toasts.filter((x) => x.id !== id) });
    t.onDismiss?.();
  }, EXIT_MS);
}

function dismiss(id?: string) {
  const ids = state.toasts.filter((t) => !t.leaving && (id === undefined || t.id === id)).map((t) => t.id);
  if (!ids.length) return;
  setState({ ...state, toasts: state.toasts.map((t) => (ids.includes(t.id) ? { ...t, leaving: true } : t)) });
  ids.forEach(scheduleRemoval);
}

export const toast = {
  success: (message: ReactNode, opts?: ToastOptions) => show("success", message, opts),
  error: (message: ReactNode, opts?: ToastOptions) => show("error", message, opts),
  info: (message: ReactNode, opts?: ToastOptions) => show("info", message, opts),
  warning: (message: ReactNode, opts?: ToastOptions) => show("warning", message, opts),
  /** Aviso con ruedita que no se cierra solo; reemplázalo después con el mismo `id`. */
  loading: (message: ReactNode, opts?: ToastOptions) => show("loading", message, opts),
  /** Cierra un aviso por id, o todos si no se pasa id. */
  dismiss,
};
export type Toast = typeof toast;

/** Devuelve el objeto `toast` (también se puede importar directo). */
export function useToast(): Toast {
  return toast;
}

/**
 * Sube la pila de avisos `px` píxeles mientras el componente esté montado (por ejemplo, para no
 * tapar una barra de botones fija abajo).
 */
export function useToastOffset(px: number) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--toast-offset", `${px}px`);
    return () => {
      root.style.removeProperty("--toast-offset");
    };
  }, [px]);
}

const subscribeVisibility = (l: () => void) => {
  document.addEventListener("visibilitychange", l);
  return () => document.removeEventListener("visibilitychange", l);
};

function ToastCard({ item, hidden }: { item: ToastItem; hidden: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [fling, setFling] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const timer = useRef({ remaining: item.duration, version: item.version });
  const paused = hovered || focused || drag !== null || hidden;

  useEffect(() => {
    if (!Number.isFinite(item.duration) || item.leaving) return;
    const t = timer.current;
    if (t.version !== item.version) {
      t.version = item.version;
      t.remaining = item.duration;
    }
    if (paused) return;
    const began = Date.now();
    const h = setTimeout(() => dismiss(item.id), Math.max(0, t.remaining));
    return () => {
      clearTimeout(h);
      t.remaining -= Date.now() - began;
    };
  }, [item.id, item.version, item.duration, item.leaving, paused]);

  const tone: FeedbackTone = item.type === "loading" ? "info" : item.type;
  const s = TONE_STYLES[tone];

  function onPointerDown(e: React.PointerEvent<HTMLLIElement>) {
    if ((e.target as HTMLElement).closest("button,a")) return;
    start.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: 0, y: 0 });
  }
  function onPointerMove(e: React.PointerEvent<HTMLLIElement>) {
    const st = start.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.hypot(dx, dy) > 8) st.moved = true;
    if (st.moved) setDrag({ x: dx, y: Math.max(0, dy) });
  }
  function onPointerUp(e: React.PointerEvent<HTMLLIElement>) {
    const st = start.current;
    start.current = null;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = Math.max(0, e.clientY - st.y);
    setDrag(null);
    if (!st.moved) return dismiss(item.id); // toque = cerrar
    if (Math.abs(dx) > 70 || dy > 40) {
      setFling(Math.abs(dx) > dy ? { x: Math.sign(dx) * 420, y: 0 } : { x: 0, y: 140 });
      dismiss(item.id);
    }
  }

  const offset = fling ?? drag;
  const style: React.CSSProperties | undefined = offset
    ? {
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        opacity: fling ? 0 : Math.max(0.35, 1 - Math.max(Math.abs(offset.x) / 260, offset.y / 140)),
        transition: drag && !fling ? "none" : undefined,
      }
    : undefined;

  return (
    <li
      data-toast={item.type}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        setDrag(null);
      }}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setFocused(false)}
      onKeyDown={(e) => e.key === "Escape" && dismiss(item.id)}
      style={style}
      className={
        "pointer-events-auto relative flex w-full touch-none select-none items-start gap-3 overflow-hidden rounded-2xl bg-white py-3 pl-4 pr-2 shadow-[0_10px_30px_-8px_rgb(15_23_42/0.35)] ring-1 ring-slate-900/10 " +
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none starting:-translate-y-4 starting:opacity-0 sm:starting:translate-y-4 " +
        (item.leaving && !fling ? "translate-y-2 scale-95 opacity-0" : "")
      }
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${s.bar}`} />
      <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${s.chip}`}>
        {item.type === "loading" ? <Spinner className="h-5 w-5" /> : <ToneIcon tone={tone} className="h-5 w-5" />}
      </span>
      <div className="mt-0.5 flex min-h-9 min-w-0 flex-1 flex-col justify-center">
        {item.title && <p className="text-base font-semibold leading-snug text-slate-900">{item.title}</p>}
        <div className={`text-base leading-snug ${item.title ? "mt-0.5 text-slate-700" : "font-medium text-slate-800"}`}>{item.message}</div>
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action!.onClick();
              dismiss(item.id);
            }}
            className="mt-2 inline-flex min-h-10 items-center self-start rounded-lg bg-brand-50 px-3 text-sm font-semibold text-brand-600 ring-1 ring-brand-100 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Cerrar aviso"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40"
      >
        <IconClose className="h-5 w-5" />
      </button>
    </li>
  );
}

/** Pila de avisos + regiones aria-live. Montado una vez por <ToastProvider>. */
export function Toaster() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false,
  );
  // Un carácter invisible alterna para que un mensaje repetido se vuelva a anunciar.
  const zw = (n: number) => (n % 2 ? "​" : "");
  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
        {s.polite.text + zw(s.polite.n)}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {s.assertive.text + zw(s.assertive.n)}
      </div>
      <section
        aria-label="Avisos"
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] px-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:top-auto sm:bottom-0 sm:left-auto sm:right-5 sm:w-[25rem] sm:px-0 sm:pt-0"
        style={{ paddingBottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + var(--toast-offset, 0px))" }}
      >
        <ol className="mx-auto flex w-full max-w-md flex-col gap-2">
          {s.toasts.map((t) => (
            <ToastCard key={t.id} item={t} hidden={hidden} />
          ))}
        </ol>
      </section>
    </>
  );
}

export function ToastProvider({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
