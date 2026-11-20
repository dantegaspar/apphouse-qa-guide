"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Guide } from "@/lib/types";
import { ACTIVITY_RESULTS, TESTER_ROLES, type GuideVariant } from "@/lib/types";
import ActivityView from "./ActivityView";
import BlockedPanel from "./BlockedPanel";
import ReportSheet, { type ReportDraft } from "./ReportSheet";
import Survey from "./Survey";
import { Button, Callout, inputCls, Rich, Sheet, StepImage } from "./ui";
import { callRun, detectDevice, emptyActivity, stepKey, uid, useRun, type Blocked, type Issue, type RunState } from "./store";

type View = { name: "home" } | { name: "prep" } | { name: "activity"; id: string; step: number } | { name: "summary" } | { name: "survey" };

type HelpStatus = {
  status: string;
  endedReason: string;
  endedAt: string | null;
  open: { id: string; activityId: string; stepId?: string; issueId?: string; reason: string; createdAt: string } | null;
};

export default function GuideApp({
  guide,
  maxUploadMb,
  variant,
  onSwitchVariant,
}: {
  guide: Guide;
  maxUploadMb: number;
  /** Solo en guías con variante de escritorio y de celular. */
  variant?: GuideVariant;
  /** Cambia a la otra variante (solo antes de identificarse). */
  onSwitchVariant?: () => void;
}) {
  const { state, loaded, syncing, syncError, commit, update, flush, stateRef } = useRun(guide.id);
  const [view, setView] = useState<View>({ name: "home" });
  const [showRef, setShowRef] = useState(false);
  const [report, setReport] = useState<{ kind: "issue" | "evidence"; activityId: string; stepId?: string } | null>(null);

  const totalSteps = useMemo(() => guide.activities.reduce((n, a) => n + a.steps.length, 0), [guide]);

  const nav = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  const submitReport = useCallback(
    async (draft: ReportDraft, files: File[]): Promise<string | null> => {
      if (!report) return null;
      const issue: Issue = {
        id: uid(),
        activityId: report.activityId,
        stepId: report.stepId,
        ...draft,
        attachments: [],
        createdAt: new Date().toISOString(),
      };
      // Una falla que impide seguir detiene la actividad hasta que el guía ayude
      const block: Blocked | undefined =
        issue.kind === "issue" && issue.blocking
          ? { activityId: issue.activityId, stepId: issue.stepId, issueId: issue.id, reason: issue.description }
          : undefined;
      update((s) => ({ ...s, issues: [...s.issues, issue], blocked: s.blocked ?? block }), [{ type: "issue", payload: { ...issue } }]);
      // Lleva al tester al panel de pausa (arriba de la actividad)
      if (block) setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
      if (files.length === 0) return null;
      // Los archivos necesitan que el reporte ya exista en el servidor
      const ok = await flush();
      if (!ok) return "Se guardó tu reporte, pero no hay conexión para subir los archivos. Revisa tu internet e inténtalo de nuevo.";
      const s = stateRef.current!;
      for (const f of files) {
        const fd = new FormData();
        fd.append("issueId", issue.id);
        fd.append("file", f);
        const res = await fetch(`/api/runs/${s.runId}/attachments`, { method: "POST", headers: { "x-run-token": s.token }, body: fd }).catch(() => null);
        if (!res || !res.ok) {
          const msg = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
          return msg || "No se pudo subir un archivo. Revisa tu conexión e inténtalo de nuevo.";
        }
        const att = (await res.json()) as { id: string; size: number };
        update((st) => ({
          ...st,
          issues: st.issues.map((i) => (i.id === issue.id ? { ...i, attachments: [...i.attachments, { id: att.id, name: f.name, size: att.size }] } : i)),
        }));
      }
      return null;
    },
    [report, update, flush, stateRef]
  );

  // Al cargar, se concilia el bloqueo con el servidor (por si una respuesta se perdió)
  const runId = state?.runId;
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    void (async () => {
      const cur = stateRef.current;
      if (!cur) return;
      const r = await callRun<HelpStatus>(cur, "help");
      if (cancelled || !r.ok) return;
      const { status, endedReason, endedAt, open } = r.data;
      update((s) => {
        if (status === "ended_blocked") {
          return s.ended ? s : { ...s, blocked: undefined, ended: { reason: endedReason, at: endedAt || new Date().toISOString() } };
        }
        if (open && s.blocked?.helpId !== open.id) {
          return {
            ...s,
            blocked: {
              activityId: open.activityId,
              stepId: open.stepId,
              issueId: open.issueId ?? s.blocked?.issueId ?? "",
              reason: open.reason,
              helpId: open.id,
              requestedAt: open.createdAt,
            },
          };
        }
        // La solicitud ya no está abierta (se resolvió con el guía): se quita el bloqueo
        if (!open && s.blocked?.helpId) return { ...s, blocked: undefined };
        return s;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, update, stateRef]);

  const mobileBanner = variant === "mobile" && (
    <div className="border-b border-teal-200 bg-teal-50 px-4 py-1.5 text-center text-xs font-semibold text-teal-800" data-testid="mobile-banner">
      📱 Guía para la app de establecimientos en celular
    </div>
  );

  if (!loaded) return <div className="flex flex-1 items-center justify-center text-slate-500">Cargando…</div>;
  if (!state || state.guideVersion === undefined)
    return (
      <>
        {mobileBanner}
        <Identify guide={guide} variant={variant} onSwitchVariant={onSwitchVariant} onDone={(s) => commit(s)} />
      </>
    );

  const answered = guide.activities.reduce(
    (n, a) => n + a.steps.filter((s) => state.steps[stepKey(a.id, s.id)]).length,
    0
  );
  const doneActs = guide.activities.filter((a) => state.activities[a.id]?.done).length;
  const failCount = state.issues.filter((i) => i.kind === "issue").length;

  const topbar = (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2.5">
        <button onClick={() => nav({ name: "home" })} className="flex items-center gap-2" aria-label="Inicio de la guía">
          <Image src="/logo.png" alt="" width={36} height={26} />
          <span className="text-left text-sm font-semibold leading-tight">
            {guide.role}
            <span className="block text-xs font-normal text-slate-500">{state.tester.name}</span>
          </span>
        </button>
        <span
          className={`ml-auto text-xs ${syncError ? "text-amber-600" : "text-slate-400"}`}
          title={syncError ? "Sin conexión: se enviará al volver el internet" : "Guardado"}
        >
          {syncing ? "Guardando…" : syncError || state.outbox.length ? `● ${state.outbox.length} sin enviar` : "✓ Guardado"}
        </span>
        <Button variant="outline" onClick={() => setShowRef(true)} className="!px-3 !py-1.5">
          Datos
        </Button>
      </div>
      {mobileBanner}
    </header>
  );

  // Flujo estricto: solo se abre la actividad actual (la primera sin guardar), en orden
  const ended = !!state.ended;
  const currentAct = ended ? undefined : guide.activities.find((a) => !state.activities[a.id]?.done);
  const canFinish = ended || !guide.activities.some((a) => !state.activities[a.id]?.done);
  let cur: View = view;
  if (cur.name === "activity" && (!state.prepDone || cur.id !== currentAct?.id)) cur = { name: "home" };
  if ((cur.name === "summary" || cur.name === "survey") && !canFinish) cur = { name: "home" };

  let body: React.ReactNode;
  if (cur.name === "activity") {
    const idx = guide.activities.findIndex((a) => a.id === cur.id);
    const act = guide.activities[idx];
    const blockedHere = state.blocked?.activityId === act.id ? state.blocked : undefined;
    const blockedStep = blockedHere?.stepId ? act.steps.findIndex((x) => x.id === blockedHere.stepId) : -1;
    body = (
      <ActivityView
        key={act.id}
        activity={act}
        index={idx}
        total={guide.activities.length}
        state={state}
        initialStep={cur.step}
        blocked={!!blockedHere}
        blockedPanel={
          blockedHere && (
            <BlockedPanel
              key={`${blockedHere.issueId}:${blockedHere.helpId ?? ""}`}
              blocked={blockedHere}
              run={state}
              stepLabel={blockedStep >= 0 ? `${act.id} · Paso ${blockedStep + 1}` : act.id}
              beforeRequest={flush}
              onRequested={(helpId, reason, at) =>
                update((s) => ({ ...s, blocked: s.blocked && { ...s.blocked, helpId, reason, requestedAt: at } }))
              }
              onResolved={() => update((s) => ({ ...s, blocked: undefined }))}
              onEnded={(reason, at) => {
                update((s) => ({ ...s, blocked: undefined, ended: { reason, at } }));
                nav({ name: "summary" });
              }}
            />
          )
        }
        onExit={() => nav({ name: "home" })}
        onStep={(stepId, outcome) =>
          update(
            (s) => {
              const steps = { ...s.steps };
              if (outcome) steps[stepKey(act.id, stepId)] = outcome;
              else delete steps[stepKey(act.id, stepId)];
              return { ...s, steps };
            },
            [{ type: "step", payload: { activityId: act.id, stepId, outcome } }]
          )
        }
        onReport={(kind, stepId) => setReport({ kind, activityId: act.id, stepId })}
        onSave={(a) => {
          update((s) => ({ ...s, activities: { ...s.activities, [act.id]: a } }), [
            { type: "activity", payload: { activityId: act.id, result: a.result, checks: a.checks, fields: a.fields, notes: a.notes } },
          ]);
          const next = guide.activities.find((x) => !stateRef.current?.activities[x.id]?.done);
          nav(next ? { name: "activity", id: next.id, step: firstPending(stateRef.current!, next.id, next.steps.map((s) => s.id)) } : { name: "summary" });
        }}
      />
    );
  } else if (cur.name === "prep") {
    body = <Prep guide={guide} state={state} update={update} onDone={() => nav({ name: "home" })} />;
  } else if (cur.name === "summary") {
    body = <Summary guide={guide} state={state} update={update} onSurvey={() => nav({ name: "survey" })} />;
  } else if (cur.name === "survey") {
    body = (
      <Survey
        survey={guide.survey}
        initial={state.survey}
        finished={state.finished}
        onSubmit={(answers) => {
          update((s) => ({ ...s, survey: answers, finished: true }), [{ type: "survey", payload: { answers } }]);
        }}
        onBack={() => nav({ name: "summary" })}
      />
    );
  } else {
    // Inicio: lista de actividades
    const nextAct = currentAct;
    body = (
      <div className="animate-pop space-y-5">
        <section className="bg-brand-gradient rounded-3xl p-5 text-white shadow-md">
          <p className="text-sm/5 opacity-90">Hola, {state.tester.name.split(" ")[0]} 👋</p>
          <h1 className="mt-1 text-xl font-bold">{guide.title}</h1>
          <div className="mt-4 flex items-center justify-between text-sm">
            <span>
              {doneActs} de {guide.activities.length} actividades
            </span>
            <span>{Math.round((answered / totalSteps) * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/30">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${(answered / totalSteps) * 100}%` }} />
          </div>
          {failCount > 0 && <p className="mt-3 text-sm opacity-90">Has reportado {failCount} falla(s). ¡Gracias!</p>}
        </section>

        {!state.prepDone && (
          <button onClick={() => nav({ name: "prep" })} className="w-full rounded-2xl bg-amber-50 p-4 text-left ring-1 ring-amber-200">
            <div className="font-semibold text-amber-900">Empieza aquí: {guide.prep.title}</div>
            <div className="text-sm text-amber-800">Instala la app, revisa las reglas y conoce la pantalla principal.</div>
          </button>
        )}

        {ended && (
          <div className="space-y-3 rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
            <div>
              <div className="font-semibold text-rose-900">El guía terminó la prueba por un bloqueo</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-rose-800">{state.ended!.reason}</p>
            </div>
            <Button size="lg" className="w-full" onClick={() => nav({ name: "summary" })}>
              Ver resumen y contestar la encuesta →
            </Button>
          </div>
        )}

        {!ended && canFinish && (
          <Button size="lg" className="w-full" onClick={() => nav({ name: "summary" })}>
            {state.finished ? "Ver resumen y encuesta" : "¡Terminaste! Ver resumen y contestar la encuesta"} →
          </Button>
        )}

        {nextAct && state.prepDone && state.blocked?.activityId === nextAct.id && (
          <Callout>
            <strong>{nextAct.id} está en pausa</strong> por una falla que te impide seguir.{" "}
            {state.blocked.helpId ? "Ya pediste ayuda: espera al guía." : "Ábrela y pide ayuda al guía."}
          </Callout>
        )}

        {nextAct && state.prepDone && (
          <Button
            size="lg"
            className="w-full"
            onClick={() => nav({ name: "activity", id: nextAct.id, step: firstPending(state, nextAct.id, nextAct.steps.map((s) => s.id)) })}
          >
            {Object.keys(state.steps).length ? "Continuar" : "Empezar"} con {nextAct.id} →
          </Button>
        )}

        <section>
          <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Actividades</h2>
          <p className="mb-2 px-1 text-xs text-slate-500">Se hacen en orden. Las que ya guardaste quedan cerradas y no se pueden cambiar.</p>
          <ul className="space-y-2">
            {guide.activities.map((a) => {
              const st = state.activities[a.id];
              const n = a.steps.filter((s) => state.steps[stepKey(a.id, s.id)]).length;
              const fails = a.steps.filter((s) => state.steps[stepKey(a.id, s.id)] === "fail").length;
              const badge = st?.done && st.result
                ? { ok: "bg-emerald-100 text-emerald-800", issue: "bg-amber-100 text-amber-800", blocked: "bg-rose-100 text-rose-800", skipped: "bg-slate-200 text-slate-700" }[st.result]
                : n > 0
                  ? "bg-brand-100 text-brand-700"
                  : "bg-slate-100 text-slate-500";
              const isCurrent = a.id === currentAct?.id;
              const open = isCurrent && state.prepDone;
              const isBlocked = isCurrent && state.blocked?.activityId === a.id;
              const label = st?.done && st.result
                ? ACTIVITY_RESULTS[st.result]
                : isBlocked
                  ? "En pausa"
                  : n > 0
                    ? `${n}/${a.steps.length} pasos`
                    : ended
                      ? "No realizada"
                      : "Pendiente";
              const inner = (
                <>
                  <span className="mt-0.5 w-10 shrink-0 text-sm font-bold text-teal-brand">{a.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug">{a.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        <Rich text={a.when} />
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isBlocked ? "bg-rose-100 text-rose-800" : badge}`}>{label}</span>
                      {fails > 0 && <span className="text-xs text-rose-600">{fails} ✗</span>}
                      {!open && (
                        <span className="text-xs text-slate-400" aria-label={st?.done ? "Completada, cerrada" : "Bloqueada"}>
                          🔒 {st?.done ? "Completada" : ""}
                        </span>
                      )}
                    </span>
                </>
              );
              return (
                <li key={a.id} data-activity={a.id} data-locked={open ? "false" : "true"}>
                  {open ? (
                    <button
                      onClick={() => nav({ name: "activity", id: a.id, step: firstPending(state, a.id, a.steps.map((s) => s.id)) })}
                      className="flex w-full items-start gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-2 ring-brand-500 active:scale-[0.99]"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div
                      aria-disabled="true"
                      className={`flex w-full cursor-not-allowed items-start gap-3 rounded-2xl p-4 text-left ring-1 ring-slate-200 ${
                        st?.done ? "bg-white/70" : "bg-slate-50 opacity-60"
                      }`}
                    >
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <div className={`grid gap-2 ${canFinish ? "grid-cols-2" : "grid-cols-1"}`}>
          <Button variant="outline" onClick={() => nav({ name: "prep" })}>
            {guide.prep.title}
          </Button>
          {canFinish && (
            <Button variant="outline" onClick={() => nav({ name: "summary" })}>
              Resumen y encuesta
            </Button>
          )}
        </div>
        <p className="pb-6 text-center text-xs text-slate-400">
          Tu avance se guarda en este navegador. Versión de la guía {guide.version}.
        </p>
      </div>
    );
  }

  const reportActivity = report && guide.activities.find((a) => a.id === report.activityId);
  return (
    <>
      {topbar}
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-3">{body}</main>
      <ReferenceSheet guide={guide} open={showRef} onClose={() => setShowRef(false)} />
      <ReportSheet
        open={!!report}
        kind={report?.kind ?? "issue"}
        onClose={() => setReport(null)}
        maxUploadMb={maxUploadMb}
        context={reportActivity ? `${reportActivity.id} · ${reportActivity.title}${report?.stepId ? ` · Paso ${report.stepId}` : ""}` : ""}
        onSubmit={submitReport}
      />
    </>
  );
}

function firstPending(state: RunState, activityId: string, stepIds: string[]) {
  // Si la actividad está en pausa por una falla, se vuelve al paso donde se detuvo
  const blockedAt = state.blocked?.activityId === activityId && state.blocked.stepId ? stepIds.indexOf(state.blocked.stepId) : -1;
  if (blockedAt >= 0) return blockedAt;
  const i = stepIds.findIndex((id) => !state.steps[stepKey(activityId, id)]);
  return i === -1 ? stepIds.length : i;
}

/* ---------- Identificación del tester ---------- */
function Identify({
  guide,
  variant,
  onSwitchVariant,
  onDone,
}: {
  guide: Guide;
  variant?: GuideVariant;
  onSwitchVariant?: () => void;
  onDone: (s: RunState) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(guide.role);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    name.trim().length > 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    guide.tester.fields.every((f) => !f.required || (fields[f.id] ?? "").trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const device = { ...(await detectDevice()), ...(variant ? { guideVariant: variant } : {}) };
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guideId: guide.id, name, email, role, fields, device }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      onDone({
        v: 1,
        guideVersion: guide.version,
        runId: data.runId,
        token: data.token,
        tester: { name: name.trim(), email: email.trim(), role, fields },
        prep: {},
        prepDone: false,
        steps: {},
        activities: {},
        issues: [],
        finish: {},
        survey: {},
        finished: false,
        outbox: [],
      });
    } catch (err) {
      setError(err instanceof Error && err.message !== "Error" ? err.message : "No pudimos registrarte. Revisa tu conexión e inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="animate-pop mx-auto w-full max-w-xl flex-1 px-4 py-6">
      <Link href="/" className="text-sm text-brand-600">
        ← Guías
      </Link>
      <div className="mt-3 flex items-center gap-3">
        <Image src="/logo.png" alt="AppHouse" width={64} height={46} />
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-teal-brand">{guide.role}</div>
          <h1 className="text-xl font-bold leading-tight">{guide.title}</h1>
        </div>
      </div>
      {onSwitchVariant && (
        <button type="button" onClick={onSwitchVariant} className="mt-3 text-sm font-medium text-brand-600 underline" data-testid="switch-variant">
          {variant === "mobile" ? "¿Estás en computadora? Ver guía de escritorio" : "¿Estás en celular? Ver guía para celular"}
        </button>
      )}
      <p className="mt-4 text-slate-600">{guide.summary}</p>
      {guide.notice && (
        <div className="mt-3">
          <Callout tone="info">{guide.notice}</Callout>
        </div>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">¿Quién hace la prueba?</h2>
        <label className="block">
          <span className="mb-1 block text-sm">Nombre y apellido *</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">Correo *</span>
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm">Rol en la prueba</span>
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>
            {Array.from(new Set([guide.role, ...TESTER_ROLES])).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        {guide.tester.fields.map((f) => (
          <label key={f.id} className="block">
            <span className="mb-1 block text-sm">
              {f.label}
              {f.required ? " *" : ""}
            </span>
            <input
              className={inputCls}
              type={f.type === "email" ? "email" : "text"}
              placeholder={f.placeholder}
              value={fields[f.id] ?? ""}
              onChange={(e) => setFields({ ...fields, [f.id]: e.target.value })}
            />
          </label>
        ))}
        <p className="text-xs text-slate-500">Tu navegador, sistema y tamaño de pantalla se registran automáticamente.</p>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <Button size="lg" className="w-full" disabled={!valid || busy}>
          {busy ? "Registrando…" : "Comenzar"}
        </Button>
      </form>
    </main>
  );
}

/* ---------- Antes de empezar ---------- */
function Prep({
  guide,
  state,
  update,
  onDone,
}: {
  guide: Guide;
  state: RunState;
  update: ReturnType<typeof useRun>["update"];
  onDone: () => void;
}) {
  const p = guide.prep;
  const allChecked = p.checklist.every((c) => state.prep[c.id]);
  return (
    <div className="animate-pop space-y-5 pb-8">
      <h1 className="text-2xl font-bold">{p.title}</h1>
      {p.sections.map((s) => (
        <section key={s.title} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 font-semibold">{s.title}</h2>
          <ul className="space-y-2 text-sm text-slate-700">
            {s.items.map((it, i) => (
              <li key={i}>
                <Rich text={it} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-2 font-semibold">Confirma</h2>
        <ul className="space-y-2">
          {p.checklist.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 accent-[#2f5da8]"
                  checked={!!state.prep[c.id]}
                  onChange={(e) => {
                    const prep = { ...state.prep, [c.id]: e.target.checked };
                    update((s) => ({ ...s, prep }), [{ type: "run", payload: { prep } }]);
                  }}
                />
                <span>{c.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-2 font-semibold">Reglas</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {p.rules.map((r, i) => (
            <li key={i}>
              <Rich text={r} />
            </li>
          ))}
        </ol>
        {guide.glossary && (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <Rich text={guide.glossary} />
          </p>
        )}
      </section>
      {p.tour && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 font-semibold">{p.tour.title}</h2>
          <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
            {p.tour.items.map((r, i) => (
              <li key={i}>
                <Rich text={r} />
              </li>
            ))}
          </ol>
          {p.tour.image && <StepImage src={p.tour.image} caption={p.tour.caption} />}
        </section>
      )}
      <Button
        size="lg"
        className="w-full"
        disabled={!allChecked}
        onClick={() => {
          update((s) => ({ ...s, prepDone: true }));
          onDone();
        }}
      >
        {allChecked ? "Listo, ir a las actividades" : "Marca las casillas para continuar"}
      </Button>
    </div>
  );
}

/* ---------- Resumen final ---------- */
function Summary({
  guide,
  state,
  update,
  onSurvey,
}: {
  guide: Guide;
  state: RunState;
  update: ReturnType<typeof useRun>["update"];
  onSurvey: () => void;
}) {
  const pending = guide.activities.filter((a) => !state.activities[a.id]?.done);
  const issues = state.issues.filter((i) => i.kind === "issue");
  return (
    <div className="animate-pop space-y-5 pb-8">
      <h1 className="text-2xl font-bold">Resumen de tu prueba</h1>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat n={guide.activities.length - pending.length} label="Actividades listas" />
        <Stat n={Object.values(state.steps).filter((o) => o === "ok").length} label="Pasos logrados" />
        <Stat n={issues.length} label="Fallas reportadas" tone={issues.length ? "warn" : undefined} />
      </div>
      {state.ended && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
          <strong>El guía terminó la prueba por un bloqueo.</strong>
          <p className="mt-1 whitespace-pre-wrap">{state.ended.reason}</p>
          {pending.length > 0 && <p className="mt-1 text-xs">No se realizaron: {pending.map((a) => a.id).join(", ")}.</p>}
        </div>
      )}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {guide.activities.map((a) => {
          const st = state.activities[a.id] ?? emptyActivity();
          const ok = a.steps.filter((s) => state.steps[stepKey(a.id, s.id)] === "ok").length;
          const fail = a.steps.filter((s) => state.steps[stepKey(a.id, s.id)] === "fail").length;
          const nIssues = state.issues.filter((i) => i.activityId === a.id && i.kind === "issue").length;
          return (
            <li key={a.id}>
              <div className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm">
                <span className="w-9 font-bold text-teal-brand">{a.id}</span>
                <span className="flex-1">
                  <span className="block font-medium">{st.done && st.result ? ACTIVITY_RESULTS[st.result] : state.ended ? "No realizada" : "Pendiente"}</span>
                  <span className="text-xs text-slate-500">
                    ✓ {ok} · ✗ {fail} de {a.steps.length} pasos{nIssues ? ` · ${nIssues} reporte(s)` : ""}
                  </span>
                </span>
                <span className="text-slate-400" aria-label="Cerrada">🔒</span>
              </div>
            </li>
          );
        })}
      </ul>
      {issues.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Tus reportes</h2>
          <ul className="space-y-2">
            {issues.map((i) => (
              <li key={i.id} className="rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200">
                <div className="text-xs font-semibold text-rose-700">
                  {i.activityId}
                  {i.stepId ? ` · paso ${i.stepId}` : ""} {i.blocking ? "· impide seguir" : ""}
                </div>
                <p className="mt-0.5">{i.description}</p>
                {i.attachments.length > 0 && <p className="mt-1 text-xs text-slate-500">📎 {i.attachments.length} archivo(s)</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {guide.finish.checklist.length > 0 && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 font-semibold">Al terminar</h2>
          {guide.finish.checklist.map((c) => (
            <label key={c.id} className="mb-2 flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-[#2f5da8]"
                checked={!!state.finish[c.id]}
                onChange={(e) => {
                  const finish = { ...state.finish, [c.id]: e.target.checked };
                  update((s) => ({ ...s, finish }), [{ type: "run", payload: { finish } }]);
                }}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </section>
      )}
      <Button size="lg" className="w-full" onClick={onSurvey}>
        {state.finished ? "Ver mi encuesta" : "Contestar la encuesta final"} →
      </Button>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "warn" }) {
  return (
    <div className={`rounded-2xl p-3 shadow-sm ring-1 ${tone ? "bg-amber-50 ring-amber-200" : "bg-white ring-slate-200"}`}>
      <div className="text-2xl font-bold">{n}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

/* ---------- Hoja de datos / ayuda ---------- */
function ReferenceSheet({ guide, open, onClose }: { guide: Guide; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"data" | "help">("data");
  return (
    <Sheet open={open} onClose={onClose} title={tab === "data" ? guide.reference.title : "Qué hacer si…"}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {[
          ["data", "Datos"],
          ["help", "Qué hacer si…"],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as "data" | "help")} className={`rounded-lg py-2 font-medium ${tab === k ? "bg-white shadow-sm" : "text-slate-600"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "data" ? (
        <div className="space-y-5">
          {guide.reference.intro && <Callout tone="info">{guide.reference.intro}</Callout>}
          {guide.reference.tables.map((t) => (
            <section key={t.title}>
              <h3 className="mb-2 font-semibold">{t.title}</h3>
              <div className="space-y-2">
                {t.rows.map((r, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 p-3 text-sm">
                    <div className="font-semibold">
                      <Rich text={r[0]} />
                    </div>
                    {r.slice(1).map((c, j) => (
                      <div key={j} className="mt-0.5 text-slate-700">
                        {t.columns.length > 2 && <span className="text-xs text-slate-500">{t.columns[j + 1]}: </span>}
                        <Rich text={c} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {t.note && <p className="mt-2 text-xs text-slate-500">{t.note}</p>}
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {guide.troubleshooting.map(([q, a], i) => (
            <li key={i} className="rounded-xl bg-slate-50 p-3 text-sm">
              <p>
                <Rich text={q} />
              </p>
              <p className="mt-1 text-slate-600">
                → <Rich text={a} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
