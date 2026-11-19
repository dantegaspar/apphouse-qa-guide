"use client";

import { useState } from "react";
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

  const header = (
    <div className="sticky top-0 z-20 -mx-4 bg-[#f4f6fa]/95 px-4 pb-3 pt-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <button onClick={onExit} className="rounded-lg px-2 py-1 text-sm text-brand-600 hover:bg-brand-50">
          ← Actividades
        </button>
        <span className="ml-auto text-xs text-slate-500">
          Actividad {index + 1} de {total}
        </span>
      </div>
      <h1 className="mt-1 text-xl font-bold leading-tight">
        <span className="text-teal-brand">{activity.id}</span> · {activity.title}
      </h1>
      <div className="mt-2 flex items-center gap-2">
        <ProgressBar value={pos / steps.length} />
        <span className="shrink-0 text-xs font-medium text-slate-500">
          {pos < steps.length ? `Paso ${pos + 1}/${steps.length}` : "Cierre"}
        </span>
      </div>
    </div>
  );

  // Pantalla de cierre de la actividad
  if (pos >= steps.length) {
    const failed = steps.some((s) => state.steps[stepKey(activity.id, s.id)] === "fail");
    const allChecked = activity.expected.every((_, i) => draft.checks[String(i)] !== undefined);
    return (
      <div className="animate-pop">
        {header}
        <section className="mt-2 space-y-5">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold">Resultado esperado</h2>
            <p className="mb-3 text-sm text-slate-500">¿Pasó lo que dice cada punto?</p>
            <ul className="space-y-3">
              {activity.expected.map((e, i) => {
                const v = draft.checks[String(i)];
                return (
                  <li key={i} className="rounded-xl bg-slate-50 p-3">
                    <p className="text-sm">{e}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
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

          {activity.fields && activity.fields.length > 0 && (
            <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-semibold">Anota</h2>
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
          )}

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold">¿Cómo te fue en {activity.id}?</h2>
            {failed && <p className="mt-1 text-sm text-amber-700">Marcaste al menos un paso como «No pude».</p>}
            <div className="mt-3 grid grid-cols-1 gap-2">
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

          <div className="pb-safe sticky bottom-0 -mx-4 space-y-2 bg-[#f4f6fa]/95 px-4 pt-2 backdrop-blur">
            {!allChecked && draft.result && draft.result !== "skipped" && (
              <p className="text-center text-xs text-slate-500">Te faltan puntos del resultado esperado.</p>
            )}
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="outline" size="lg" onClick={() => go(steps.length - 1)}>
                ←
              </Button>
              <Button size="lg" disabled={!draft.result} onClick={() => onSave({ ...draft, done: true })}>
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

  return (
    <div className="animate-pop" key={step.id}>
      {header}
      <section className="mt-1 space-y-4">
        {pos === 0 && (
          <>
            <dl className="grid grid-cols-1 gap-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
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
          </>
        )}

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-white">
            {pos + 1}
          </div>
          <p className="text-[17px] leading-relaxed text-slate-700">
            <Rich text={step.text} />
          </p>
          {step.evidence && (
            <button
              onClick={() => onReport("evidence", step.id)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700"
            >
              📷 Adjuntar la captura que pide este paso
            </button>
          )}
        </div>

        {step.image && <StepImage src={step.image} caption={step.caption} />}

        <IssueList issues={stepIssues} />

        <div className="pb-safe sticky bottom-0 -mx-4 bg-[#f4f6fa]/95 px-4 pt-2 backdrop-blur">
          {outcome && (
            <p className="mb-2 text-center text-xs text-slate-500">
              Marcaste: <strong>{outcome === "ok" ? "Lo logré" : "No pude"}</strong> · puedes cambiarlo
            </p>
          )}
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
              className={outcome === "ok" ? "ring-4 ring-emerald-200" : ""}
              onClick={() => {
                onStep(step.id, "ok");
                go(pos + 1);
              }}
            >
              ✓ Lo logré
            </Button>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <button disabled={pos === 0} onClick={() => go(pos - 1)} className="px-2 py-2 text-slate-500 disabled:opacity-30">
              ← Anterior
            </button>
            <button onClick={() => onReport("issue", step.id)} className="px-2 py-2 font-medium text-rose-700">
              Reportar otra falla
            </button>
            {outcome ? (
              <button onClick={() => go(pos + 1)} className="px-2 py-2 text-slate-500">
                Siguiente →
              </button>
            ) : (
              <span className="w-20" />
            )}
          </div>
        </div>
      </section>
    </div>
  );
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
