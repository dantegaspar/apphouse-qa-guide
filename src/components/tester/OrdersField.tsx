"use client";

import type { OrderRow } from "@/lib/types";
import { FOLIO_RE, formatFolioInput, timeMinutes, toHHMM } from "@/lib/time-fields";
import { TimePicker } from "./pickers";
import { FieldError, inputCls, inputErrCls } from "./ui";

const STATUSES: OrderRow["status"][] = ["Entregado", "Rechazado", "Cancelado", "Otro"];

const COLS: { key: keyof OrderRow; label: string; placeholder?: string; time?: boolean }[] = [
  { key: "folio", label: "Folio", placeholder: "261120-0004" },
  { key: "arrived", label: "Llegó (hora)", time: true },
  { key: "confirmed", label: "Confirmé (hora)", time: true },
  { key: "ready", label: "Listo para salir (hora)", time: true },
  { key: "rider", label: "Repartidor", placeholder: "Nombre" },
];

const emptyRow = (): OrderRow => ({ folio: "", arrived: "", confirmed: "", ready: "", rider: "", status: "", notes: "" });

/** Horas escritas a mano en versiones anteriores («3:14 p.m.») pasan a "15:14" para el selector. */
const TIME_KEYS = ["arrived", "confirmed", "ready"] as const;
const normalizeTimes = (r: OrderRow): OrderRow => {
  const out = { ...r };
  for (const k of TIME_KEYS) if (typeof out[k] === "string" && out[k].trim()) out[k] = toHHMM(out[k]) || out[k];
  return out;
};

/**
 * Lee la hoja guardada (JSON). Un texto viejo que no es JSON se conserva como nota de un renglón.
 * Las horas viejas de 12 h se convierten a 24 h (si no se pueden leer, se dejan igual).
 */
export function parseOrders(value: string | undefined): OrderRow[] {
  if (!value) return [];
  try {
    const v = JSON.parse(value);
    if (Array.isArray(v)) return v.map((r) => normalizeTimes({ ...emptyRow(), ...(r && typeof r === "object" ? r : {}) }));
  } catch {
    /* texto libre de una versión anterior */
  }
  return [{ ...emptyRow(), notes: value }];
}

const filled = (r: OrderRow) => Object.values(r).some((v) => String(v ?? "").trim());

/** Error de la hoja de pedidos (o null). `required`: al menos un pedido con folio. */
export function ordersError(value: string | undefined, required: boolean): string | null {
  const rows = parseOrders(value).filter(filled);
  if (required && rows.length === 0) return "Agrega al menos un pedido con su folio.";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n = `Pedido ${i + 1}`;
    if (!r.folio.trim()) return `${n}: escribe el folio (6 números, guion y 4 números, ej. 261120-0004).`;
    if (!FOLIO_RE.test(r.folio.trim())) return `${n}: el folio debe verse como 261120-0004.`;
    for (const c of COLS.filter((c) => c.time)) {
      const t = String(r[c.key] ?? "").trim();
      if (t && timeMinutes(t) === null) return `${n}: elige de nuevo la hora de «${c.label.replace(" (hora)", "")}» (o toca «Ahora»).`;
    }
    if (r.notes.length > 300) return `${n}: las notas pueden tener hasta 300 caracteres.`;
  }
  return null;
}

/**
 * Hoja de pedidos (FieldDef type "orders"): un renglón por pedido con «Agregar pedido».
 * En teléfono cada pedido es una tarjeta; en escritorio (lg) es una tabla.
 */
export default function OrdersField({
  id,
  label,
  value,
  error,
  desktop = false,
  folioPlaceholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string | null;
  desktop?: boolean;
  folioPlaceholder?: string;
  onChange: (v: string) => void;
}) {
  const rows = parseOrders(value);
  const set = (next: OrderRow[]) => onChange(next.length ? JSON.stringify(next) : "");
  const edit = (i: number, k: keyof OrderRow, v: string) =>
    set(rows.map((r, j) => (j === i ? { ...r, [k]: k === "folio" ? formatFolioInput(v, r.folio) : v } : r)));
  const remove = (i: number) => set(rows.filter((_, j) => j !== i));
  const add = () => {
    set([...rows, emptyRow()]);
    // Enfoca el folio del pedido nuevo
    requestAnimationFrame(() => {
      const a = document.getElementById(`${id}-${rows.length}-folio`);
      const b = document.getElementById(`${id}-${rows.length}-folio-m`);
      (a && a.offsetParent ? a : b)?.focus();
    });
  };
  const cls = error ? inputErrCls : inputCls;
  const small = " !px-2.5 !py-2 text-sm";
  const ph = (c: (typeof COLS)[number]) => (c.key === "folio" && folioPlaceholder ? folioPlaceholder.replace(/^Ej\.\s*/, "") : c.placeholder);

  return (
    <div data-error={error ? "true" : undefined} data-testid="orders-field">
      <div className="mb-1 flex items-end justify-between gap-2">
        <span id={`${id}-label`} className="block text-sm text-slate-800">
          {label}
        </span>
        <span className="text-xs text-slate-600">
          {rows.length} {rows.length === 1 ? "pedido" : "pedidos"}
        </span>
      </div>

      {rows.length === 0 && (
        <p className="rounded-xl border-2 border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-600">
          Todavía no anotas pedidos. Toca «Agregar pedido» cada vez que atiendas uno.
        </p>
      )}

      {/* Teléfono y tableta: una tarjeta por pedido */}
      <ol className={"space-y-3" + (desktop ? " lg:hidden" : "")} aria-labelledby={`${id}-label`}>
        {rows.map((r, i) => (
          <li key={i} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">Pedido {i + 1}</span>
              <button type="button" onClick={() => remove(i)} className="min-h-10 rounded-lg px-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
                Quitar
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {COLS.map((c) => (
                <label key={c.key} className={c.key === "folio" || c.key === "rider" ? "col-span-2 block" : "block"}>
                  <span className="mb-0.5 block text-xs font-medium text-slate-700">{c.label}</span>
                  {c.time ? (
                    <TimePicker
                      id={`${id}-${i}-${c.key}-m`}
                      compact
                      value={String(r[c.key] ?? "")}
                      onChange={(v) => edit(i, c.key, v)}
                      invalid={!!error}
                      ariaLabel={`${c.label}, pedido ${i + 1}`}
                      inputClassName={small}
                    />
                  ) : (
                    <input
                      id={`${id}-${i}-${c.key}-m`}
                      className={cls + small}
                      value={String(r[c.key] ?? "")}
                      placeholder={ph(c)}
                      inputMode={c.key === "folio" ? "numeric" : undefined}
                      maxLength={c.key === "folio" ? 12 : 120}
                      aria-invalid={!!error}
                      onChange={(e) => edit(i, c.key, e.target.value)}
                    />
                  )}
                </label>
              ))}
              <label className="col-span-2 block">
                <span className="mb-0.5 block text-xs font-medium text-slate-700">Estado final</span>
                <select className={cls + small} value={r.status} onChange={(e) => edit(i, "status", e.target.value)}>
                  <option value="">Elige…</option>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 block">
                <span className="mb-0.5 block text-xs font-medium text-slate-700">Notas</span>
                <input className={cls + small} value={r.notes} maxLength={320} onChange={(e) => edit(i, "notes", e.target.value)} />
              </label>
            </div>
          </li>
        ))}
      </ol>

      {/* Escritorio: tabla */}
      {desktop && rows.length > 0 && (
        <div className="hidden overflow-x-auto rounded-xl ring-1 ring-slate-200 lg:block">
          <table className="w-full min-w-[900px] text-left text-sm" aria-labelledby={`${id}-label`}>
            <thead className="bg-slate-50 text-xs font-semibold text-slate-700">
              <tr>
                <th className="w-8 px-2 py-2">#</th>
                {COLS.map((c) => (
                  <th key={c.key} className="px-2 py-2">
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-2">Estado final</th>
                <th className="px-2 py-2">Notas</th>
                <th className="px-2 py-2">
                  <span className="sr-only">Quitar</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i} className="align-top">
                  <td className="px-2 py-2 pt-4 text-slate-600">{i + 1}</td>
                  {COLS.map((c) => (
                    <td key={c.key} className="px-1 py-1.5">
                      {c.time ? (
                        <TimePicker
                          id={`${id}-${i}-${c.key}`}
                          compact
                          value={String(r[c.key] ?? "")}
                          onChange={(v) => edit(i, c.key, v)}
                          invalid={!!error}
                          ariaLabel={`${c.label}, pedido ${i + 1}`}
                          inputClassName={small}
                        />
                      ) : (
                        <input
                          id={`${id}-${i}-${c.key}`}
                          className={cls + small}
                          value={String(r[c.key] ?? "")}
                          placeholder={ph(c)}
                          inputMode={c.key === "folio" ? "numeric" : undefined}
                          maxLength={c.key === "folio" ? 12 : 120}
                          aria-label={`${c.label}, pedido ${i + 1}`}
                          aria-invalid={!!error}
                          onChange={(e) => edit(i, c.key, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1 py-1.5">
                    <select
                      className={cls + small}
                      value={r.status}
                      aria-label={`Estado final, pedido ${i + 1}`}
                      onChange={(e) => edit(i, "status", e.target.value)}
                    >
                      <option value="">Elige…</option>
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      className={cls + small}
                      value={r.notes}
                      maxLength={320}
                      aria-label={`Notas, pedido ${i + 1}`}
                      onChange={(e) => edit(i, "notes", e.target.value)}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="min-h-10 rounded-lg px-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
                      aria-label={`Quitar pedido ${i + 1}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100 sm:w-auto"
      >
        ＋ Agregar pedido
      </button>
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
    </div>
  );
}
