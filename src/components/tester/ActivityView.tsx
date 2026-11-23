"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Activity, FieldDef } from "@/lib/types";
import { ACTIVITY_RESULTS, type ActivityResult } from "@/lib/types";
import { Coachmark, confirm, useToastOffset } from "@/components/feedback";
import { motion, StepFrame, useReducedMotion } from "@/components/motion";
import { expectedConditional, expectedText, NOT_APPLICABLE, screensOf } from "@/lib/guide-utils";
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
  /** Abre la hoja de referencia (Datos) con lo de esta actividad (y parte, si la hay). */
  onOpenData?: (part?: string) => void;
  /** Guarda las casillas marcadas de un paso de confirmación. */
  onCheckpoint?: (stepId: string, ticks: Record<string, boolean>) => void;
  /** Guarda en el navegador el borrador del cierre (resultado, casillas, datos y comentarios). */
  onDraft?: (a: ActivityState) => void;
  /** La actividad ya estaba guardada y se volvió a abrir para corregirla. */
  reopened?: boolean;
}) {
  const steps = activity.steps;
  // Los pasos se muestran por pantallas (varios pasos juntos); pos = pantalla, screens.length = cierre
  const screens = screensOf(steps);
  const screenOfStep = (i: number) => (i >= steps.length ? screens.length : Math.max(0, screens.findIndex((sc) => i < sc.start + sc.steps.length)));
  const [pos, setPos] = useState(() => screenOfStep(initialStep));
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
  const [dataSeen, setDataSeen] = useState<Record<number, boolean>>({});
  // Errores del cierre (se muestran después del primer intento de guardar)
  const [tried, setTried] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  // Pasos de la pantalla que ya pasaron por la vista (el botón Listo se habilita al ver todos)
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  // Lista de pasos de la pantalla actual (al cambiar de pantalla, la anterior sigue un instante en el DOM)
  const stepsList = () => document.querySelector<HTMLElement>(`[data-steps="${activity.id}-${pos}"]`);
  const closingRef = useRef<HTMLDivElement>(null);
  // Los avisos flotantes van arriba de la barra fija de botones
  useToastOffset(desktop ? 96 : 150);

  useEffect(() => {
    const root = stepsList();
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const ids = entries.filter((e) => e.isIntersecting).map((e) => (e.target.parentElement as HTMLElement).dataset.stepId!);
        if (ids.length) setSeen((m) => (ids.every((id) => m[id]) ? m : { ...m, ...Object.fromEntries(ids.map((id) => [id, true])) }));
      },
      // Cuenta como visto cuando el final del paso aparece arriba de la barra fija de botones
      { rootMargin: `0px 0px -${desktop ? 0 : 170}px 0px`, threshold: 0 }
    );
    root.querySelectorAll<HTMLElement>("[data-step-end]").forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, desktop, activity.id]);

  /**
   * «Ver siguiente paso»: baja al primer paso pendiente que todavía no está a la vista (los de arriba
   * cuentan como leídos). Si ya se ven todos, baja al final del último.
   */
  const showNextStep = (pendingIds: string[]) => {
    const root = stepsList();
    if (!root) return;
    const els = pendingIds.map((id) => root.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(id)}"]`)).filter((e): e is HTMLElement => !!e);
    const target = els.find((e) => e.getBoundingClientRect().top > window.innerHeight * 0.45);
    const read = target ? els.slice(0, els.indexOf(target)) : els;
    if (read.length) setSeen((m) => ({ ...m, ...Object.fromEntries(read.map((e) => [e.dataset.stepId!, true])) }));
    const behavior = reduce ? "auto" : "smooth";
    if (target) target.scrollIntoView({ behavior, block: "start" });
    else els[els.length - 1]?.querySelector("[data-step-end]")?.scrollIntoView({ behavior, block: "center" });
  };
  const go = (p: number) => {
    setDir(p >= pos ? "next" : "prev");
    setPos(p);
    setSeen({});
    // Pantalla nueva: la vista queda al inicio de su contenido, no hasta arriba de la página
    const el = document.querySelector<HTMLElement>("[data-activity-content]");
    const top = el ? el.getBoundingClientRect().top + window.scrollY - (desktop && window.innerWidth >= 1024 ? 24 : 150) : 0;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top) });
  };
  const parts = partsOf(activity);
  const ticksFor = (stepId: string) => state.checkpoints?.[stepKey(activity.id, stepId)] ?? {};
  const checkpointDone = (s: Activity["steps"][number]) =>
    !s.checkpoint || s.checkpoint.items.every((_, i) => ticksFor(s.id)[String(i)]);
  /** Clases que solo aplican en la guía de escritorio. */
  const dk = (c: string) => (desktop ? " " + c : "");

  // Atajos de teclado en escritorio: ← paso anterior, → paso siguiente (solo si ya se marcó y no hay pausa)
  const keyState = useRef({ pos, canNext: false });
  const screenDone = (sc: (typeof screens)[number]) =>
    sc.steps.every((s) => !!state.steps[stepKey(activity.id, s.id)] && checkpointDone(s));
  useEffect(() => {
    keyState.current = { pos, canNext: pos < screens.length && !blocked && screenDone(screens[pos]) };
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
        setPos(Math.min(p, screens.length) - 1);
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
  }, [desktop, screens.length]);

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
    <div className={"sticky top-[var(--topbar-h,0px)] z-20 -mx-4 bg-[#f4f6fa]/95 px-4 pb-2 pt-1 backdrop-blur" + dk("lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pb-1 lg:pt-1 lg:backdrop-blur-none")}>
      <div className="flex items-center gap-2">
        <button onClick={onExit} className={"-ml-2 min-h-9 rounded-lg px-2 py-0.5 text-sm font-medium text-brand-600 hover:bg-brand-50" + dk("lg:py-1")}>
          ← Actividades
        </button>
        <span className="ml-auto text-xs text-slate-600">
          Actividad {index + 1} de {total}
        </span>
      </div>
      <h1 className={"line-clamp-2 text-lg font-bold leading-tight" + dk("lg:mt-1 lg:line-clamp-none lg:text-[26px]")}>
        <span className="text-teal-ink">{activity.id}</span> · {activity.title}
      </h1>
      {pos < screens.length && parts.list.length > 1 && parts.of(screens[pos].steps[0].id) && (
        <p className={"mt-0.5 text-xs font-semibold text-brand-700" + dk("lg:mt-1 lg:text-base")} data-testid="part-indicator">
          Parte {parts.of(screens[pos].steps[0].id)} de {parts.list[parts.list.length - 1]}
          {parts.titles[parts.of(screens[pos].steps[0].id)!] ? ` · ${parts.titles[parts.of(screens[pos].steps[0].id)!]}` : ""}
        </p>
      )}
      <div className={"mt-1.5 flex items-center gap-2" + dk("lg:mt-3 lg:gap-3")}>
        <ProgressBar value={pos / screens.length} />
        <span className={"shrink-0 text-xs font-medium text-slate-600" + dk("lg:text-sm")}>
          {pos < screens.length ? `Pantalla ${pos + 1}/${screens.length + 1}` : `Cierre · ${screens.length + 1}/${screens.length + 1}`}
        </span>
      </div>
      {desktop && pos > 0 && pos < screens.length && (
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
  if (pos >= screens.length) {
    const failed = steps.some((s) => state.steps[stepKey(activity.id, s.id)] === "fail");
    const allChecked = activity.expected.every((_, i) => draft.checks[String(i)] !== undefined);
    const anyNo = activity.expected.some((_, i) => draft.checks[String(i)] === false);
    // El resultado se sugiere solo (con falla si algún paso o punto salió mal); el tester lo puede cambiar
    const suggested: ActivityResult | undefined = failed || anyNo ? "issue" : allChecked ? "ok" : undefined;
    const result = draft.result ?? suggested;
    const ordersErrs = Object.fromEntries(
      (activity.fields ?? []).filter((f) => f.type === "orders").map((f) => [f.id, ordersError(draft.fields[f.id], !!f.required && (!result || result === "ok" || result === "issue"))])
    );
    const skipped = result === "skipped";
    const hasOrders = (activity.fields ?? []).some((f) => f.type === "orders");
    // Obligatorios solo si le fue bien o con falla; con «No pude» o «No me tocó» basta con que lo escrito tenga buen formato
    const requireFilled = !result || result === "ok" || result === "issue";
    const fieldErrors = validateFields((activity.fields ?? []).filter((f) => f.type !== "orders"), draft.fields, requireFilled);
    const errors: Errors = { ...fieldErrors };
    for (const [k, v] of Object.entries(ordersErrs)) if (v) errors[k] = v;
    if (!result) errors._result = `Elige cómo te fue en ${activity.id}.`;
    if (draft.notes.trim().length > LIMITS.notes) errors._notes = `Máximo ${LIMITS.notes} caracteres.`;
    const shown: Errors = tried ? errors : {};
    const complete = Object.keys(errors).length === 0 && (allChecked || skipped);
    const card = "p-4" + dk("lg:p-6");
    const save = async () => {
      if (Object.keys(errors).length) {
        setTried(true);
        focusFirstError(closingRef.current);
        return;
      }
      // Guardar cierra la actividad para siempre: con «No pude hacerla» se pide confirmación
      if (
        result === "blocked" &&
        !(await confirm({
          title: `¿Guardar ${activity.id} como «${ACTIVITY_RESULTS.blocked}»?`,
          message: "Al guardar, la actividad se cierra y ya no podrás cambiarla. Si fue una falla, revisa que la hayas reportado con «No pude».",
          confirmLabel: "Sí, guardar",
          cancelLabel: "Revisar",
        }))
      )
        return;
      onSave({ ...draft, result, fields: trimAll(draft.fields), notes: draft.notes.trim(), done: true });
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
          <div className={"overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200" + dk(hasOrders ? "" : "lg:max-w-3xl")}>
            <div className={card}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className={"font-semibold" + dk("lg:text-lg")}>Resultado esperado</h2>
                  <p className="text-sm text-slate-600">¿Pasó lo que dice cada punto?</p>
                </div>
              </div>
              <ul className="divide-y divide-slate-100">
                {activity.expected.map((item, i) => {
                  const v = draft.checks[String(i)];
                  const e = expectedText(item);
                  const cond = expectedConditional(item);
                  return (
                    <li key={i} className={"py-3 first:pt-0 last:pb-0" + dk("lg:flex lg:items-center lg:gap-4")}>
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

            <div className="divide-y divide-slate-100 border-t border-slate-100">
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
                {failed ? (
                  <p className="mt-1 text-sm text-amber-800">Reportaste al menos una falla en los pasos.</p>
                ) : !draft.result && suggested ? (
                  <p className="mt-1 text-sm text-slate-600">Lo marcamos según tus respuestas. Cámbialo si no fue así.</p>
                ) : null}
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
                      aria-pressed={result === r}
                      onClick={() => setDraft({ ...draft, result: r })}
                      whileHover={reduce ? undefined : { x: 2 }}
                      whileTap={reduce ? { opacity: 0.8 } : { scale: 0.96 }}
                      animate={result === r && !reduce ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                      transition={{ duration: 0.25 }}
                      className={`min-h-12 rounded-xl px-4 py-3 text-left font-medium ring-1 transition-colors ${
                        result === r ? RESULT_STYLE[r] : shown._result ? "bg-white ring-2 ring-rose-400" : "bg-white ring-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {ACTIVITY_RESULTS[r]}
                    </motion.button>
                  ))}
                </div>
                {shown._result && <FieldError id={`res-${activity.id}-err`}>{shown._result}</FieldError>}
                {!showNotes && !draft.notes ? (
                  <button
                    type="button"
                    onClick={() => setShowNotes(true)}
                    className="mt-3 min-h-11 px-1 text-sm font-medium text-brand-700 hover:underline"
                  >
                    + Agregar un comentario (opcional)
                  </button>
                ) : (
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
                )}
              </div>

              {issuesFor().length > 0 && (
                <div className={card}>
                  <IssueList issues={issuesFor()} />
                </div>
              )}
            </div>
          </div>
          <p className={"px-1 text-xs text-slate-600" + dk("lg:hidden")}>✓ Tus respuestas se guardan solas en este navegador mientras llenas.</p>

          <div
            className={
              "pb-safe sticky bottom-0 z-10 -mx-4 space-y-2 bg-[#f4f6fa]/95 px-4 pt-2 backdrop-blur" +
              dk((hasOrders ? "" : "lg:max-w-3xl ") + "lg:mx-0 lg:flex lg:items-center lg:justify-end lg:gap-4 lg:space-y-0 lg:rounded-2xl lg:bg-white/95 lg:px-5 lg:py-3 lg:shadow-md lg:ring-1 lg:ring-slate-200 lg:bottom-4")
            }
          >
            {tried && Object.keys(errors).length > 0 ? (
              <p className={"text-center text-xs font-medium text-rose-700" + dk("lg:mr-auto lg:text-sm")} role="alert">
                Revisa {Object.keys(errors).length === 1 ? "el dato marcado" : `los ${Object.keys(errors).length} datos marcados`} en rojo.
              </p>
            ) : !allChecked && result && !skipped ? (
              <p className={"text-center text-xs text-slate-600" + dk("lg:mr-auto lg:text-sm")}>Te faltan puntos del resultado esperado.</p>
            ) : desktop ? (
              <p className="hidden text-sm text-slate-600 lg:mr-auto lg:block">Tus respuestas se guardan solas mientras llenas.</p>
            ) : null}
            <div className={"grid grid-cols-[auto_1fr] gap-2" + dk("lg:w-[420px]")}>
              <Button variant="outline" size="lg" onClick={() => go(screens.length - 1)} aria-label="Pantalla anterior">
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

  const screen = screens[pos];
  const screenSteps = screen.steps;
  const num = (s: Activity["steps"][number]) => screen.start + screenSteps.indexOf(s) + 1;
  const outcomeOf = (s: Activity["steps"][number]) => state.steps[stepKey(activity.id, s.id)];
  const screenIssues = state.issues.filter((i) => i.activityId === activity.id && screenSteps.some((s) => s.id === i.stepId));

  // Todos los pasos de la pantalla en una sola tarjeta, cada uno con su captura. «Listo, siguiente»
  // se habilita cuando el tester ya pasó por todos los pasos; antes, el botón lo lleva al siguiente.
  const pending = screenSteps.filter((s) => !seen[s.id] && !outcomeOf(s));
  const cpPending = screenSteps.some((s) => s.checkpoint && !checkpointDone(s));
  const next = () => {
    for (const s of screenSteps) if (!outcomeOf(s)) onStep(s.id, "ok");
    go(pos + 1);
  };
  const openData = () => {
    setDataSeen((m) => ({ ...m, [screen.start]: true }));
    onOpenData?.(parts.of(screen.steps[0].id));
  };

  const checklist = (s: Activity["steps"][number]) => {
    const cp = s.checkpoint!;
    const ticks = ticksFor(s.id);
    const n = cp.items.filter((_, i) => ticks[String(i)]).length;
    return (
      <fieldset className="mt-1" data-testid="checkpoint">
        <legend className="mb-2 flex w-full items-center justify-between gap-3 text-[15px] font-semibold text-slate-900">
          <span>{cp.title}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${n === cp.items.length ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`} aria-live="polite">
            {n} de {cp.items.length}
          </span>
        </legend>
        <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
          {cp.items.map((it, i) => {
            const on = !!ticks[String(i)];
            return (
              <li key={i}>
                <label className="flex min-h-12 cursor-pointer items-start gap-3 px-3 py-3 text-[15px] hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-6 w-6 shrink-0 accent-emerald-600"
                    checked={on}
                    disabled={blocked}
                    onChange={(e) => onCheckpoint?.(s.id, { ...ticks, [String(i)]: e.target.checked })}
                  />
                  <span className="flex-1 text-slate-800">
                    <Rich text={it} />
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    );
  };

  // Una sola tarjeta: datos de la actividad (solo en la primera pantalla) y los pasos de la pantalla
  const stepsCard = (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200" data-testid="instructions">
      {pos === 0 && (
        <div className={"space-y-3 border-b border-slate-100 p-4 text-sm" + dk("lg:p-5")}>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
          {activity.warnings?.map((w, i) => (
            <p key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
              ⚠️ <Rich text={w} />
            </p>
          ))}
          {activity.notes && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sky-950">
              <Rich text={activity.notes} />
            </p>
          )}
        </div>
      )}
      <ol data-steps={`${activity.id}-${pos}`} className="divide-y divide-slate-100">
        {screenSteps.map((s) => {
          const o = outcomeOf(s);
          const badge = o === "fail" ? "bg-rose-600" : o === "na" ? "bg-slate-500" : o ? "bg-emerald-600" : "bg-brand-gradient";
          return (
            <li key={s.id} data-step-id={s.id} data-testid="instruction" className={"scroll-mt-40 px-4 py-4" + dk("lg:scroll-mt-6 lg:px-6 lg:py-5")}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${badge}`} aria-hidden="true">
                  {o === "fail" ? "!" : o === "na" ? "–" : o ? "✓" : num(s)}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="sr-only">Paso {num(s)}. </span>
                  {!s.checkpoint && (
                    <p className={"text-[16px] leading-relaxed text-slate-900" + dk("lg:text-[17px] lg:leading-7")}>
                      <Rich text={s.text} links />
                    </p>
                  )}
                  {s.warning && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[15px] text-amber-950" role="note" data-testid="step-warning">
                      ⚠️ <Rich text={s.warning} links />
                    </p>
                  )}
                  {s.checkpoint && checklist(s)}
                  {s.dataButton && (
                    <Coachmark id="tester-datos-sucursal" title={dataLabel} message="Aquí están los nombres, precios y datos exactos de este paso." placement="top">
                      <button
                        type="button"
                        onClick={openData}
                        data-testid="data-button"
                        className={`mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[15px] font-semibold text-amber-950 ring-1 ring-amber-300 hover:bg-amber-100 ${
                          dataSeen[screen.start] ? "" : "attn attn-amber"
                        }`}
                      >
                        <span aria-hidden="true">📊</span> Ver {dataLabel}
                      </button>
                    </Coachmark>
                  )}
                  {s.evidence && (
                    <button
                      type="button"
                      onClick={() => onReport("evidence", s.id)}
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-3 py-2 text-[15px] font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
                    >
                      📷 Adjuntar la captura que pide este paso
                    </button>
                  )}
                  {s.image && (
                    <div className={"mt-3" + dk("lg:max-w-2xl")} data-testid="screenshots">
                      <StepImage key={s.image} src={s.image} caption={s.caption} desktop={desktop} />
                    </div>
                  )}
                  {!s.checkpoint && !blocked && (
                    <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
                      {o === "fail" ? (
                        <span className="min-h-10 py-2 font-medium text-rose-700">Reportaste una falla en este paso.</span>
                      ) : (
                        <button type="button" onClick={() => onReport("issue", s.id, true)} className="min-h-10 py-2 font-medium text-rose-700 hover:underline">
                          ✗ Tuve un problema
                        </button>
                      )}
                      {s.conditional && o !== "fail" && (
                        <button
                          type="button"
                          aria-pressed={o === "na"}
                          onClick={() => onStep(s.id, o === "na" ? null : "na")}
                          data-testid="step-na"
                          className={`min-h-10 py-2 font-medium ${o === "na" ? "text-slate-900" : "text-slate-600 hover:underline"}`}
                        >
                          {o === "na" ? "✓ No me apareció (toca para quitar)" : "No me apareció"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div data-step-end aria-hidden="true" className="h-px" />
            </li>
          );
        })}
      </ol>
      {screenIssues.length > 0 && (
        <div className="border-t border-slate-100 p-4">
          <IssueList issues={screenIssues} />
        </div>
      )}
    </div>
  );

  const actions = (
    <div
      className={
        "pb-safe sticky bottom-0 z-10 -mx-4 bg-[#f4f6fa]/95 px-4 pt-2 backdrop-blur" +
        dk("lg:bottom-4 lg:mx-0 lg:rounded-2xl lg:bg-white/95 lg:p-4 lg:shadow-md lg:ring-1 lg:ring-slate-200")
      }
    >
      {blocked ? (
        <p className="mb-2 text-center text-xs font-medium text-rose-700">Actividad en pausa: pide ayuda al guía para continuar.</p>
      ) : pending.length ? (
        <p className="mb-2 text-center text-sm text-slate-700">
          Lee los {screenSteps.length} pasos antes de seguir · te {pending.length === 1 ? "falta 1" : `faltan ${pending.length}`}
        </p>
      ) : cpPending ? (
        <p className="mb-2 text-center text-xs font-medium text-slate-700" id={`cp-hint-${activity.id}-${pos}`}>
          Marca todas las casillas para poder seguir.
        </p>
      ) : (
        <p className="mb-2 text-center text-sm font-medium text-slate-700">¿Hiciste {screenSteps.length > 1 ? "estos pasos" : "este paso"}?</p>
      )}
      {pending.length && !blocked ? (
        <Button variant="outline" size="lg" className="w-full" onClick={() => showNextStep(pending.map((s) => s.id))} data-testid="screen-more">
          ↓ Ver siguiente paso
        </Button>
      ) : (
        <Button
          variant="success"
          size="lg"
          className="w-full"
          disabled={blocked || cpPending}
          aria-describedby={cpPending ? `cp-hint-${activity.id}-${pos}` : undefined}
          pulse={!blocked && !cpPending && !screenDone(screen)}
          onClick={next}
          data-testid="screen-next"
        >
          {screenDone(screen) ? "Siguiente →" : "✓ Listo, siguiente"}
        </Button>
      )}
      <div className={"mt-1 flex items-center justify-between text-sm" + dk("lg:mt-2")}>
        <button
          type="button"
          disabled={pos === 0}
          onClick={() => go(pos - 1)}
          className={"min-h-11 px-2 py-2 text-slate-600 disabled:opacity-30" + dk("lg:rounded-lg lg:hover:bg-slate-100 lg:hover:text-slate-800")}
        >
          ← Pantalla anterior
        </button>
        <button
          type="button"
          onClick={() => onReport("issue", screenSteps[screenSteps.length - 1].id)}
          className={"min-h-11 px-2 py-2 font-medium text-rose-700" + dk("lg:rounded-lg lg:hover:bg-rose-50")}
        >
          Reportar otra falla
        </button>
      </div>
    </div>
  );

  return (
    <>
    {header}
    <StepFrame id={`${activity.id}-p${pos}`} dir={dir}>
      <section className={"mt-1 space-y-4" + dk("lg:mt-4 lg:max-w-3xl")} data-activity-content>
        {blocked && blockedPanel}
        {stepsCard}
        {actions}
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
