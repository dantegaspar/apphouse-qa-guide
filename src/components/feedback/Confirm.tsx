"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { IconInfo, IconWarning } from "./icons";

/*
 * Diálogo de confirmación: `const ok = await confirm({...})`. Usa <dialog> nativo en modo modal
 * (el resto de la página queda inerte), con foco atrapado, Esc = cancelar y clic fuera = cancelar.
 * En teléfonos sale como hoja desde abajo; en escritorio, centrado.
 */

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  /** Texto del botón principal. Por defecto "Aceptar" (o "Sí, continuar" con tone="danger"). */
  confirmLabel?: string;
  /** Por defecto "Cancelar". */
  cancelLabel?: string;
  /** "danger" pinta el botón en rojo y pone el foco inicial en Cancelar. */
  tone?: "danger" | "default";
};
export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

type Request = ConfirmOptions & { key: number; resolve: (v: boolean) => void };

let queue: Request[] = [];
let mounted = 0;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const current = () => queue[0] ?? null;

/** Pide confirmación. Sin <ConfirmProvider> montado usa window.confirm como respaldo. */
export const confirm: ConfirmFn = (opts) => {
  if (!mounted) {
    const text = [opts.title, typeof opts.message === "string" ? opts.message : ""].filter(Boolean).join("\n\n");
    return Promise.resolve(typeof window !== "undefined" && window.confirm(text));
  }
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { ...opts, key: ++seq, resolve }];
    emit();
  });
};

function settle(value: boolean) {
  const [head, ...rest] = queue;
  if (!head) return;
  queue = rest;
  emit();
  head.resolve(value);
}

export function useConfirm(): ConfirmFn {
  return confirm;
}

function ConfirmDialog({ req }: { req: Request }) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const danger = req.tone === "danger";

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!dlg.open) dlg.showModal();
    (danger ? cancelRef : confirmRef).current?.focus();
    return () => {
      if (dlg.open) dlg.close();
      // Devuelve el foco a donde estaba (el botón que abrió el diálogo).
      if (previous?.isConnected) previous.focus();
    };
  }, [danger]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== "Tab") return;
    // Foco atrapado: Tab y Shift+Tab giran entre los botones del diálogo.
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
    e.preventDefault();
    items[next].focus();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={req.message ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault(); // Esc: cerramos nosotros para resolver la promesa
        settle(false);
      }}
      onClick={(e) => e.target === e.currentTarget && settle(false)}
      onKeyDown={onKeyDown}
      className={
        "fixed m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto bg-transparent p-0 text-slate-900 " +
        "backdrop:bg-slate-900/50 backdrop:backdrop-blur-[2px] " +
        "sm:m-auto sm:max-w-md"
      }
    >
      <div
        className={
          "rounded-t-3xl bg-white px-5 pt-3 shadow-2xl sm:rounded-2xl sm:p-6 " +
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none starting:translate-y-8 starting:opacity-0 sm:starting:translate-y-2 sm:starting:scale-95"
        }
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
        <div className="flex items-start gap-3">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
              danger ? "bg-rose-100 text-rose-700" : "bg-brand-100 text-brand-600"
            }`}
          >
            {danger ? <IconWarning className="h-6 w-6" /> : <IconInfo className="h-6 w-6" />}
          </span>
          <div className="min-w-0 flex-1 pt-1.5">
            <h2 id={titleId} className="text-lg font-bold leading-snug text-slate-900">
              {req.title}
            </h2>
            {req.message && (
              <div id={descId} className="mt-1.5 text-base leading-relaxed text-slate-600">
                {req.message}
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <button
            ref={confirmRef}
            type="button"
            onClick={() => settle(true)}
            className={`inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-base font-semibold text-white transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 sm:min-h-11 ${
              danger
                ? "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500/40"
                : "bg-brand-500 hover:bg-brand-600 focus-visible:ring-brand-500/40"
            }`}
          >
            {req.confirmLabel ?? (danger ? "Sí, continuar" : "Aceptar")}
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={() => settle(false)}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-5 text-base font-semibold text-slate-800 ring-1 ring-slate-300 transition hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 sm:min-h-11"
          >
            {req.cancelLabel ?? "Cancelar"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** Monta el diálogo de confirmación (una vez, en el layout raíz). */
export function ConfirmProvider({ children }: { children?: ReactNode }) {
  const req = useSyncExternalStore(subscribe, current, () => null);
  useEffect(() => {
    mounted++;
    return () => {
      mounted--;
    };
  }, []);
  return (
    <>
      {children}
      {req && <ConfirmDialog key={req.key} req={req} />}
    </>
  );
}
