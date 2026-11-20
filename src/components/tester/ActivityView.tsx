"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Activity, FieldDef } from "@/lib/types";
import { ACTIVITY_RESULTS, type ActivityResult } from "@/lib/types";
import { Coachmark, confirm, useToastOffset } from "@/components/feedback";
import { Bump, motion, Sparkles, StepFrame, TickBadge, useReducedMotion } from "@/components/motion";
import { expectedConditional, expectedText, NOT_APPLICABLE } from "@/lib/guide-utils";
import OrdersField, { ordersError } from "./OrdersField";
import { DaysPicker, FolioTimePicker, TimePicker, TimeRangePicker } from "./pickers";
import { Button, Callout, FieldError, FormField, ProgressBar, Rich, StepImage } from "./ui";
import { emptyActivity, stepKey, type ActivityState, type Issue, type Outcome, type RunState } from "./store";
import { focusFirstError, LIMITS, trimAll, validateFields, type Errors } from "./validation";

const RESULT_STYLE: Record<ActivityResult, string> = {
  ok: "bg-emerald-700 text-white ring-emerald-700",
  issue: "bg-amber-700 text-white ring-amber-700",
  blocked: "bg-rose-600 text-white ring-rose-600",
  skipped: "bg-slate-600 text-white ring-slate-600",
};

export default function ActivityView({
  activity,
  index,
  total,
  state,
  initialStep,
  onStep,
  onReport,
  onSave,
  onExit,
  blocked = false,
  blockedPanel,
  desktop = false,
  dataLabel = "Datos",
  onOpenData,
  onCheckpoint,
  onDraft,
  reopened = false,
}: {
  activity: Activity;
  index: number;
  total: number;
  state: RunState;
  initialStep: number;
  onStep: (stepId: string, outcome: Outcome | null) => void;
  /** Abre el reporte. `markFail`: al enviarlo, el paso queda como «No pude» (si se cierra sin enviar, no se marca). */
  onReport: (kind: "issue" | "evidence", stepId?: string, markFail?: boolean) => void;
  onSave: (a: ActivityState) => void;
  onExit: () => void;
  /** La actividad está detenida por una falla bloqueante: no se puede avanzar. */
  blocked?: boolean;
  blockedPanel?: ReactNode;
  /** Guía de escritorio: en pantallas grandes (lg) los pasos van en dos columnas con la captura grande. */
  desktop?: boolean;
  /** Texto del botón de datos en los pasos con `dataButton` (título de la hoja de referencia). */
  dataLabel?: string;
  /** Abre la hoja de referencia (Datos). */
  onOpenData?: () => void;
  /** Guarda las casillas marcadas de un paso de confirmación. */
  onCheckpoint?: (stepId: string, ticks: Record<string, boolean>) => void;
  /** Guarda en el navegador el borrador del cierre (resultado, casillas, datos y comentarios). */
  onDraft?: (a: ActivityState) => void;
  /** La actividad ya estaba guardada y se volvió a abrir para corregirla. */
  reopened?: boolean;
}) {
  const steps = activity.steps;
  const [pos, setPos] = useState(Math.min(initialStep, steps.length)); // steps.length = cierre
  const saved = state.activities[activity.id] ?? emptyActivity();
  const [draft, setDraftState] = useState<ActivityState>(saved);
  /** Cada cambio del cierre se guarda al momento (sobrevive a recargas); se envía al servidor al guardar. */
  const setDraft = (d: ActivityState) => {
    setDraftState(d);
    onDraft?.(d);
  };

  const issuesFor = (stepId?: string) =>
    state.issues.filter((i) => i.activityId === activity.id && (stepId === undefined || i.stepId === stepId));

  // Dirección del último cambio de paso (para deslizar desde la derecha o la izquierda)
  const [dir, setDir] = useState<"next" | "prev">("next");
  const reduce = useReducedMotion();
  // Pasos en los que ya se abrió «Datos» (el botón deja de pulsar)
  const [dataSeen, setDataSeen] = useState<Record<string, boolean>>({});
  // Errores del cierre (se muestran después del primer intento de guardar)
  const [tried, setTried] = useState(false);
  const closingRef = useRef<HTMLDivElement>(null);
  // Los avisos flotantes van arriba de la barra fija de botones
  useToastOffset(desktop ? 96 : 150);

  const go = (p: number) => {
    setDir(p >= pos ? "next" : "prev");
    setPos(p);
    window.scrollTo({ top: 0 });
  };
  const parts = partsOf(activity);
  const ticksFor = (stepId: string) => state.checkpoints?.[stepKey(activity.id, stepId)] ?? {};
  const checkpointDone = (s: Activity["steps"][number]) =>
    !s.checkpoint || s.checkpoint.items.every((_, i) => ticksFor(s.id)[String(i)]);
  /** Clases que solo aplican en la guía de escritorio. */
  const dk = (c: string) => (desktop ? " " + c : "");

  // Atajos de teclado en escritorio: ← paso anterior, → paso siguiente (solo si ya se marcó y no hay pausa)
  const keyState = useRef({ pos, canNext: false });
  const curOutcome = pos < steps.length ? state.steps[stepKey(activity.id, steps[pos].id)] : undefined;
  useEffect(() => {
    keyState.current = { pos, canNext: pos < steps.length && !!curOutcome && !blocked && checkpointDone(steps[pos]) };
  });
  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const { pos: p, canNext } = keyState.current;
      if (e.key === "ArrowLeft" && p > 0) {
        e.preventDefault();
        setDir("prev");
        setPos(Math.min(p, steps.length) - 1);
        window.scrollTo({ top: 0 });
      } else if (e.key === "ArrowRight" && canNext) {
        e.preventDefault();
        setDir("next");
        setPos(p + 1);
        window.scrollTo({ top: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, steps.length]);

  // Cuándo, dónde, avisos y notas de la actividad (en escritorio, en dos columnas)
  const info = (compact = false) => (
    <div className={compact ? "grid grid-cols-2 gap-4" : "space-y-4" + dk("lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0")}>
      <dl className={"grid grid-cols-1 gap-2 text-sm" + (compact ? "" : " rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" + dk("lg:gap-3 lg:p-5"))}>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-600">Cuándo</dt>
          <dd>
            <Rich text={activity.when} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-600">Dónde</dt>
          <dd>
            <Rich text={activity.where} links />
          </dd>
        </div>
      </dl>
      {(activity.warnings?.length || activity.notes) && (
        <div className={"space-y-4" + dk("lg:space-y-3")}>
          {activity.warnings?.map((w, i) => (
            <Callout key={i}>
              ⚠️ <Rich text={w} />
            </Callout>
          ))}
          {activity.notes && (
            <Callout tone="info">
              <Rich text={activity.notes} />
            </Callout>
          )}
        </div>
      )}
    </div>
  );

  const header = (
    <div className={"sticky top-[var(--topbar-h,0px)] z-20 -mx-4 bg-[#f4f6fa]/95 px-4 pb-3 pt-3 backdrop-blur" + dk("lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pb-1 lg:pt-1 lg:backdrop-blur-none")}>
      <div className="flex items-center gap-2">
        <button onClick={onExit} className={"-ml-2 min-h-11 rounded-lg px-2 py-1 text-sm font-medium text-brand-600 hover:bg-brand-50" + dk("lg:min-h-9")}>
          ← Actividades
        </button>
        <span className="ml-auto text-xs text-slate-600">
          Actividad {index + 1} de {total}
        </span>
      </div>
      <h1 className={"mt-1 text-xl font-bold leading-tight" + dk("lg:text-[26px]")}>
        <span className="text-teal-ink">{activity.id}</span> · {activity.title}
      </h1>
      {pos < steps.length && parts.list.length > 1 && parts.of(steps[pos].id) && (
        <p className={"mt-1 text-sm font-semibold text-brand-700" + dk("lg:text-base")} data-testid="part-indicator">
          Parte {parts.of(steps[pos].id)} de {parts.list[parts.list.length - 1]}
          {parts.titles[parts.of(steps[pos].id)!] ? ` · ${parts.titles[parts.of(steps[pos].id)!]}` : ""}
        </p>
      )}
      <div className={"mt-2 flex items-center gap-2" + dk("lg:mt-3 lg:gap-3")}>
        <ProgressBar value={pos / steps.length} />
        <span className={"shrink-0 text-xs font-medium text-slate-600" + dk("lg:text-sm")}>
          {pos < steps.length ? `Paso ${pos + 1}/${steps.length}` : "Cierre"}
        </span>
      </div>
      {desktop && pos > 0 && pos < steps.length && (
        <details className="group mt-3 hidden rounded-xl bg-white text-sm ring-1 ring-slate-200 lg:block">
          <summary className="cursor-pointer select-none px-4 py-2 font-medium text-slate-600 marker:text-slate-400 hover:text-slate-900">
            Cuándo, dónde y avisos de {activity.id}
          </summary>
          <div className="border-t border-slate-100 px-4 pb-4 pt-3">{info(true)}</div>
        </details>
      )}
    </div>
  );

  // Pantalla de cierre de la actividad
  if (pos >= steps.length) {
    const failed = steps.some((s) => state.steps[stepKey(activity.id, s.id)] === "fail");
    const allChecked = activity.expected.every((_, i) => draft.checks[String(i)] !== undefined);
    const ordersErrs = Object.fromEntries(
      (activity.fields ?? []).filter((f) => f.type === "orders").map((f) => [f.id, ordersError(draft.fields[f.id], !!f.required && (!draft.result || draft.result === "ok" || draft.result === "issue"))])
    );
    const skipped = draft.result === "skipped";
    const hasOrders = (activity.fields ?? []).some((f) => f.type === "orders");
    // Obligatorios solo si le fue bien o con falla; con «No pude» o «No me tocó» basta con que lo escrito tenga buen formato
    const requireFilled = !draft.result || draft.result === "ok" || draft.result === "issue";
    const fieldErrors = validateFields((activity.fields ?? []).filter((f) => f.type !== "orders"), draft.fields, requireFilled);
    const errors: Errors = { ...fieldErrors };
    for (const [k, v] of Object.entries(ordersErrs)) if (v) errors[k] = v;
    if (!draft.result) errors._result = `Elige cómo te fue en ${activity.id}.`;
    if (draft.notes.trim().length > LIMITS.notes) errors._notes = `Máximo ${LIMITS.notes} caracteres.`;
    const shown: Errors = tried ? errors : {};
    const complete = Object.keys(errors).length === 0 && (allChecked || skipped);
    const card = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" + dk("lg:p-6");
    const save = async () => {
      if (Object.keys(errors).length) {
        setTried(true);
        focusFirstError(closingRef.current);
        return;
      }
      // Guardar cierra la actividad para siempre: con «No pude hacerla» se pide confirmación
      if (
        draft.result === "blocked" &&
        !(await confirm({
          title: `¿Guardar ${activity.id} como «${ACTIVITY_RESULTS.blocked}»?`,
          message: "Al guardar, la actividad se cierra y ya no podrás cambiarla. Si fue una falla, revisa que la hayas reportado con «No pude».",
          confirmLabel: "Sí, guardar",
          cancelLabel: "Revisar",
        }))
      )
        return;
      onSave({ ...draft, fields: trimAll(draft.fields), notes: draft.notes.trim(), done: true });
    };
    return (
      <>
      {header}
      <StepFrame id="__cierre" dir={dir}>
      <div ref={closingRef}>
        <section className={"mt-2 space-y-5" + dk("lg:mt-5")}>
          {blocked && blockedPanel}
          {reopened && (
            <Callout tone="info">
              Ya guardaste {activity.id}. Puedes corregirla y volver a guardarla hasta que toques <strong>Terminar</strong>.
            </Callout>
          )}
          <div className={dk(hasOrders ? "lg:space-y-6" : "lg:grid lg:grid-cols-2 lg:items-start lg:gap-6")}>
            <div className={card}>
              <h2 className={"font-semibold" + dk("lg:text-lg")}>Resultado esperado</h2>
              <p className="mb-3 text-sm text-slate-600">¿Pasó lo que dice cada punto?</p>
              <ul className="space-y-3">
                {activity.expected.map((item, i) => {
                  const v = draft.checks[String(i)];
                  const e = expectedText(item);
                  const cond = expectedConditional(item);
                  return (
                    <li key={i} className={"rounded-xl bg-slate-50 p-3" + dk("lg:flex lg:items-center lg:gap-4 lg:px-4")}>
                      <p className={"text-sm" + dk("lg:flex-1")} id={`exp-${activity.id}-${i}`}>
                        {e}
                      </p>
                      <div
                        className={`mt-2 grid gap-2 ${cond ? "grid-cols-3" : "grid-cols-2"}` + dk(cond ? "lg:mt-0 lg:w-60 lg:shrink-0" : "lg:mt-0 lg:w-36 lg:shrink-0")}
                        role="group"
                        aria-labelledby={`exp-${activity.id}-${i}`}
                      >
                        {(
                          [
                            [true, "Sí"],
                            [false, "No"],
                            ...(cond ? [[NOT_APPLICABLE, "No aplica"]] : []),
                          ] as [boolean | "na", string][]
                        ).map(([val, label]) => (
                          <motion.button
                            key={label as string}
                            type="button"
                            aria-pressed={v === val}
                            onClick={() => setDraft({ ...draft, checks: { ...draft.checks, [String(i)]: val } })}
                            whileTap={reduce ? { opacity: 0.8 } : { scale: 0.92 }}
                            animate={v === val && !reduce ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                            transition={{ duration: 0.25 }}
                            className={`min-h-11 rounded-lg px-1 py-2 text-sm font-medium ring-1 transition-colors ${
                              v === val
                                ? val === NOT_APPLICABLE
                                  ? "bg-slate-600 text-white ring-slate-600"
                                  : val
                                    ? "bg-emerald-700 text-white ring-emerald-700"
                                    : "bg-rose-600 text-white ring-rose-600"
                                : "bg-white ring-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            {label as string}
                          </motion.button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className={"mt-5 space-y-5" + dk(hasOrders ? "" : "lg:mt-0")}>
              {activity.fields && activity.fields.length > 0 && (
                <div className={"space-y-3 " + card}>
                  <div>
                    <h2 className={"font-semibold" + dk("lg:text-lg")}>Anota</h2>
                    <p className="text-sm text-slate-600">
                      Los datos con * son obligatorios{requireFilled ? "" : " solo si te fue bien o con falla"}.
                    </p>
                  </div>
                  <div className={"space-y-3" + dk("lg:grid lg:grid-cols-2 lg:gap-x-4 lg:gap-y-3 lg:space-y-0")}>
                    {activity.fields.map((f) =>
                      f.type === "orders" ? (
                        <div key={f.id} className={dk("lg:col-span-2")}>
                          <OrdersField
                            id={`f-${activity.id}-${f.id}`}
                            label={`${f.label}${f.required && requireFilled ? " *" : ""}`}
                            value={draft.fields[f.id] ?? ""}
                            error={shown[f.id]}
                            desktop={desktop}
                            folioPlaceholder={f.placeholder}
                            onChange={(v) => setDraft({ ...draft, fields: { ...draft.fields, [f.id]: v } })}
                          />
                        </div>
                      ) : (
                      <FormField
                        key={f.id}
                        id={`f-${activity.id}-${f.id}`}
                        className={f.type === "timeRange" || f.type === "folioTime" ? dk("lg:col-span-2") : ""}
                        label={`${f.label}${f.required && requireFilled ? " *" : ""}`}
                        labelClassName="mb-1 block text-sm text-slate-800"
                        error={shown[f.id]}
                        hint={f.patternHint && !shown[f.id] ? f.patternHint : undefined}
                      >
                        {(p) =>
                          isPickerType(f.type) ? (
                            <FieldPicker
                              f={f}
                              id={p.id}
                              invalid={p["aria-invalid"]}
                              describedBy={p["aria-describedby"]}
                              value={draft.fields[f.id] ?? ""}
                              onChange={(v) => setDraft({ ...draft, fields: { ...draft.fields, [f.id]: v } })}
                            />
                          ) : (f.maxLength ?? 0) > 200 ? (
                            <textarea
                              {...p}
                              className={p.className + " min-h-24"}
                              placeholder={f.placeholder}
                              maxLength={f.maxLength! + 50}
                              value={draft.fields[f.id] ?? ""}
                              onChange={(e) => setDraft({ ...draft, fields: { ...draft.fields, [f.id]: e.target.value } })}
                            />
                          ) : (
                            <input
                              {...p}
                              {...fieldInputProps(f)}
                              value={draft.fields[f.id] ?? ""}
                              onChange={(e) => setDraft({ ...draft, fields: { ...draft.fields, [f.id]: e.target.value } })}
                            />
                          )
                        }
                      </FormField>
                      )
                    )}
                  </div>
                </div>
              )}

              <div className={card} data-error={shown._result ? "true" : undefined}>
                <h2 className={"font-semibold" + dk("lg:text-lg")} id={`res-${activity.id}`}>
                  ¿Cómo te fue en {activity.id}? *
                </h2>
                {failed && <p className="mt-1 text-sm text-amber-800">Marcaste al menos un paso como «No pude».</p>}
                <div
                  className={"mt-3 grid grid-cols-1 gap-2" + dk("lg:grid-cols-2") + (shown._result ? " animate-shake rounded-xl" : "")}
                  role="group"
                  aria-labelledby={`res-${activity.id}`}
                  aria-describedby={shown._result ? `res-${activity.id}-err` : undefined}
                >
                  {(Object.keys(ACTIVITY_RESULTS) as ActivityResult[]).map((r) => (
                    <motion.button
                      key={r}
                      type="button"
                      aria-pressed={draft.result === r}
                      onClick={() => setDraft({ ...draft, result: r })}
                      whileHover={reduce ? undefined : { x: 2 }}
                      whileTap={reduce ? { opacity: 0.8 } : { scale: 0.96 }}
                      animate={draft.result === r && !reduce ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                      transition={{ duration: 0.25 }}
                      className={`min-h-12 rounded-xl px-4 py-3 text-left font-medium ring-1 transition-colors ${
                        draft.result === r ? RESULT_STYLE[r] : shown._result ? "bg-white ring-2 ring-rose-400" : "bg-white ring-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {ACTIVITY_RESULTS[r]}
                    </motion.button>
                  ))}
                </div>
                {shown._result && <FieldError id={`res-${activity.id}-err`}>{shown._result}</FieldError>}
                <FormField
                  id={`notes-${activity.id}`}
                  className="mt-4"
                  label="Comentarios (opcional)"
                  labelClassName="mb-1 block text-sm text-slate-800"
                  error={shown._notes}
                >
                  {(p) => (
                    <textarea
                      {...p}
                      className={p.className + " min-h-20"}
                      maxLength={LIMITS.notes + 200}
                      value={draft.notes}
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    />
                  )}
                </FormField>
              </div>

              <IssueList issues={issuesFor()} />
              <p className={"px-1 text-xs text-slate-600" + dk("lg:hidden")}>✓ Tus respuestas se guardan solas en este navegador mientras llenas.</p>
            </div>
          </div>

          <div
            className={
              "pb-safe sticky bottom-0 z-10 -mx-4 space-y-2 bg-[#f4f6fa]/95 px-4 pt-2 backdrop-blur" +
              dk("lg:mx-0 lg:flex lg:items-center lg:justify-end lg:gap-4 lg:space-y-0 lg:rounded-2xl lg:bg-white/95 lg:px-5 lg:py-3 lg:shadow-md lg:ring-1 lg:ring-slate-200 lg:bottom-4")
            }
          >
            {tried && Object.keys(errors).length > 0 ? (
              <p className={"text-center text-xs font-medium text-rose-700" + dk("lg:mr-auto lg:text-sm")} role="alert">
                Revisa {Object.keys(errors).length === 1 ? "el dato marcado" : `los ${Object.keys(errors).length} datos marcados`} en rojo.
              </p>
            ) : !allChecked && draft.result && !skipped ? (
              <p className={"text-center text-xs text-slate-600" + dk("lg:mr-auto lg:text-sm")}>Te faltan puntos del resultado esperado.</p>
            ) : desktop ? (
              <p className="hidden text-sm text-slate-600 lg:mr-auto lg:block">Tus respuestas se guardan solas mientras llenas.</p>
            ) : null}
            <div className={"grid grid-cols-[auto_1fr] gap-2" + dk("lg:w-[420px]")}>
              <Button variant="outline" size="lg" onClick={() => go(steps.length - 1)} aria-label="Paso anterior">
                ←
              </Button>
              <Button size="lg" disabled={blocked} pulse={complete} onClick={save}>
                {reopened ? "Guardar cambios" : "Guardar y continuar"}
              </Button>
            </div>
          </div>
        </section>
      </div>
      </StepFrame>
      </>
    );
  }

  const step = steps[pos];
  const outcome = state.steps[stepKey(activity.id, step.id)];
  const stepIssues = issuesFor(step.id);
  const legend = step.caption ? captionLegend(step.caption) : null;
  const ticks = ticksFor(step.id);
  const cpTotal = step.checkpoint?.items.length ?? 0;
  const cpDone = step.checkpoint ? step.checkpoint.items.filter((_, i) => ticks[String(i)]).length : 0;
  const cpComplete = cpDone === cpTotal;
  // En la guía de escritorio, si el paso no tiene captura, la confirmación ocupa la columna derecha
  const cpRight = desktop && !step.image && !!step.checkpoint;
  const checkpointCard = step.checkpoint && (
              <fieldset
                className={`rounded-2xl p-4 shadow-sm ring-2 transition-colors ${cpComplete ? "bg-emerald-50 ring-emerald-300" : "bg-white ring-brand-500/40"}` + dk("lg:p-5")}
                data-testid="checkpoint"
              >
                <legend className="sr-only">{step.checkpoint.title}</legend>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold leading-snug text-slate-900" aria-hidden="true">
                    <Bump k={cpComplete ? "si" : "no"} className="relative mr-1">
                      {cpComplete ? "✅" : "☑️"}
                      {cpComplete && <Sparkles count={10} radius={30} size={11} />}
                    </Bump>
                    {step.checkpoint.title}
                  </h2>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold transition-colors duration-300 ${cpComplete ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}
                    aria-live="polite"
                  >
                    <Bump k={cpDone}>{cpDone}</Bump> de {cpTotal}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">Marca cada punto que ya quedó listo. Al marcar todos podrás seguir.</p>
                <ul className="mt-3 space-y-2">
                  {step.checkpoint.items.map((it, i) => {
                    const on = !!ticks[String(i)];
                    return (
                      <motion.li key={i} layout={!reduce} whileTap={reduce || blocked ? undefined : { scale: 0.98 }}>
                        <label
                          className={`relative flex min-h-12 cursor-pointer items-start gap-3 rounded-xl p-3 text-[15px] ring-1 transition-colors duration-300 ${
                            on ? "bg-white ring-emerald-300" : "bg-slate-50 ring-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {on && (
                            <motion.span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 rounded-xl ring-4 ring-emerald-400/70"
                              initial={{ opacity: 1, scale: 1 }}
                              animate={{ opacity: 0, scale: reduce ? 1 : 1.05 }}
                              transition={{ duration: 0.55, ease: "easeOut" }}
                            />
                          )}
                          <input
                            type="checkbox"
                            className="mt-0.5 h-6 w-6 shrink-0 accent-emerald-600"
                            checked={on}
                            disabled={blocked}
                            onChange={(e) => onCheckpoint?.(step.id, { ...ticks, [String(i)]: e.target.checked })}
                          />
                          <span className={"flex-1 " + (on ? "text-slate-900" : "text-slate-800")}>
                            <Rich text={it} />
                          </span>
                          <TickBadge on={on} />
                        </label>
                      </motion.li>
                    );
                  })}
                </ul>
              </fieldset>
  );
  const openData = () => {
    setDataSeen((m) => ({ ...m, [step.id]: true }));
    onOpenData?.();
  };

  return (
    <>
    {header}
    <StepFrame id={step.id} dir={dir}>
      <section className={"mt-1 space-y-4" + dk("lg:mt-4 lg:space-y-5")}>
        {blocked && !desktop && blockedPanel}
        {pos === 0 && info()}

        <div className={dk("lg:grid lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] lg:items-start lg:gap-6")}>
          {/* Columna izquierda (en celular, todo va en una sola columna) */}
          <div className="space-y-4">
            {blocked && desktop && blockedPanel}
            <div className={"rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200" + dk("lg:p-6")}>
              <div className={"mb-2 flex items-center gap-3" + dk("lg:mb-3")}>
                <motion.div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-white shadow-sm"
                  aria-hidden="true"
                  initial={reduce ? { opacity: 0 } : { scale: 0.3, rotate: -90, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={reduce ? { duration: 0.25 } : { type: "spring", stiffness: 420, damping: 15, delay: 0.12 }}
                >
                  {pos + 1}
                </motion.div>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Paso {pos + 1} de {steps.length}
                </span>
              </div>
              <p className={"text-[17px] leading-relaxed text-slate-800" + dk("lg:text-base lg:leading-7")}>
                <Rich text={step.text} links />
              </p>
              {step.warning && (
                <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[15px] text-amber-950 ring-1 ring-amber-300" role="note" data-testid="step-warning">
                  <span aria-hidden="true">⚠️</span>
                  <span>
                    <Rich text={step.warning} links />
                  </span>
                </div>
              )}
              {step.dataButton && (
                <Coachmark
                  id="tester-datos-sucursal"
                  title={dataLabel}
                  message="Aquí están los nombres, precios y datos exactos que debes escribir en este paso."
                  placement="top"
                >
                <motion.button
                  type="button"
                  onClick={openData}
                  data-testid="data-button"
                  whileHover={reduce ? undefined : { y: -2 }}
                  whileTap={reduce ? { opacity: 0.8 } : { scale: 0.96 }}
                  className={`mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-base font-semibold text-amber-950 ring-2 ring-amber-300 transition-colors hover:bg-amber-100 ${
                    dataSeen[step.id] ? "" : "attn attn-amber"
                  }`}
                >
                  <motion.span
                    aria-hidden="true"
                    className="inline-block"
                    animate={dataSeen[step.id] ? undefined : reduce ? { opacity: [1, 0.45, 1] } : { rotate: [0, -12, 10, -6, 0], scale: [1, 1.2, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 0.7 }}
                  >
                    📊
                  </motion.span>{" "}
                  {dataLabel}
                </motion.button>
                </Coachmark>
              )}
              {desktop && legend && (
                <div className="animate-flash mt-4 hidden rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100 lg:block" data-testid="caption-legend">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">En la captura</div>
                  {legend.numbered ? (
                    <ul className="space-y-1.5 text-sm text-slate-700">
                      {legend.items.map(([n, t], i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-px flex h-5 min-w-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
                            {n}
                          </span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-700">{step.caption}</p>
                  )}
                  {legend.numbered && legend.note && <p className="mt-2 text-xs text-slate-600">{legend.note}</p>}
                </div>
              )}
              {step.evidence && (
                <button
                  type="button"
                  onClick={() => onReport("evidence", step.id)}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
                >
                  📷 Adjuntar la captura que pide este paso
                </button>
              )}
            </div>

            {step.checkpoint && <div className={cpRight ? "lg:hidden" : undefined}>{checkpointCard}</div>}

            {step.image && (
              <div className={desktop ? "lg:hidden" : undefined}>
                <Coachmark id="tester-captura-zoom" message="Toca la captura para verla en grande y con zoom." placement="top">
                  <StepImage src={step.image} caption={step.caption} flash={!!legend?.numbered} />
                </Coachmark>
              </div>
            )}

            <IssueList issues={stepIssues} />

            <div
              className={
                "pb-safe sticky bottom-0 z-10 -mx-4 bg-[#f4f6fa]/95 px-4 pt-2 backdrop-blur" +
                dk("lg:static lg:mx-0 lg:rounded-2xl lg:bg-white lg:p-4 lg:shadow-sm lg:ring-1 lg:ring-slate-200 lg:backdrop-blur-none")
              }
            >
              {blocked ? (
                <p className="mb-2 text-center text-xs font-medium text-rose-700">Actividad en pausa: pide ayuda al guía para continuar.</p>
              ) : step.checkpoint && !cpComplete ? (
                <p className="mb-2 text-center text-xs font-medium text-slate-700" id={`cp-hint-${step.id}`}>
                  Marca las {cpTotal} casillas de arriba para poder seguir ({cpDone} de {cpTotal}).
                </p>
              ) : outcome ? (
                <p className="mb-2 text-center text-xs text-slate-600">
                  Marcaste: <strong>{outcome === "ok" ? "Lo logré" : outcome === "na" ? "No me apareció" : "No pude"}</strong> · puedes cambiarlo
                </p>
              ) : desktop ? (
                <p className="mb-3 hidden text-sm font-medium text-slate-700 lg:block">¿Pudiste hacer este paso?</p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="danger"
                  size="lg"
                  className={outcome === "fail" ? "!bg-rose-600 !text-white" : ""}
                  onClick={() => onReport("issue", step.id, true)}
                >
                  ✗ No pude
                </Button>
                <Button
                  variant="success"
                  size="lg"
                  disabled={blocked || !cpComplete}
                  aria-describedby={step.checkpoint && !cpComplete ? `cp-hint-${step.id}` : undefined}
                  pulse={!outcome && !blocked && cpComplete}
                  className={outcome === "ok" ? "ring-4 ring-emerald-200" : ""}
                  onClick={() => {
                    onStep(step.id, "ok");
                    go(pos + 1);
                  }}
                >
                  ✓ Lo logré
                </Button>
                {step.conditional && (
                  <Button
                    variant="outline"
                    size="lg"
                    disabled={blocked}
                    className={"col-span-2" + (outcome === "na" ? " !bg-slate-600 !text-white !ring-slate-600" : "")}
                    onClick={() => {
                      onStep(step.id, "na");
                      go(pos + 1);
                    }}
                  >
                    No me apareció
                  </Button>
                )}
              </div>
              {step.conditional && (
                <p className="mt-1.5 text-center text-xs text-slate-600">Si lo que dice el paso no te salió, toca «No me apareció»: cuenta como terminado.</p>
              )}
              <div className={"mt-1 flex items-center justify-between text-sm" + dk("lg:mt-2")}>
                <button
                  type="button"
                  disabled={pos === 0}
                  onClick={() => go(pos - 1)}
                  className={"min-h-11 px-2 py-2 text-slate-600 disabled:opacity-30" + dk("lg:rounded-lg lg:hover:bg-slate-100 lg:hover:text-slate-800")}
                >
                  ← Anterior
                </button>
                <button
                  type="button"
                  onClick={() => onReport("issue", step.id)}
                  className={"min-h-11 px-2 py-2 font-medium text-rose-700" + dk("lg:rounded-lg lg:hover:bg-rose-50")}
                >
                  Reportar otra falla
                </button>
                {outcome ? (
                  <button
                    type="button"
                    disabled={blocked || !cpComplete}
                    onClick={() => go(pos + 1)}
                    className={"min-h-11 px-2 py-2 text-slate-600 disabled:opacity-30" + dk("lg:rounded-lg lg:hover:bg-slate-100 lg:hover:text-slate-800")}
                  >
                    Siguiente →
                  </button>
                ) : (
                  <span className="w-20" />
                )}
              </div>
              {desktop && (
                <p className="mt-2 hidden border-t border-slate-100 pt-2 text-center text-xs text-slate-600 lg:block">
                  Atajos: <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-sans text-slate-700">←</kbd> paso anterior ·{" "}
                  <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-sans text-slate-700">→</kbd> siguiente (si ya lo marcaste)
                </p>
              )}
            </div>
          </div>

          {/* Columna derecha (escritorio): la captura en grande */}
          {desktop && (
            <div className="hidden lg:block">
              {step.image ? (
                <StepImage key={step.image} src={step.image} caption={step.caption} desktop captionAside={!!legend} />
              ) : cpRight ? (
                checkpointCard
              ) : (
                <div className="flex h-64 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 text-center text-sm text-slate-600">
                  <span className="text-3xl opacity-60" aria-hidden="true">🖥️</span>
                  <span className="mt-2">Este paso no tiene captura de pantalla.</span>
                  <span>Sigue las indicaciones de la izquierda.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </StepFrame>
    </>
  );
}

/**
 * Partes de una actividad larga (E04): la letra inicial del id del paso (A1, B3, A-OK…). El título
 * sale del texto «**Parte A · Crea los productos.**» del primer paso que lo traiga.
 */
function partsOf(activity: Activity) {
  const letter = (id: string) => id.match(/^([A-Z])(?:\d|-)/)?.[1];
  const list: string[] = [];
  const titles: Record<string, string> = {};
  for (const s of activity.steps) {
    const l = letter(s.id);
    if (!l) continue;
    if (!list.includes(l)) list.push(l);
    const m = !titles[l] && s.text.match(/Parte\s+([A-Z])\s*·\s*([^.*]+)/);
    if (m && m[1] === l) titles[l] = m[2].trim();
  }
  // Solo si casi todos los pasos tienen letra (no confundir con ids sueltos)
  const ok = list.length > 1 && activity.steps.filter((s) => letter(s.id)).length >= activity.steps.length * 0.8;
  return { list: ok ? list : [], titles, of: (id: string) => (ok ? letter(id) : undefined) };
}

/** Tipo de teclado y límites del input según el tipo de campo de la guía. */
function fieldInputProps(f: FieldDef) {
  const max = f.maxLength ?? LIMITS.field;
  switch (f.type) {
    case "number":
      return { type: "text", inputMode: "numeric" as const, placeholder: f.placeholder ?? "Ej. 3", maxLength: max + 5 };
    case "email":
      return { type: "email", inputMode: "email" as const, autoComplete: "email", placeholder: f.placeholder, maxLength: max };
    default:
      // Las horas y los días no llegan aquí: usan FieldPicker
      return { type: "text", placeholder: f.placeholder, maxLength: max + 20 };
  }
}

const PICKER_TYPES = ["time", "timeRange", "folioTime", "days"] as const;
const isPickerType = (t: FieldDef["type"]): t is (typeof PICKER_TYPES)[number] => (PICKER_TYPES as readonly string[]).includes(t ?? "");

/** Selector de hora, rango de horas, folio + hora o días, según el tipo del campo de la guía. */
function FieldPicker({
  f,
  id,
  value,
  invalid,
  describedBy,
  onChange,
}: {
  f: FieldDef;
  id: string;
  value: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (v: string) => void;
}) {
  const common = { id, value, onChange, invalid, describedBy, ariaLabel: f.label };
  switch (f.type) {
    case "timeRange":
      return <TimeRangePicker {...common} />;
    case "folioTime":
      return <FolioTimePicker {...common} folioPlaceholder={f.placeholder} />;
    case "days":
      return <DaysPicker {...common} />;
    default:
      return <TimePicker {...common} />;
  }
}

/**
 * Convierte «1 = pestaña · 2 = botón · 4 a 7 = datos. Nota final» en una lista numerada (y una nota)
 * para la leyenda de la captura.
 */
function captionLegend(caption: string): { numbered: boolean; items: [string, string][]; note?: string } {
  const parts = caption.split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean);
  let note: string | undefined;
  const items = parts.map((p, i) => {
    const m = p.match(/^(\d+(?:\s+a\s+\d+)?|[A-Z])\s*=\s*(.+)$/);
    let text = m ? m[2] : p;
    if (i === parts.length - 1) {
      const dot = text.indexOf(". ");
      if (dot > 0) {
        note = text.slice(dot + 2).trim();
        text = text.slice(0, dot);
      }
    }
    return [m ? m[1] : "", text] as [string, string];
  });
  return { numbered: items.length > 0 && items.every(([n]) => n), items, note };
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-2">
      {issues.map((i) => (
        <li
          key={i.id}
          className={`rounded-xl px-4 py-3 text-sm ring-1 ${
            i.kind === "issue" ? "bg-rose-50 ring-rose-200" : "bg-emerald-50 ring-emerald-200"
          }`}
        >
          <div className="font-medium">
            {i.kind === "issue" ? "Falla reportada" : "Captura adjunta"}
            {i.stepId ? ` · paso ${i.stepId}` : ""}
            {i.attachments.length > 0 && ` · ${i.attachments.length} archivo(s)`}
          </div>
          {i.description && <p className="mt-0.5 text-slate-700">{i.description}</p>}
        </li>
      ))}
    </ul>
  );
}
