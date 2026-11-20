"use client";

/**
 * Selectores para los campos «Anota» de la guía (en lugar de escribir horas o días a mano):
 * - TimePicker: hora nativa (rueda en el celular, campos en la computadora) + «Ahora».
 * - TimeRangePicker: «De … a …» (horario de apertura y cierre).
 * - FolioTimePicker: folio del pedido + hora.
 * - DaysPicker: botones Lun … Dom.
 * Los valores se guardan como texto plano (ver src/lib/time-fields.ts).
 */
import { useRef, type KeyboardEvent } from "react";
import {
  DAY_NAMES,
  DAYS,
  format12h,
  formatFolioInput,
  joinDays,
  joinFolioTime,
  joinRange,
  nowHHMM,
  parseDays,
  splitFolioTime,
  splitRange,
  toHHMM,
} from "@/lib/time-fields";
import { inputCls, inputErrCls } from "./ui";

type Common = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  /** ids del mensaje de error / ayuda (aria-describedby). */
  describedBy?: string;
  /** Nombre del campo para lectores de pantalla (cuando no hay <label for>). */
  ariaLabel?: string;
};

/* ---------- Hora ---------- */

export function TimePicker({
  id,
  value,
  onChange,
  invalid = false,
  describedBy,
  ariaLabel,
  showNow = true,
  compact = false,
  inputClassName = "",
}: Common & {
  /** Botón «Ahora» que pone la hora actual. */
  showNow?: boolean;
  /** Versión angosta (tarjetas de la hoja de pedidos): botón y hora de 12 h debajo del campo. */
  compact?: boolean;
  inputClassName?: string;
}) {
  const hhmm = toHHMM(value);
  const echo = hhmm ? format12h(hhmm) : "";
  const echoId = `${id}-12h`;
  const cls =
    (invalid ? inputErrCls : inputCls) + (compact ? " min-h-10" : " min-h-12") + " tabular-nums [&::-webkit-date-and-time-value]:text-left " + inputClassName;
  const input = (
    <input
      id={id}
      type="time"
      step={60}
      className={cls + (compact ? "" : " w-auto min-w-[8.5rem] flex-1 sm:max-w-[11rem]")}
      value={hhmm}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      aria-describedby={[describedBy, echo ? echoId : ""].filter(Boolean).join(" ") || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  const now = showNow && (
    <button
      type="button"
      onClick={() => onChange(nowHHMM())}
      aria-label={ariaLabel ? `Ahora: poner la hora actual en «${ariaLabel}»` : "Ahora: poner la hora actual"}
      className={
        "inline-flex shrink-0 items-center justify-center rounded-xl bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none " +
        (compact ? "min-h-9 px-2.5 text-xs" : "min-h-12 px-3.5 text-sm")
      }
    >
      Ahora
    </button>
  );
  const echoEl = (
    <span id={echoId} className={"text-slate-600 tabular-nums " + (compact ? "text-xs" : "text-sm")}>
      {echo}
    </span>
  );
  if (compact)
    return (
      <div>
        {input}
        {(showNow || echo) && (
          <div className="mt-1 flex items-center gap-2">
            {now}
            {echoEl}
          </div>
        )}
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {input}
      {now}
      {echoEl}
    </div>
  );
}

/* ---------- Rango «De … a …» ---------- */

export function TimeRangePicker({ id, value, onChange, invalid = false, describedBy, ariaLabel }: Common) {
  const { start, end } = splitRange(value);
  const set = (s: string, e: string) => onChange(joinRange(s, e));
  // Con error: en rojo la hora que falta; si están las dos (p. ej. cierra antes de abrir), ambas.
  const both = !!toHHMM(start) && !!toHHMM(end);
  const startErr = invalid && (both || !toHHMM(start));
  const endErr = invalid && (both || !toHHMM(end));
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
      <div>
        <label htmlFor={id} className="mb-0.5 block text-xs font-medium text-slate-700">
          De <span className="font-normal text-slate-600">(abre)</span>
        </label>
        <TimePicker
          id={id}
          value={start}
          onChange={(v) => set(v, toHHMM(end) || end)}
          invalid={startErr}
          describedBy={describedBy}
          showNow={false}
        />
      </div>
      <div>
        <label htmlFor={`${id}-end`} className="mb-0.5 block text-xs font-medium text-slate-700">
          a <span className="font-normal text-slate-600">(cierra)</span>
        </label>
        <TimePicker
          id={`${id}-end`}
          value={end}
          onChange={(v) => set(toHHMM(start) || start, v)}
          invalid={endErr}
          describedBy={describedBy}
          showNow={false}
        />
      </div>
    </div>
  );
}

/* ---------- Folio y hora ---------- */

export function FolioTimePicker({
  id,
  value,
  onChange,
  invalid = false,
  describedBy,
  ariaLabel,
  folioPlaceholder = "Ej. 261120-0004",
}: Common & { folioPlaceholder?: string }) {
  const { folio, time } = splitFolioTime(value);
  const set = (f: string, t: string) => onChange(joinFolioTime(f, t));
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <div>
        <label htmlFor={id} className="mb-0.5 block text-xs font-medium text-slate-700">
          Folio
        </label>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          placeholder={folioPlaceholder}
          className={(invalid ? inputErrCls : inputCls) + " min-h-12 tabular-nums"}
          value={folio}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(e) => set(formatFolioInput(e.target.value, folio), toHHMM(time) || time)}
        />
      </div>
      <div>
        <label htmlFor={`${id}-time`} className="mb-0.5 block text-xs font-medium text-slate-700">
          Hora
        </label>
        <TimePicker
          id={`${id}-time`}
          value={time}
          onChange={(t) => set(folio, t)}
          invalid={invalid}
          describedBy={describedBy}
        />
      </div>
    </div>
  );
}

/* ---------- Días de la semana ---------- */

export function DaysPicker({ id, value, onChange, invalid = false, describedBy, ariaLabel }: Common) {
  const { days } = parseDays(value);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = (d: string) => onChange(joinDays(days.includes(d as (typeof DAYS)[number]) ? days.filter((x) => x !== d) : [...days, d]));
  // Flechas izquierda/derecha para moverse entre los días
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    btns[(i + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length]?.focus();
  };
  return (
    <div
      id={id}
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      data-error={invalid ? "true" : undefined}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      className={"grid grid-cols-7 gap-1.5 rounded-xl sm:flex sm:flex-wrap sm:gap-2" + (invalid ? " p-1 ring-2 ring-rose-500" : "")}
    >
      {DAYS.map((d, i) => {
        const on = days.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={DAY_NAMES[i]}
            onClick={() => toggle(d)}
            className={
              "min-h-11 rounded-xl px-1 text-sm font-semibold ring-1 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none sm:min-w-14 sm:px-3 " +
              (on ? "bg-brand-600 text-white ring-brand-600 hover:bg-brand-700" : "bg-white text-slate-800 ring-slate-300 hover:bg-slate-50")
            }
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}
