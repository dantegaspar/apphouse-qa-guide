"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Activity } from "@/lib/types";
import { ACTIVITY_RESULTS, type ActivityResult } from "@/lib/types";
import { Button, Callout, inputCls, ProgressBar, Rich, StepImage } from "./ui";
import { emptyActivity, stepKey, type ActivityState, type Issue, type Outcome, type RunState } from "./store";

const RESULT_STYLE: Record<ActivityResult, string> = {
  ok: "bg-emerald-600 text-white ring-emerald-600",
  issue: "bg-amber-500 text-white ring-amber-500",
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
}: {
  activity: Activity;
  index: number;
  total: number;
  state: RunState;
  initialStep: number;
  onStep: (stepId: string, outcome: Outcome | null) => void;
  onReport: (kind: "issue" | "evidence", stepId?: string) => void;
  onSave: (a: ActivityState) => void;
  onExit: () => void;
  /** La actividad está detenida por una falla bloqueante: no se puede avanzar. */
  blocked?: boolean;
  blockedPanel?: ReactNode;
  /** Guía de escritorio: en pantallas grandes (lg) los pasos van en dos columnas con la captura grande. */
  desktop?: boolean;
}) {
  const steps = activity.steps;
  const [pos, setPos] = useState(Math.min(initialStep, steps.length)); // steps.length = cierre
  const saved = state.activities[activity.id] ?? emptyActivity();
  const [draft, setDraft] = useState<ActivityState>(saved);

  const issuesFor = (stepId?: string) =>
    state.issues.filter((i) => i.activityId === activity.id && (stepId === undefined || i.stepId === stepId));

  const go = (p: number) => {
    setPos(p);
    window.scrollTo({ top: 0 });
  };
  /** Clases que solo aplican en la guía de escritorio. */
  const dk = (c: string) => (desktop ? " " + c : "");

  // Atajos de teclado en escritorio: ← paso anterior, → paso siguiente (solo si ya se marcó y no hay pausa)
  const keyState = useRef({ pos, canNext: false });
  const curOutcome = pos < steps.length ? state.steps[stepKey(activity.id, steps[pos].id)] : undefined;
  useEffect(() => {
    keyState.current = { pos, canNext: pos < steps.length && !!curOutcome && !blocked };
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
        setPos(Math.min(p, steps.length) - 1);
        window.scrollTo({ top: 0 });
      } else if (e.key === "ArrowRight" && canNext) {
        e.preventDefault();
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
          <dt className="text-xs font-semibold uppercase text-slate-500">Cuándo</dt>
          <dd>
            <Rich text={activity.when} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">Dónde</dt>
          <dd>
            <Rich text={activity.where} />
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
    <div className={"sticky top-0 z-20 -mx-4 bg-[#f4f6fa]/95 px-4 pb-3 pt-3 backdrop-blur" + dk("lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pb-1 lg:pt-1 lg:backdrop-blur-none")}>
      <div className="flex items-center gap-2">
        <button onClick={onExit} className={"rounded-lg px-2 py-1 text-sm text-brand-600 hover:bg-brand-50" + dk("lg:-ml-2")}>
          ← Actividades
        </button>
        <span className="ml-auto text-xs text-slate-500">
          Actividad {index + 1} de {total}
        </span>
      </div>
      <h1 className={"mt-1 text-xl font-bold leading-tight" + dk("lg:text-[26px]")}>
        <span className="text-teal-brand">{activity.id}</span> · {activity.title}
      </h1>
      <div className={"mt-2 flex items-center gap-2" + dk("lg:mt-3 lg:gap-3")}>
        <ProgressBar value={pos / steps.length} />
        <span className={"shrink-0 text-xs font-medium text-slate-500" + dk("lg:text-sm")}>
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
    const card = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" + dk("lg:p-6");
    return (
      <div className="animate-pop">
        {header}
        <section className={"mt-2 space-y-5" + dk("lg:mt-5")}>
          {blocked && blockedPanel}
          <div className={dk("lg:grid lg:grid-cols-2 lg:items-start lg:gap-6")}>
            <div className={card}>
              <h2 className={"font-semibold" + dk("lg:text-lg")}>Resultado esperado</h2>
              <p className="mb-3 text-sm text-slate-500">¿Pasó lo que dice cada punto?</p>
              <ul className="space-y-3">
                {activity.expected.map((e, i) => {
                  const v = draft.checks[String(i)];
                  return (
                    <li key={i} className={"rounded-xl bg-slate-50 p-3" + dk("lg:flex lg:items-center lg:gap-4 lg:px-4")}>
                      <p className={"text-sm" + dk("lg:flex-1")}>{e}</p>
                      <div className={"mt-2 grid grid-cols-2 gap-2" + dk("lg:mt-0 lg:w-36 lg:shrink-0")}>
                        {[
                          [true, "Sí"],
                          [false, "No"],
                        ].map(([val, label]) => (
                          <button
                            key={label as string}
                            onClick={() => setDraft({ ...draft, checks: { ...draft.checks, [String(i)]: val as boolean } })}
                            className={`rounded-lg py-2 text-sm font-medium ring-1 ${
                              v === val
                                ? val
                                  ? "bg-emerald-600 text-white ring-emerald-600"
                                  : "bg-rose-600 text-white ring-rose-600"
                                : "bg-white ring-slate-300"
                            }`}
                          >
                            {label as string}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className={"mt-5 space-y-5" + dk("lg:mt-0")}>
              {activity.fields && activity.fields.length > 0 && (
                <div className={"space-y-3 " + card}>
                  <h2 className={"font-semibold" + dk("lg:text-lg")}>Anota</h2>
                  <div className={"space-y-3" + dk("lg:grid lg:grid-cols-2 lg:gap-x-4 lg:gap-y-3 lg:space-y-0")}>
                    {activity.fields.map((f) => (
                      <label key={f.id} className="block">
                        <span className="mb-1 block text-sm">{f.label}</span>
                        <input
                          className={inputCls}
                          type={f.type === "number" ? "number" : f.type === "time" ? "time" : "text"}
                          inputMode={f.type === "number" ? "numeric" : undefined}
                          placeholder={f.placeholder}
                          value={draft.fields[f.id] ?? ""}
                          onChange={(e) => setDraft({ ...draft, fields: { ...draft.fields, [f.id]: e.target.value } })}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className={card}>
                <h2 className={"font-semibold" + dk("lg:text-lg")}>¿Cómo te fue en {activity.id}?</h2>
                {failed && <p className="mt-1 text-sm text-amber-700">Marcaste al menos un paso como «No pude».</p>}
                <div className={"mt-3 grid grid-cols-1 gap-2" + dk("lg:grid-cols-2")}>
                  {(Object.keys(ACTIVITY_RESULTS) as ActivityResult[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setDraft({ ...draft, result: r })}
                      className={`rounded-xl px-4 py-3 text-left font-medium ring-1 ${
                        draft.result === r ? RESULT_STYLE[r] : "bg-white ring-slate-300"
                      }`}
                    >
                      {ACTIVITY_RESULTS[r]}
                    </button>
                  ))}
                </div>
                <label className="mt-4 block">
                  <span className="mb-1 block text-sm">Comentarios (opcional)</span>
                  <textarea
                    className={inputCls + " min-h-20"}
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  />
                </label>
              </div>

              <IssueList issues={issuesFor()} />
            </div>
          </div>

          <div
            className={
              "pb-safe sticky bottom-0 -mx-4 space-y-2 bg-[#f4f6fa]/95 px-4 pt-2 backdrop-blur" +
              dk("lg:mx-0 lg:flex lg:items-center lg:justify-end lg:gap-4 lg:space-y-0 lg:rounded-2xl lg:bg-white/95 lg:px-5 lg:py-3 lg:shadow-md lg:ring-1 lg:ring-slate-200 lg:bottom-4")
            }
          >
            {!allChecked && draft.result && draft.result !== "skipped" && (
              <p className={"text-center text-xs text-slate-500" + dk("lg:mr-auto lg:text-sm")}>Te faltan puntos del resultado esperado.</p>
            )}
            <div className={"grid grid-cols-[auto_1fr] gap-2" + dk("lg:w-[420px]")}>
              <Button variant="outline" size="lg" onClick={() => go(steps.length - 1)} aria-label="Paso anterior">
                ←
              </Button>
              <Button size="lg" disabled={!draft.result || blocked} onClick={() => onSave({ ...draft, done: true })}>
                Guardar y continuar
              </Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const step = steps[pos];
  const outcome = state.steps[stepKey(activity.id, step.id)];
  const stepIssues = issuesFor(step.id);
  const legend = step.caption ? captionLegend(step.caption) : null;

  return (
    <div className="animate-pop" key={step.id}>
      {header}
      <section className={"mt-1 space-y-4" + dk("lg:mt-4 lg:space-y-5")}>
        {blocked && !desktop && blockedPanel}
        {pos === 0 && info()}

        <div className={dk("lg:grid lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] lg:items-start lg:gap-6")}>
          {/* Columna izquierda (en celular, todo va en una sola columna) */}
          <div className="space-y-4">
            {blocked && desktop && blockedPanel}
            <div className={"rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200" + dk("lg:p-6")}>
              <div className={"mb-2 flex items-center gap-3" + dk("lg:mb-3")}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-white">
                  {pos + 1}
                </div>
                {desktop && (
                  <span className="hidden text-xs font-semibold uppercase tracking-wide text-slate-500 lg:inline">
                    Paso {pos + 1} de {steps.length}
                  </span>
                )}
              </div>
              <p className={"text-[17px] leading-relaxed text-slate-700" + dk("lg:text-base lg:leading-7")}>
                <Rich text={step.text} />
              </p>
              {desktop && legend && (
                <div className="mt-4 hidden rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100 lg:block">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">En la captura</div>
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
                  {legend.numbered && legend.note && <p className="mt-2 text-xs text-slate-500">{legend.note}</p>}
                </div>
              )}
              {step.evidence && (
                <button
                  onClick={() => onReport("evidence", step.id)}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700"
                >
                  📷 Adjuntar la captura que pide este paso
                </button>
              )}
            </div>

            {step.image && (
              <div className={desktop ? "lg:hidden" : undefined}>
                <StepImage src={step.image} caption={step.caption} />
              </div>
            )}

            <IssueList issues={stepIssues} />

            <div
              className={
                "pb-safe sticky bottom-0 -mx-4 bg-[#f4f6fa]/95 px-4 pt-2 backdrop-blur" +
                dk("lg:static lg:mx-0 lg:rounded-2xl lg:bg-white lg:p-4 lg:shadow-sm lg:ring-1 lg:ring-slate-200 lg:backdrop-blur-none")
              }
            >
              {blocked ? (
                <p className="mb-2 text-center text-xs font-medium text-rose-700">Actividad en pausa: pide ayuda al guía para continuar.</p>
              ) : outcome ? (
                <p className="mb-2 text-center text-xs text-slate-500">
                  Marcaste: <strong>{outcome === "ok" ? "Lo logré" : "No pude"}</strong> · puedes cambiarlo
                </p>
              ) : desktop ? (
                <p className="mb-3 hidden text-sm font-medium text-slate-600 lg:block">¿Pudiste hacer este paso?</p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="danger"
                  size="lg"
                  className={outcome === "fail" ? "!bg-rose-600 !text-white" : ""}
                  onClick={() => {
                    onStep(step.id, "fail");
                    onReport("issue", step.id);
                  }}
                >
                  ✗ No pude
                </Button>
                <Button
                  variant="success"
                  size="lg"
                  disabled={blocked}
                  className={outcome === "ok" ? "ring-4 ring-emerald-200" : ""}
                  onClick={() => {
                    onStep(step.id, "ok");
                    go(pos + 1);
                  }}
                >
                  ✓ Lo logré
                </Button>
              </div>
              <div className={"mt-1 flex items-center justify-between text-sm" + dk("lg:mt-2")}>
                <button
                  disabled={pos === 0}
                  onClick={() => go(pos - 1)}
                  className={"px-2 py-2 text-slate-500 disabled:opacity-30" + dk("lg:rounded-lg lg:hover:bg-slate-100 lg:hover:text-slate-800")}
                >
                  ← Anterior
                </button>
                <button
                  onClick={() => onReport("issue", step.id)}
                  className={"px-2 py-2 font-medium text-rose-700" + dk("lg:rounded-lg lg:hover:bg-rose-50")}
                >
                  Reportar otra falla
                </button>
                {outcome ? (
                  <button
                    disabled={blocked}
                    onClick={() => go(pos + 1)}
                    className={"px-2 py-2 text-slate-500 disabled:opacity-30" + dk("lg:rounded-lg lg:hover:bg-slate-100 lg:hover:text-slate-800")}
                  >
                    Siguiente →
                  </button>
                ) : (
                  <span className="w-20" />
                )}
              </div>
              {desktop && (
                <p className="mt-2 hidden border-t border-slate-100 pt-2 text-center text-xs text-slate-400 lg:block">
                  Atajos: <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-sans text-slate-600">←</kbd> paso anterior ·{" "}
                  <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-sans text-slate-600">→</kbd> siguiente (si ya lo marcaste)
                </p>
              )}
            </div>
          </div>

          {/* Columna derecha (escritorio): la captura en grande */}
          {desktop && (
            <div className="hidden lg:block">
              {step.image ? (
                <StepImage key={step.image} src={step.image} caption={step.caption} desktop captionAside={!!legend} />
              ) : (
                <div className="flex h-64 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 text-center text-sm text-slate-400">
                  <span className="text-3xl opacity-60">🖥️</span>
                  <span className="mt-2">Este paso no tiene captura de pantalla.</span>
                  <span>Sigue las indicaciones de la izquierda.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
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
