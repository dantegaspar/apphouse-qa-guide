"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/*
 * Consejo de primera vez anclado a un elemento ("Toca la captura para verla en grande").
 * Se muestra una sola vez por `id` (se recuerda en localStorage al tocar "Entendido" o el
 * propio elemento) y, si hay varios en pantalla, aparecen de a uno.
 */

const KEY = (id: string) => `apphouse:tip:${id}`;

// ---- "ya visto" en localStorage, con aviso entre componentes y pestañas ----
const seenListeners = new Set<() => void>();
function subscribeSeen(l: () => void) {
  seenListeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    seenListeners.delete(l);
    window.removeEventListener("storage", l);
  };
}
function readSeen(id: string): boolean {
  try {
    return localStorage.getItem(KEY(id)) === "1";
  } catch {
    return false; // sin localStorage (modo privado estricto): se muestra, no se recuerda
  }
}
const memorySeen = new Set<string>();
function markSeen(id: string) {
  memorySeen.add(id);
  try {
    localStorage.setItem(KEY(id), "1");
  } catch {
    /* sin almacenamiento */
  }
  seenListeners.forEach((l) => l());
}

/** Vuelve a mostrar consejos ya vistos (todos si no se pasan ids). Útil para pruebas o un botón "Ver consejos". */
export function resetCoachmarks(ids?: string[]) {
  try {
    const keys = ids ? ids.map(KEY) : Object.keys(localStorage).filter((k) => k.startsWith("apphouse:tip:"));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* sin almacenamiento */
  }
  if (ids) ids.forEach((id) => memorySeen.delete(id));
  else memorySeen.clear();
  seenListeners.forEach((l) => l());
}

/** Estado de un consejo por id: `seen` (false en el servidor no se usa: devuelve true para no parpadear). */
export function useCoachmark(id: string) {
  const seen = useSyncExternalStore(
    subscribeSeen,
    () => memorySeen.has(id) || readSeen(id),
    () => true,
  );
  const dismiss = useCallback(() => markSeen(id), [id]);
  return { seen, dismiss };
}

// ---- cola: un consejo a la vez ----
let queue: string[] = [];
const queueListeners = new Set<() => void>();
const subscribeQueue = (l: () => void) => {
  queueListeners.add(l);
  return () => queueListeners.delete(l);
};
const setQueue = (q: string[]) => {
  queue = q;
  queueListeners.forEach((l) => l());
};

export type CoachmarkProps = {
  /** Identificador estable: se guarda en localStorage para no repetir el consejo. */
  id: string;
  message: ReactNode;
  title?: string;
  /** Lado preferido; si no cabe, se voltea solo. Por defecto "bottom". */
  placement?: "top" | "bottom";
  /** Texto del botón. Por defecto "Entendido". */
  buttonLabel?: string;
  /** Espera antes de aparecer (ms). Por defecto 600. */
  delay?: number;
  /** Condición extra para mostrarlo (p. ej. solo cuando hay captura). Por defecto true. */
  when?: boolean;
  /** Tocar el elemento anclado también cuenta como "Entendido". Por defecto true. */
  dismissOnAnchorClick?: boolean;
  onDismiss?: () => void;
  /** Ancla externa en vez de envolver `children`. */
  targetRef?: RefObject<HTMLElement | null>;
  /** Elemento al que apunta el consejo (se envuelve en un div, o span si `inline`). */
  children?: ReactNode;
  inline?: boolean;
  className?: string;
};

export function Coachmark({
  id,
  message,
  title,
  placement = "bottom",
  buttonLabel = "Entendido",
  delay = 600,
  when = true,
  dismissOnAnchorClick = true,
  onDismiss,
  targetRef,
  children,
  inline = false,
  className,
}: CoachmarkProps) {
  const { seen, dismiss } = useCoachmark(id);
  const wrapRef = useRef<HTMLElement | null>(null);
  // Solo cuenta si el ancla se ve en este diseño: en escritorio hay anclas dentro de bloques
  // `lg:hidden` (y al revés en celular); sin esto la burbuja quedaba en la esquina de la pantalla.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const anchor = targetRef?.current ?? wrapRef.current;
    if (!anchor) return;
    const check = () => setShown(anchor.getClientRects().length > 0 && (anchor.offsetWidth > 0 || anchor.offsetHeight > 0));
    check();
    const ro = new ResizeObserver(check);
    ro.observe(anchor);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [targetRef]);
  const eligible = when && !seen && shown;
  const head = useSyncExternalStore(subscribeQueue, () => queue[0] ?? null, () => null);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);
  const msgId = useId();

  // Entra a la cola mientras sea elegible.
  useEffect(() => {
    if (!eligible) return;
    setQueue([...queue.filter((x) => x !== id), id]);
    return () => setQueue(queue.filter((x) => x !== id));
  }, [eligible, id]);

  // Cuando le toca el turno, espera `delay` y aparece.
  const isHead = eligible && head === id;
  useEffect(() => {
    if (!isHead) return;
    const t = setTimeout(() => setReadyFor(id), delay);
    return () => clearTimeout(t);
  }, [isHead, id, delay]);
  const visible = isHead && readyFor === id;

  const close = useCallback(() => {
    dismiss();
    onDismiss?.();
  }, [dismiss, onDismiss]);

  // Posiciona la burbuja (fixed) junto al ancla; se recalcula al hacer scroll o cambiar tamaño.
  useEffect(() => {
    if (!visible) return;
    const anchor = targetRef?.current ?? wrapRef.current;
    const bubble = bubbleRef.current;
    const arrow = arrowRef.current;
    if (!anchor || !bubble || !arrow) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const a = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const bw = bubble.offsetWidth;
      const bh = bubble.offsetHeight;
      const gap = 12;
      const m = 10;
      let side = placement;
      if (side === "bottom" && a.bottom + gap + bh > vh - m && a.top - gap - bh > m) side = "top";
      else if (side === "top" && a.top - gap - bh < m && a.bottom + gap + bh < vh - m) side = "bottom";
      // Ancla muy ancha (un título a todo lo ancho en escritorio): apunta a su inicio, no al centro vacío
      const wide = a.width > bw * 1.6;
      const cx = wide ? a.left + Math.min(48, a.width / 2) : a.left + a.width / 2;
      const left = Math.min(Math.max(wide ? a.left : cx - bw / 2, m), Math.max(m, vw - bw - m));
      const top = side === "bottom" ? a.bottom + gap : a.top - gap - bh;
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      bubble.dataset.placement = side;
      bubble.style.visibility = a.bottom < 0 || a.top > vh ? "hidden" : "visible";
      arrow.style.left = `${Math.min(Math.max(cx - left, 18), bw - 18)}px`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    const ro = new ResizeObserver(schedule);
    ro.observe(anchor);
    ro.observe(bubble);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [visible, placement, targetRef]);

  // Con ancla externa, tocarla también cierra el consejo.
  useEffect(() => {
    const el = targetRef?.current;
    if (!el || !eligible || !dismissOnAnchorClick) return;
    el.addEventListener("click", close);
    return () => el.removeEventListener("click", close);
  }, [targetRef, eligible, dismissOnAnchorClick, close]);

  const bubble = visible
    ? createPortal(
        <div
          ref={bubbleRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={msgId}
          data-coachmark={id}
          data-placement={placement}
          onKeyDown={(e) => e.key === "Escape" && close()}
          className="group fixed z-[80] w-max max-w-[min(20rem,calc(100vw-20px))] rounded-2xl bg-brand-600 p-4 text-white shadow-[0_12px_32px_-8px_rgb(15_23_42/0.45)] transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none"
          style={{ left: 0, top: 0, visibility: "hidden" }}
        >
          <span
            ref={arrowRef}
            aria-hidden
            className="absolute h-3.5 w-3.5 -translate-x-1/2 rotate-45 rounded-[3px] bg-brand-600 group-data-[placement=bottom]:-top-1.5 group-data-[placement=top]:-bottom-1.5"
          />
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="mt-0.5 text-lg leading-none">
              💡
            </span>
            <div className="min-w-0">
              {title && <p className="text-base font-semibold leading-snug">{title}</p>}
              <p id={msgId} className={`text-base leading-snug ${title ? "mt-0.5 text-white/90" : "font-medium"}`}>
                {message}
              </p>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={close}
              className="inline-flex min-h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
            >
              {buttonLabel}
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  if (!children) return bubble;
  const Wrap = inline ? "span" : "div";
  return (
    <>
      <Wrap
        ref={(el: HTMLElement | null) => {
          wrapRef.current = el;
        }}
        className={className ?? (inline ? "inline-block" : undefined)}
        onClickCapture={eligible && dismissOnAnchorClick ? close : undefined}
      >
        {children}
      </Wrap>
      {bubble}
    </>
  );
}

/** Alias de `Coachmark`. */
export const Tip = Coachmark;
