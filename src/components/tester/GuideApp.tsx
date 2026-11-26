"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Guide } from "@/lib/types";
import { ACTIVITY_RESULTS, type GuideVariant } from "@/lib/types";
import { confirm, Coachmark, toast } from "@/components/feedback";
import { Confetti, CountUp, motion, Sparkles, staggerItem, staggerList, TickBadge, useReducedMotion } from "@/components/motion";
import ActivityView from "./ActivityView";
import BlockedPanel from "./BlockedPanel";
import ReportSheet, { type ReportDraft } from "./ReportSheet";
import Survey from "./Survey";
import { Button, Callout, FormField, ProgressBar, Rich, Sheet, StepImage } from "./ui";
import { callRun, detectDevice, emptyActivity, reportRound, stepKey, uid, useRun, type Blocked, type Issue, type RunState } from "./store";
import { focusFirstError, LIMITS, trimAll, validateEmail, validateFields, validateName, type Errors } from "./validation";

/** Datos del formulario de identificación que se conservan al cambiar de variante. */
export type IdentifyDraft = { name: string; email: string; role: string; fields: Record<string, string> };

/** Control de la variante (computadora o celular) de una guía con `mobileGuideId`. */
export type VariantCtl = {
  variant: GuideVariant;
  /** Lo que se detectó por el dispositivo. */
  detected: GuideVariant;
  /** ¿Ya hay una prueba empezada en este navegador con la otra variante? */
  otherHasRun: boolean;
  /** Cambia de variante; `carry` lleva los datos del tester a la otra (si todavía no empezó). */
  choose: (next: GuideVariant, carry?: IdentifyDraft) => void;
  draft: IdentifyDraft | null;
  setDraft: (d: IdentifyDraft) => void;
  /** Se llegó aquí desde una prueba ya empezada con la otra variante. */
  carriedFrom: GuideVariant | null;
};

export const VARIANTS: Record<GuideVariant, { icon: string; short: string; long: string; sub: string; of: string; for: string }> = {
  desktop: { icon: "💻", short: "Computadora", long: "En la computadora", sub: "panel web", of: "de la computadora", for: "para computadora" },
  mobile: { icon: "📱", short: "Celular", long: "En el celular", sub: "app", of: "del celular", for: "para celular" },
};

type View = { name: "home" } | { name: "prep" } | { name: "activity"; id: string; step: number } | { name: "summary" } | { name: "survey" };

type HelpStatus = {
  status: string;
  endedReason: string;
  endedAt: string | null;
  open: { id: string; activityId: string; stepId?: string; issueId?: string; reason: string; createdAt: string } | null;
};

export default function GuideApp({
  guide,
  roundId,
  maxUploadMb,
  allowedMime = [],
  variantCtl,
}: {
  guide: Guide;
  /** Ronda (encuesta) activa en el servidor. */
  roundId: number;
  maxUploadMb: number;
  /** Tipos de archivo que acepta el servidor (src/lib/http.ts). */
  allowedMime?: string[];
  /** Solo en guías con variante de computadora y de celular. */
  variantCtl?: VariantCtl;
}) {
  const { state, loaded, syncing, syncError, commit, update, flush, stateRef, restart, roundClosed, dismissRoundClosed } = useRun(guide.id, roundId);
  // «Empezar otra prueba» pide confirmación en la misma pantalla (sin ventanas del navegador)
  const [restartAsk, setRestartAsk] = useState(false);
  const [view, setView] = useState<View>({ name: "home" });
  const [showRef, setShowRef] = useState(false);
  // Parte de la actividad desde la que se abrió «Datos» (E04: A, B, C o D)
  const [refPart, setRefPart] = useState<string | undefined>();
  const reduce = useReducedMotion();
  // Actividad recién guardada (festejo) y actividad recién desbloqueada (destello)
  const [saved, setSaved] = useState<{ id: string; next?: string; n: number } | null>(null);
  // Actividades recién abiertas (destello); se limpia cuando el destello termina
  const [fresh, setFreshState] = useState<string[]>([]);
  const setFresh = (v: string | string[] | null) => setFreshState(v === null ? [] : Array.isArray(v) ? v : [v]);
  // Alto de la barra superior en una variable CSS (los encabezados fijos de cada vista van debajo)
  const topbarRef = useRef<HTMLElement>(null);
  const hasRun = !!state;
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--topbar-h");
    };
  }, [hasRun, loaded]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 900);
    return () => clearTimeout(t);
  }, [saved]);
  const [report, setReport] = useState<{ kind: "issue" | "evidence"; activityId: string; stepId?: string; markFail?: boolean; choices?: string[] } | null>(null);
  // El admin abrió una encuesta nueva con la prueba abierta: se cerró y el tester vuelve al registro
  useEffect(() => {
    if (!roundClosed) return;
    window.scrollTo({ top: 0 });
    toast.info(ROUND_CLOSED_MSG, { id: "round-closed", title: "Nueva encuesta" });
  }, [roundClosed]);

  // Guía de escritorio: en pantallas ≥1024 px (lg) usa barra lateral y vistas anchas
  const desktop = guide.layout === "desktop";
  const dk = (c: string) => (desktop ? " " + c : "");

  const nav = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  const submitReport = useCallback(
    async (draft: ReportDraft, files: File[]): Promise<string | null> => {
      if (!report) return null;
      // Con varios pasos en la pantalla, el paso lo elige el tester en el formulario
      const stepId = report.choices ? draft.stepId : report.stepId;
      const { stepId: _picked, ...fields } = draft;
      void _picked;
      const issue: Issue = {
        id: uid(),
        activityId: report.activityId,
        stepId,
        ...fields,
        attachments: [],
        createdAt: new Date().toISOString(),
      };
      // Una falla que impide seguir detiene la actividad hasta que el guía ayude
      const block: Blocked | undefined =
        issue.kind === "issue" && issue.blocking
          ? { activityId: issue.activityId, stepId: issue.stepId, issueId: issue.id, reason: issue.description }
          : undefined;
      // «No pude»: el paso queda como fallido solo al enviar el reporte (si se cierra sin enviar, no se marca)
      const markFail = report.markFail && issue.kind === "issue" && stepId;
      const stepEvents = markFail ? [{ type: "step", payload: stepPayload(stateRef.current, report.activityId, stepId!, "fail") }] : [];
      update(
        (s) => ({
          ...s,
          steps: markFail ? { ...s.steps, [stepKey(report.activityId, stepId!)]: "fail" } : s.steps,
          issues: [...s.issues, issue],
          blocked: s.blocked ?? block,
        }),
        [...stepEvents, { type: "issue", payload: { ...issue } }]
      );
      // Lleva al tester al panel de pausa (arriba de la actividad)
      if (block) setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
      const done = () =>
        toast.success(
          issue.kind === "evidence" ? "La captura quedó guardada en tu reporte." : block ? "La actividad quedó en pausa: pide ayuda al guía." : "Gracias, el equipo lo revisará.",
          { title: issue.kind === "evidence" ? "Captura guardada ✓" : "Reporte enviado ✓" }
        );
      if (files.length === 0) {
        done();
        return null;
      }
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
        reportRound(s.runId, att);
        update((st) => ({
          ...st,
          issues: st.issues.map((i) => (i.id === issue.id ? { ...i, attachments: [...i.attachments, { id: att.id, name: f.name, size: att.size }] } : i)),
        }));
      }
      done();
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

  if (!loaded) return <div className="flex flex-1 items-center justify-center text-slate-600">Cargando…</div>;
  if (!state || state.guideVersion === undefined)
    return (
      <Identify
        guide={guide}
        desktop={desktop}
        variantCtl={variantCtl}
        notice={roundClosed ? ROUND_CLOSED_MSG : undefined}
        onDone={(s) => {
          // La prueba nueva empieza en el inicio (la anterior pudo cerrarse a media actividad)
          dismissRoundClosed();
          setView({ name: "home" });
          setReport(null);
          setShowRef(false);
          commit(s);
        }}
      />
    );

  const doneActs = guide.activities.filter((a) => state.activities[a.id]?.done).length;
  // Una sola medida de avance (actividades guardadas) y el tiempo que falta, según los minutos de cada actividad
  const minsLeft = guide.activities.filter((a) => !state.activities[a.id]?.done).reduce((n, a) => n + (a.estMin ?? 0), 0);
  const failCount = state.issues.filter((i) => i.kind === "issue").length;

  const topbar = (
    <header ref={topbarRef} className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      {/* En celular la barra es compacta (una línea, ~44 px) para dejar más espacio a la actividad */}
      <div className={"mx-auto flex max-w-xl items-center gap-2 px-3 py-1" + dk("lg:max-w-[1440px] lg:gap-3 lg:px-8 lg:py-2.5")}>
        <button onClick={() => nav({ name: "home" })} className={"flex min-h-9 min-w-0 items-center gap-1.5" + dk("lg:min-h-11 lg:gap-2")} aria-label="Inicio de la guía">
          <Image src="/logo.png" alt="" width={36} height={26} className={"h-5 w-auto shrink-0" + dk("lg:h-[26px]")} />
          <span className={"min-w-0 truncate text-left text-xs font-semibold leading-tight" + dk("lg:text-sm")}>
            {guide.role}
            <span className={"font-normal text-slate-600" + dk("lg:hidden")}> · {state.tester.name.split(" ")[0]}</span>
            {desktop && <span className="hidden truncate text-xs font-normal text-slate-600 lg:block">{state.tester.name}</span>}
          </span>
        </button>
        {desktop && (
          <span className="ml-4 hidden min-w-0 truncate border-l border-slate-200 pl-4 text-sm text-slate-600 lg:inline">{guide.title}</span>
        )}
        <span
          className={`ml-auto shrink-0 text-[11px] sm:text-xs ${syncError ? "font-medium text-amber-700" : "text-slate-600"}`}
          title={syncError ? "Sin conexión: se enviará al volver el internet" : "Guardado"}
          role="status"
        >
          {syncing ? "Guardando…" : syncError || state.outbox.length ? `● ${state.outbox.length} sin enviar` : "✓ Guardado"}
        </span>
        <Button variant="outline" onClick={() => { setRefPart(undefined); setShowRef(true); }} className="shrink-0 !min-h-9 !rounded-lg !px-2.5 !py-1 !text-sm lg:!min-h-10 lg:!rounded-xl lg:!px-3 lg:!py-1.5">
          <span>
            <span aria-hidden="true">📊 </span>Datos
            {desktop && <span className="hidden lg:inline"> de la prueba</span>}
          </span>
        </Button>
      </div>
    </header>
  );

  const ended = !!state.ended;
  const acc = access(guide, state);
  const { currentAct, canFinish, flexible, seqDone, isOpen } = acc;
  let cur: View = view;
  if (cur.name === "activity" && !isOpen(cur.id)) cur = { name: "home" };
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
        desktop={desktop}
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
              onRequested={(helpId, reason, at) => {
                update((s) => ({ ...s, blocked: s.blocked && { ...s.blocked, helpId, reason, requestedAt: at } }));
                toast.success("El guía ya ve tu solicitud.", { title: "Ayuda pedida ✓" });
              }}
              onResolved={() => {
                update((s) => ({ ...s, blocked: undefined }));
                toast.success("Puedes continuar con la actividad.", { title: "Resuelto ✓" });
              }}
              onEnded={(reason, at) => {
                update((s) => ({ ...s, blocked: undefined, ended: { reason, at } }));
                nav({ name: "summary" });
              }}
            />
          )
        }
        onExit={() => nav({ name: "home" })}
        dataLabel={guide.reference.title}
        onOpenData={(part) => {
          setRefPart(part);
          setShowRef(true);
        }}
        onStep={(stepId, outcome) =>
          update(
            (s) => {
              const steps = { ...s.steps };
              if (outcome) steps[stepKey(act.id, stepId)] = outcome;
              else delete steps[stepKey(act.id, stepId)];
              return { ...s, steps };
            },
            [{ type: "step", payload: stepPayload(stateRef.current, act.id, stepId, outcome) }]
          )
        }
        onCheckpoint={(stepId, ticks) => {
          const k = stepKey(act.id, stepId);
          update((s) => ({ ...s, checkpoints: { ...s.checkpoints, [k]: ticks } }));
          // Si el paso ya tenía resultado, se reenvía con las casillas actualizadas
          const outcome = stateRef.current?.steps[k];
          if (outcome) update((s) => s, [{ type: "step", payload: stepPayload(stateRef.current, act.id, stepId, outcome) }]);
        }}
        onDraft={(a) => update((s) => (s.activities[act.id]?.done ? s : { ...s, activities: { ...s.activities, [act.id]: { ...a, done: false } } }))}
        reopened={!!state.activities[act.id]?.done}
        onReport={(kind, stepId, markFail, choices) => setReport({ kind, activityId: act.id, stepId, markFail, choices })}
        onSave={(a) => {
          const wasDone = !!stateRef.current?.activities[act.id]?.done;
          update((s) => ({ ...s, activities: { ...s.activities, [act.id]: a } }), [
            { type: "activity", payload: { activityId: act.id, result: a.result, checks: a.checks, fields: a.fields, notes: a.notes } },
          ]);
          setSaved((p) => ({ id: act.id, n: (p?.n ?? 0) + 1 }));
          const after = access(guide, stateRef.current!);
          const next = guide.activities.find((x) => !stateRef.current?.activities[x.id]?.done);
          if (wasDone) {
            toast.success("Puedes corregirla otra vez hasta que envíes la encuesta final.", { title: `Cambios en ${act.id} guardados ✓` });
            nav({ name: "home" });
          } else if (flexible && after.seqDone && !seqDone) {
            // Se terminó la parte en orden: se abren todas las demás a la vez
            const opened = guide.activities.filter((x) => !stateRef.current?.activities[x.id]?.done).map((x) => x.id);
            setFresh(opened);
            toast.success(opened.length ? `Ya puedes abrir ${opened[0]} a ${opened[opened.length - 1]} cuando te toque.` : "Ya puedes contestar la encuesta.", {
              title: `Actividad ${act.id} guardada ✓`,
            });
            nav({ name: "home" });
          } else if (flexible && after.seqDone) {
            toast.success(next ? `Sigue con la que te toque. Puedes corregir ${act.id} hasta que envíes la encuesta final.` : "Ya puedes contestar la encuesta y terminar.", {
              title: `Actividad ${act.id} guardada ✓`,
            });
            nav({ name: "home" });
          } else {
            toast.success(next ? `🔓 Se desbloqueó ${next.id}: ${next.title}` : "Terminaste todas las actividades. Falta la encuesta final.", {
              title: `Actividad ${act.id} guardada ✓`,
            });
            if (next) setFresh(next.id);
            nav(next ? { name: "activity", id: next.id, step: firstPending(stateRef.current!, next.id, next.steps.map((s) => s.id)) } : { name: "summary" });
          }
        }}
      />
    );
  } else if (cur.name === "prep") {
    body = (
      <Prep
        guide={guide}
        state={state}
        update={update}
        desktop={desktop}
        onDone={() => {
          if (!state.prepDone && guide.activities[0]) setFresh(guide.activities[0].id);
          nav({ name: "home" });
        }}
      />
    );
  } else if (cur.name === "summary") {
    body = <Summary guide={guide} state={state} update={update} desktop={desktop} onSurvey={() => nav({ name: "survey" })} />;
  } else if (cur.name === "survey") {
    body = (
      <div className={dk("lg:max-w-3xl")}>
      <Survey
        survey={guide.survey}
        initial={state.survey}
        finished={state.finished}
        onDraft={(answers) => update((s) => ({ ...s, survey: answers }))}
        onDraftSync={(answers) => update((s) => s, [{ type: "surveyDraft", payload: { answers } }])}
        submitLabel={flexible && !state.finished && !ended ? "Enviar encuesta y terminar" : "Enviar encuesta"}
        beforeSubmit={async () => {
          if (!flexible || state.finished || ended) return true;
          const pending = guide.activities.filter((a) => !state.activities[a.id]?.done).map((a) => a.id);
          return confirm({
            title: "¿Terminar la prueba?",
            message: pending.length
              ? `Te faltan ${pending.length === 1 ? "1 actividad" : `${pending.length} actividades`} (${pending.join(", ")}). Al terminar ya no podrás abrir ni corregir actividades.`
              : "Al terminar ya no podrás abrir ni corregir tus actividades.",
            confirmLabel: "Sí, terminar",
            cancelLabel: "Todavía no",
            tone: pending.length ? "danger" : "default",
          });
        }}
        onSubmit={async (answers) => {
          // La casilla «Contesté la encuesta…» del cierre se marca sola al enviarla
          const cur = stateRef.current;
          const markSurvey = guide.finish.checklist.some((c) => c.id === SURVEY_DONE_ID) && !cur?.finish[SURVEY_DONE_ID];
          const finish = markSurvey && cur ? { ...cur.finish, [SURVEY_DONE_ID]: true } : undefined;
          update((s) => ({ ...s, survey: answers, finished: true, ...(finish ? { finish } : {}) }), [
            { type: "survey", payload: { answers } },
            ...(finish ? [{ type: "run", payload: { finish } }] : []),
          ]);
          // Se espera el envío real (máx. 20 s); si no llega, la encuesta avisa que falta internet
          return flushWithin(flush, 20000);
        }}
        pendingSend={state.finished && state.outbox.length > 0}
        onRetry={() => flushWithin(flush, 20000)}
        deviceLabel={desktop ? "esta computadora" : "este teléfono"}
        wide={desktop}
        onBack={() => nav({ name: "summary" })}
      />
      </div>
    );
  } else {
    // Inicio: lista de actividades
    const nextAct = currentAct;
    body = (
      <div className={"animate-pop space-y-5" + dk("lg:max-w-5xl lg:space-y-6")}>
        <section className={"bg-brand-gradient rounded-3xl p-5 text-white shadow-md" + dk("lg:p-8")}>
          <p className="text-sm/5 opacity-90">Hola, {state.tester.name.split(" ")[0]} 👋</p>
          <h1 className={"mt-1 text-xl font-bold" + dk("lg:text-3xl")}>{guide.title}</h1>
          {desktop && <p className="mt-1 hidden max-w-2xl text-sm opacity-90 lg:block">{guide.subtitle}</p>}
          <div className="mt-4 flex items-center justify-between text-sm">
            <span>
              {doneActs} de {guide.activities.length} actividades
            </span>
            <span className="font-semibold" data-testid="time-left">{minsLeft > 0 ? `Faltan unos ${minsLeft} min` : "¡Todas guardadas!"}</span>
          </div>
          <ProgressBar value={doneActs / guide.activities.length} className="mt-1.5" trackClassName="bg-white/30" barClassName="bg-white" />
          {failCount > 0 && <p className="mt-3 text-sm opacity-90">Has reportado {failCount} falla(s). ¡Gracias!</p>}
        </section>

        {!state.prepDone && (
          <motion.button
            whileHover={reduce ? undefined : { y: -2 }}
            whileTap={reduce ? { opacity: 0.85 } : { scale: 0.97 }}
            onClick={() => nav({ name: "prep" })}
            className={"attn attn-amber flex w-full items-center gap-3 rounded-2xl bg-amber-50 p-4 text-left ring-2 ring-amber-300 transition hover:bg-amber-100/70" + dk("lg:p-5")}
          >
            <span className="text-2xl" aria-hidden="true">
              📋
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-amber-950">Empieza aquí: {guide.prep.title}</span>
              <span className="block text-sm text-amber-900">
                {desktop ? "Revisa tus datos de acceso, el horario del día y las reglas." : "Instala la app, revisa las reglas y conoce la pantalla principal."}
              </span>
            </span>
            <motion.span
              className="text-xl text-amber-800"
              aria-hidden="true"
              animate={reduce ? { opacity: [1, 0.4, 1] } : { x: [0, 6, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              →
            </motion.span>
          </motion.button>
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
            {state.finished
              ? "Ver resumen y encuesta"
              : flexible && guide.activities.some((a) => !state.activities[a.id]?.done)
                ? "Contestar la encuesta y terminar"
                : "¡Terminaste! Ver resumen y contestar la encuesta"}{" "}
            →
          </Button>
        )}

        {!ended && !canFinish && !state.finished && flexible && seqDone && (() => {
          const pendingIds = guide.activities.filter((a) => !state.activities[a.id]?.done).map((a) => a.id);
          return (
            <div className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700 ring-1 ring-brand-100" data-testid="survey-locked-hint">
              <p className="font-semibold">¿Y la encuesta final?</p>
              <p className="mt-1">
                Se abre cuando todas las actividades tengan su resultado guardado. Te {pendingIds.length === 1 ? "falta" : "faltan"}:{" "}
                <strong>{pendingIds.join(", ")}</strong>.
              </p>
              <p className="mt-1">
                Cuando Mesa de control dé por terminada la prueba, marca las que no te tocaron como <strong>«No me tocó»</strong> con este botón y
                se abre la encuesta.
              </p>
              <Button
                variant="outline"
                className="mt-3 w-full sm:w-auto"
                data-testid="skip-pending"
                onClick={async () => {
                  const ok = await confirm({
                    title: `¿Marcar ${pendingIds.join(", ")} como «No me tocó»?`,
                    message:
                      "Hazlo solo cuando Mesa de control haya terminado la prueba. Lo que no alcanzaste a hacer queda como «No me tocó» y no cuenta en tu contra. Puedes abrir y corregir cualquiera hasta que envíes la encuesta final.",
                    confirmLabel: "Sí, marcar",
                    cancelLabel: "Todavía no",
                  });
                  if (!ok) return;
                  const ids = [...pendingIds];
                  update(
                    (s) => {
                      const activities = { ...s.activities };
                      for (const id of ids)
                        activities[id] = { result: "skipped", checks: {}, fields: {}, notes: activities[id]?.notes ?? "", done: true };
                      return { ...s, activities };
                    },
                    ids.map((id) => ({
                      type: "activity",
                      payload: { activityId: id, result: "skipped", checks: {}, fields: {}, notes: state.activities[id]?.notes ?? "" },
                    }))
                  );
                  toast.success("Ya puedes contestar la encuesta final.", { title: `${ids.length === 1 ? "1 actividad marcada" : `${ids.length} actividades marcadas`} como «No me tocó»` });
                }}
              >
                Marcar las pendientes como «No me tocó»
              </Button>
            </div>
          );
        })()}

        {nextAct && state.prepDone && state.blocked?.activityId === nextAct.id && (
          <Callout>
            <strong>{nextAct.id} está en pausa</strong> por una falla que te impide seguir.{" "}
            {state.blocked.helpId ? "Ya pediste ayuda: espera al guía." : "Ábrela y pide ayuda al guía."}{" "}
            Si no se puede resolver, el guía puede terminar la prueba y entonces se abre la encuesta final.
          </Callout>
        )}

        {nextAct && state.prepDone && (
          <Button
            size="lg"
            pulse={state.blocked?.activityId !== nextAct.id}
            className={"w-full" + dk("lg:w-auto lg:min-w-80")}
            onClick={() => nav({ name: "activity", id: nextAct.id, step: firstPending(state, nextAct.id, nextAct.steps.map((s) => s.id)) })}
          >
            {Object.keys(state.steps).length ? "Continuar" : "Empezar"} con {nextAct.id} →
          </Button>
        )}

        <section>
          <Coachmark
            id="tester-candados"
            when={state.prepDone && !ended && !state.finished}
            title={flexible ? "Las primeras van en orden" : "Las actividades van en orden"}
            message={
              flexible
                ? `Haz en orden hasta ${guide.sequentialUntil}. Después se abren todas y eliges la que te toque. 🔒 = todavía no toca · ✓ = ya la guardaste.`
                : "Solo se abre la actividad que sigue. 🔒 = todavía no toca · ✓ = ya la guardaste."
            }
          >
            <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-slate-600">Actividades</h2>
          </Coachmark>
          <p className="mb-2 px-1 text-xs text-slate-600">
            {state.finished || ended
              ? "La prueba terminó: tus actividades quedaron cerradas."
              : flexible
                ? `Las primeras actividades van en orden. Desde ${acc.firstFlexId ?? "la siguiente"} puedes abrirlas cuando te toque, y puedes corregir cualquiera hasta que envíes la encuesta final.`
                : "Se hacen en orden. Las que ya guardaste quedan cerradas y no se pueden cambiar."}
          </p>
          <motion.ul {...staggerList()} className={"space-y-2" + dk("lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0")}>
            {guide.activities.map((a) => {
              const st = state.activities[a.id];
              const n = a.steps.filter((s) => state.steps[stepKey(a.id, s.id)]).length;
              const fails = a.steps.filter((s) => state.steps[stepKey(a.id, s.id)] === "fail").length;
              const badge = st?.done && st.result
                ? { ok: "bg-emerald-100 text-emerald-800", issue: "bg-amber-100 text-amber-800", blocked: "bg-rose-100 text-rose-800", skipped: "bg-slate-200 text-slate-700" }[st.result]
                : n > 0
                  ? "bg-brand-100 text-brand-700"
                  : "bg-slate-100 text-slate-600";
              const open = isOpen(a.id);
              const isBlocked = !st?.done && state.blocked?.activityId === a.id;
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
                  <span className="mt-0.5 w-14 shrink-0 text-sm font-bold text-teal-ink">{a.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug">{a.title}</span>
                      <span className="mt-0.5 block text-xs text-slate-600">
                        <span className="font-medium text-slate-700">Cuándo: </span>
                        <Rich text={a.when} />
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isBlocked ? "bg-rose-100 text-rose-800" : badge}`}>{label}</span>
                      {fails > 0 && <span className="text-xs text-rose-600">{fails} ✗</span>}
                      {open && st?.done && <span className="text-xs font-medium text-brand-700">✎ Corregir</span>}
                      {!open && (
                        <span className="text-xs text-slate-500" aria-label={st?.done ? "Guardada" : "Todavía no toca"}>
                          {st?.done ? "✓ Guardada" : "🔒"}
                        </span>
                      )}
                    </span>
                </>
              );
              return (
                <motion.li key={a.id} {...staggerItem(reduce)} data-activity={a.id} data-locked={open ? "false" : "true"} className={dk("lg:flex")}>
                  {open ? (
                    <motion.button
                      whileHover={reduce ? undefined : { y: -2 }}
                      whileTap={reduce ? { opacity: 0.85 } : { scale: 0.98 }}
                      onClick={() => nav({ name: "activity", id: a.id, step: firstPending(state, a.id, a.steps.map((s) => s.id)) })}
                      onAnimationEnd={(e) => e.animationName.startsWith("shimmer") && fresh.includes(a.id) && setFreshState((f) => f.filter((x) => x !== a.id))}
                      className={`relative flex w-full items-start gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md ${
                        st?.done ? "ring-1 ring-slate-300 hover:ring-brand-500" : a.id === currentAct?.id ? "ring-2 ring-brand-500" : "ring-1 ring-brand-500/50 hover:ring-brand-500"
                      } ${fresh.includes(a.id) ? "shimmer" : ""}`}
                    >
                      {inner}
                      {fresh.includes(a.id) && <Sparkles loop count={10} radius={34} className="!left-2 !right-auto !w-12" />}
                    </motion.button>
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
                </motion.li>
              );
            })}
          </motion.ul>
        </section>

        <div className={`grid gap-2 ${canFinish ? "grid-cols-2" : "grid-cols-1"}` + dk("lg:max-w-xl")}>
          <Button variant="outline" onClick={() => nav({ name: "prep" })}>
            {guide.prep.title}
          </Button>
          {canFinish && (
            <Button variant="outline" onClick={() => nav({ name: "summary" })}>
              Resumen y encuesta
            </Button>
          )}
        </div>
        {(state.finished || ended) && state.outbox.length === 0 && (
          <div className={"rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200" + dk("lg:max-w-xl")} data-testid="restart-run">
            {restartAsk ? (
              <>
                <p className="font-semibold text-slate-800">¿Empezar otra prueba en este navegador?</p>
                <p className="mt-1">Tu prueba ya quedó enviada y no se borra. Se abrirá el registro para una prueba nueva.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setRestartAsk(false)}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => {
                      setRestartAsk(false);
                      restart();
                      setView({ name: "home" });
                      window.scrollTo({ top: 0 });
                    }}
                  >
                    Sí, empezar otra
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>¿Otra persona va a hacer la prueba en este aparato?</p>
                <Button variant="outline" className="mt-2 w-full" onClick={() => setRestartAsk(true)}>
                  Empezar otra prueba
                </Button>
              </>
            )}
          </div>
        )}
        <p className="pb-6 text-center text-xs text-slate-600">
          Tu avance se guarda en este navegador. Versión de la guía {guide.version}.
        </p>
      </div>
    );
  }

  const reportActivity = report && guide.activities.find((a) => a.id === report.activityId);
  return (
    <>
      {topbar}
      {desktop ? (
        <div className="mx-auto flex w-full max-w-xl flex-1 px-4 pt-3 [overflow-x:clip] lg:max-w-[1440px] lg:gap-8 lg:px-8 lg:pt-6">
          <Sidebar
            guide={guide}
            state={state}
            view={cur}
            currentId={currentAct?.id}
            isOpen={isOpen}
            canFinish={canFinish}
            minsLeft={minsLeft}
            doneActs={doneActs}
            nav={nav}
            fresh={fresh}
            onFreshSeen={(id) => setFreshState((f) => f.filter((x) => x !== id))}
          />
          <main className="min-w-0 flex-1 lg:pb-10">{body}</main>
        </div>
      ) : (
        <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-3 [overflow-x:clip]">{body}</main>
      )}
      <ReferenceSheet
        guide={guide}
        desktop={desktop}
        open={showRef}
        onClose={() => setShowRef(false)}
        activityId={cur.name === "activity" ? cur.id : undefined}
        part={cur.name === "activity" ? refPart : undefined}
      />
      <ReportSheet
        open={!!report}
        kind={report?.kind ?? "issue"}
        onClose={() => setReport(null)}
        maxUploadMb={maxUploadMb}
        allowedMime={allowedMime}
        reportExample={guide.reportExample}
        orderExample={guide.orderExample}
        context={reportActivity ? `${reportActivity.id} · ${reportActivity.title}${report?.stepId && !report.choices ? ` · Paso ${reportActivity.steps.findIndex((x) => x.id === report.stepId) + 1}` : ""}` : ""}
        steps={
          reportActivity && report?.choices
            ? report.choices.map((id) => {
                const i = reportActivity.steps.findIndex((x) => x.id === id);
                const t = (reportActivity.steps[i]?.text ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
                return { id, label: `Paso ${i + 1} · ${t.length > 70 ? t.slice(0, 68) + "…" : t}` };
              })
            : undefined
        }
        onSubmit={submitReport}
      />
      {saved && <SavedBurst key={saved.n} />}
    </>
  );
}

/**
 * Festejo breve al guardar una actividad: una palomita que «revienta» al centro con una onda,
 * estrellitas y confeti (el texto va en el aviso). Con movimiento reducido: fundido y destellos.
 */
function SavedBurst() {
  const reduce = useReducedMotion();
  return (
    <>
      <Confetti count={28} />
      <div className="pointer-events-none fixed inset-x-0 top-1/3 z-[60] flex justify-center" aria-hidden="true" data-testid="saved-burst">
        <span className="animate-burst relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-600 shadow-xl ring-8 ring-emerald-200/70">
          <motion.span
            className="absolute inset-0 rounded-full ring-4 ring-emerald-400"
            initial={{ opacity: 0.9, scale: 1 }}
            animate={reduce ? { opacity: [0.9, 0] } : { opacity: 0, scale: 2.4 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
          <svg viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray={24} className="animate-check" />
          </svg>
          <Sparkles count={12} radius={78} size={16} delay={0.1} />
        </span>
      </div>
    </>
  );
}

/** Casilla del cierre («Contesté la encuesta…») que se marca sola al enviar la encuesta. */
const SURVEY_DONE_ID = "surveyDone";

/** Espera el envío de lo pendiente, pero no más de `ms` (con mala señal la petición puede tardar mucho). */
const ROUND_CLOSED_MSG = "Se abrió una nueva encuesta. Tu prueba anterior quedó guardada; regístrate para contestar la nueva.";

function flushWithin(flush: () => Promise<boolean>, ms: number): Promise<boolean> {
  return Promise.race([flush().catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
}

/**
 * Qué actividades se pueden abrir.
 * - Sin `sequentialUntil`: orden estricto; solo la primera sin guardar, y las guardadas quedan cerradas.
 * - Con `sequentialUntil`: hasta esa actividad van en orden; al guardarla se abren todas las demás, y
 *   cualquier actividad guardada se puede reabrir y corregir hasta que el tester envíe la encuesta final («Enviar encuesta y terminar»).
 * Al terminar (encuesta enviada) o si el guía terminó la prueba, todo queda cerrado.
 */
function access(guide: Guide, state: RunState) {
  const done = (id: string) => !!state.activities[id]?.done;
  const acts = guide.activities;
  const seqIdx = guide.sequentialUntil ? acts.findIndex((a) => a.id === guide.sequentialUntil) : -1;
  const flexible = seqIdx >= 0;
  const finalized = !!state.ended || state.finished;
  const seqDone = flexible && acts.slice(0, seqIdx + 1).every((a) => done(a.id));
  const firstSeqPending = acts.slice(0, flexible ? seqIdx + 1 : acts.length).find((a) => !done(a.id));
  const isOpen = (id: string) => {
    if (!state.prepDone || finalized) return false;
    const i = acts.findIndex((a) => a.id === id);
    if (i < 0) return false;
    if (!flexible) return id === firstSeqPending?.id;
    if (i <= seqIdx) return done(id) || id === firstSeqPending?.id;
    return seqDone;
  };
  const currentAct = finalized ? undefined : acts.find((a) => !done(a.id) && (state.prepDone ? isOpen(a.id) : true));
  // La encuesta final solo se abre con el 100 % de las actividades guardadas (o si el guía terminó la prueba)
  const canFinish = !!state.ended || acts.every((a) => done(a.id));
  return { flexible, seqDone, isOpen, currentAct, canFinish, finalized, firstFlexId: flexible ? acts[seqIdx + 1]?.id : undefined };
}

/** Evento `step` para el servidor; en pasos de confirmación lleva las casillas (`checkpoint`). */
function stepPayload(state: RunState | null, activityId: string, stepId: string, outcome: string | null) {
  const ticks = state?.checkpoints?.[stepKey(activityId, stepId)];
  return { activityId, stepId, outcome, ...(ticks ? { checkpoint: ticks } : {}) };
}

function firstPending(state: RunState, activityId: string, stepIds: string[]) {
  // Si la actividad está en pausa por una falla, se vuelve al paso donde se detuvo
  const blockedAt = state.blocked?.activityId === activityId && state.blocked.stepId ? stepIds.indexOf(state.blocked.stepId) : -1;
  if (blockedAt >= 0) return blockedAt;
  const i = stepIds.findIndex((id) => !state.steps[stepKey(activityId, id)]);
  return i === -1 ? stepIds.length : i;
}

/* ---------- Barra lateral (guía de escritorio, pantallas grandes) ---------- */
const RESULT_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  issue: "bg-amber-500",
  blocked: "bg-rose-500",
  skipped: "bg-slate-400",
};

function Sidebar({
  guide,
  state,
  view,
  currentId,
  canFinish,
  minsLeft,
  doneActs,
  nav,
  fresh = [],
  onFreshSeen,
  isOpen,
}: {
  fresh?: string[];
  onFreshSeen?: (id: string) => void;
  isOpen: (id: string) => boolean;
  guide: Guide;
  state: RunState;
  view: View;
  currentId?: string;
  canFinish: boolean;
  minsLeft: number;
  doneActs: number;
  nav: (v: View) => void;
}) {
  const reduce = useReducedMotion();
  const item = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition ${
      active ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-700 hover:bg-slate-100"
    }`;
  return (
    <aside className="hidden w-72 shrink-0 lg:block" aria-label="Navegación de la guía" data-testid="guide-sidebar">
      <div className="sticky top-[78px] flex max-h-[calc(100dvh-102px)] flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="border-b border-slate-100 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-ink">{guide.role}</div>
          <div className="mt-0.5 font-bold leading-snug">{guide.title}</div>
          <div className="mt-3 flex items-baseline justify-between text-xs text-slate-600">
            <span>
              {doneActs} de {guide.activities.length} actividades
            </span>
            <span className="font-semibold text-slate-700">{minsLeft > 0 ? `Faltan ~${minsLeft} min` : "Todas guardadas"}</span>
          </div>
          <ProgressBar value={doneActs / guide.activities.length} className="mt-1.5" />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <button onClick={() => nav({ name: "home" })} className={item(view.name === "home")}>
            <span className="w-5 text-center" aria-hidden="true">
              🏠
            </span>
            Inicio
          </button>
          <button onClick={() => nav({ name: "prep" })} className={item(view.name === "prep")}>
            <span className="w-5 text-center" aria-hidden="true">
              {state.prepDone ? "✅" : "📋"}
            </span>
            <span className="flex-1">{guide.prep.title}</span>
          </button>

          <div className="mt-3 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actividades</div>
          <motion.ul {...staggerList()} className="space-y-0.5">
            {guide.activities.map((a) => {
              const st = state.activities[a.id];
              const done = !!st?.done;
              const isCurrent = a.id === currentId;
              const open = isOpen(a.id);
              const active = view.name === "activity" && view.id === a.id;
              const paused = !done && state.blocked?.activityId === a.id;
              const n = a.steps.filter((x) => state.steps[stepKey(a.id, x.id)]).length;
              const inner = (
                <>
                  <span
                    className={`flex h-6 w-12 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                      active ? "bg-brand-500 text-white" : open ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {a.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate leading-snug">{a.title}</span>
                    <span className="block text-[11px] leading-tight text-slate-600">
                      {done ? (
                        <>
                          <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${RESULT_DOT[st.result ?? "ok"]}`} />
                          {open ? "✓ Guardada · ✎ corregir" : "✓ Guardada"}
                        </>
                      ) : paused ? (
                        <span className="font-medium text-rose-600">En pausa</span>
                      ) : open ? (
                        n > 0 ? `En curso · ${n}/${a.steps.length} pasos` : `${isCurrent ? "Siguiente" : "Abierta"} · ${a.steps.length} pasos`
                      ) : (
                        state.ended ? "No realizada" : "🔒 Todavía no toca"
                      )}
                    </span>
                  </span>
                </>
              );
              return (
                <motion.li key={a.id} {...staggerItem(reduce)} data-nav-activity={a.id}>
                  {open ? (
                    <motion.button
                      whileHover={reduce ? undefined : { x: 3 }}
                      whileTap={reduce ? { opacity: 0.8 } : { scale: 0.97 }}
                      onClick={() => nav({ name: "activity", id: a.id, step: firstPending(state, a.id, a.steps.map((x) => x.id)) })}
                      onAnimationEnd={(e) => e.animationName.startsWith("shimmer") && fresh.includes(a.id) && onFreshSeen?.(a.id)}
                      className={`relative ${item(active)} ${active || done ? "" : "ring-1 ring-brand-100"} ${fresh.includes(a.id) ? "shimmer" : ""}`}
                    >
                      {inner}
                      {fresh.includes(a.id) && <Sparkles loop count={8} radius={24} size={10} className="!left-1 !right-auto !w-12" />}
                    </motion.button>
                  ) : (
                    <div aria-disabled="true" className={`flex w-full cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${done ? "text-slate-600" : "text-slate-500"}`}>
                      {inner}
                    </div>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        </nav>

        <div className="space-y-0.5 border-t border-slate-100 p-2">
          {canFinish && (
            <button onClick={() => nav({ name: "summary" })} className={item(view.name === "summary" || view.name === "survey")}>
              <span className="w-5 text-center" aria-hidden="true">
                🏁
              </span>
              Resumen y encuesta
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

/* ---------- Identificación del tester ---------- */
function Identify({
  guide,
  desktop = false,
  variantCtl,
  notice,
  onDone,
}: {
  guide: Guide;
  desktop?: boolean;
  variantCtl?: VariantCtl;
  /** Aviso arriba del formulario (p. ej. se abrió una encuesta nueva). */
  notice?: string;
  onDone: (s: RunState) => void;
}) {
  const d0 = variantCtl?.draft;
  const [name, setName] = useState(d0?.name ?? "");
  const [email, setEmail] = useState(d0?.email ?? "");
  // El rol no se pregunta: lo da la liga (la guía) que abrió el tester
  const role = guide.role;
  // Solo se llevan los datos con el mismo id en las dos guías (p. ej. la sucursal)
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(guide.tester.fields.filter((f) => d0?.fields[f.id]).map((f) => [f.id, d0!.fields[f.id]]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // El borrador vive en el selector de variante: si cambia de computadora a celular no se pierde lo escrito
  const setDraft = variantCtl?.setDraft;
  useEffect(() => {
    setDraft?.({ name, email, role, fields });
  }, [setDraft, name, email, role, fields]);

  const errors: Errors = { ...validateFields(guide.tester.fields, fields) };
  const nameErr = validateName(name);
  const emailErr = validateEmail(email);
  if (nameErr) errors._name = nameErr;
  if (emailErr) errors._email = emailErr;
  const shown: Errors = tried ? { ...serverErrors, ...errors } : {};
  const valid = Object.keys(errors).length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerErrors({});
    if (!valid) {
      setTried(true);
      focusFirstError(formRef.current);
      return;
    }
    setBusy(true);
    setError(null);
    const clean = trimAll(fields);
    try {
      const device = { ...(await detectDevice()), ...(variantCtl ? { guideVariant: variantCtl.variant } : {}) };
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guideId: guide.id, name: name.trim(), email: email.trim(), role, fields: clean, device }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El servidor valida con las mismas reglas: sus errores por campo se muestran junto a cada campo
        const fe = (data.fields ?? {}) as Record<string, string>;
        const mapped: Errors = {};
        for (const [k, v] of Object.entries(fe)) mapped[k === "name" ? "_name" : k === "email" ? "_email" : k.replace(/^fields\./, "")] = v;
        if (Object.keys(mapped).length) {
          setServerErrors(mapped);
          setTried(true);
          focusFirstError(formRef.current);
          return;
        }
        throw new Error(data.error || "Error");
      }
      onDone({
        v: 1,
        guideVersion: guide.version,
        runId: data.runId,
        token: data.token,
        roundId: typeof data.roundId === "number" ? data.roundId : undefined,
        tester: { name: name.trim(), email: email.trim(), role, fields: clean },
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
      const msg = err instanceof Error && err.message !== "Error" && !/fetch|network/i.test(err.message) ? err.message : "No pudimos registrarte. Revisa tu conexión e inténtalo otra vez.";
      setError(msg);
      toast.error(msg, { title: "No se pudo comenzar", action: { label: "Reintentar", onClick: () => formRef.current?.requestSubmit() } });
    } finally {
      setBusy(false);
    }
  };

  const intro = (
    <>
      <p className={"text-slate-700" + (desktop ? " lg:text-lg lg:leading-relaxed" : "")}>{guide.summary}</p>
      {guide.notice && (
        <div className="mt-3">
          <Callout tone="info">{guide.notice}</Callout>
        </div>
      )}
    </>
  );

  return (
    <main
      className={
        "animate-pop mx-auto w-full max-w-xl flex-1 px-4 py-6" +
        (desktop ? " lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_500px] lg:items-start lg:gap-12 lg:px-8 lg:py-12" : "")
      }
    >
      <div className={desktop ? "lg:sticky lg:top-8 lg:pt-2" : undefined}>
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-600 hover:underline">
          ← Guías
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <Image src="/logo.png" alt="AppHouse" width={64} height={46} />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-ink">{guide.role}</div>
            <h1 className={"text-xl font-bold leading-tight" + (desktop ? " lg:text-3xl" : "")}>{guide.title}</h1>
            {desktop && <p className="mt-1 hidden text-slate-600 lg:block">{guide.subtitle}</p>}
          </div>
        </div>
        {desktop && <div className="mt-6 hidden lg:block">{intro}</div>}
        {desktop && (
          <ul className="mt-8 hidden gap-3 text-sm text-slate-600 lg:grid lg:grid-cols-3">
            <li className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="text-xl" aria-hidden="true">🧭</div>
              <div className="mt-1 font-semibold text-slate-800">{guide.activities.length} actividades en orden</div>
              Cada una con sus pasos y capturas del panel.
            </li>
            <li className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="text-xl" aria-hidden="true">🖥️</div>
              <div className="mt-1 font-semibold text-slate-800">Capturas en grande</div>
              Haz clic en cualquier captura para verla en pantalla completa.
            </li>
            <li className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="text-xl" aria-hidden="true">🐞</div>
              <div className="mt-1 font-semibold text-slate-800">Reporta fallas</div>
              Con «Tuve un problema» describes qué pasó y adjuntas capturas.
            </li>
          </ul>
        )}
      </div>

      <div className={"mt-5 space-y-5" + (desktop ? " lg:mt-0" : "")}>
        {notice && (
          <div data-testid="round-closed">
            <Callout tone="info">{notice}</Callout>
          </div>
        )}
        <div className={desktop ? "lg:hidden" : undefined}>{intro}</div>
        {variantCtl?.carriedFrom && (
          <Callout tone="info">
            Tu avance con las capturas {VARIANTS[variantCtl.carriedFrom].of} quedó guardado. Aquí empiezas la versión {VARIANTS[variantCtl.variant].for}:
            ya llenamos tus datos, revísalos y toca <strong>Comenzar</strong>.
          </Callout>
        )}
        <form
          ref={formRef}
          onSubmit={submit}
          noValidate
          className={"space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200" + (desktop ? " lg:p-7 lg:shadow-md" : "")}
        >
          <div>
            <h2 className="text-lg font-semibold">¿Quién hace la prueba?</h2>
            <p className="text-sm text-slate-600">Los datos con * son obligatorios.</p>
          </div>
          <FormField id="t-name" label="Nombre y apellido *" error={shown._name}>
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={LIMITS.name + 20} />}
          </FormField>
          <FormField id="t-email" label="Correo *" error={shown._email}>
            {(p) => (
              <input
                {...p}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={LIMITS.email + 20}
              />
            )}
          </FormField>
          {guide.tester.fields.map((f) => (
            <FormField key={f.id} id={`t-${f.id}`} label={`${f.label}${f.required ? " *" : ""}`} error={shown[f.id]} hint={f.patternHint}>
              {(p) =>
                f.options ? (
                  <div id={p.id} role="radiogroup" aria-invalid={p["aria-invalid"]} aria-describedby={p["aria-describedby"]} className="flex gap-2">
                    {f.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        role="radio"
                        aria-checked={fields[f.id] === o}
                        onClick={() => setFields({ ...fields, [f.id]: o })}
                        className={
                          "min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold ring-1 transition " +
                          (fields[f.id] === o ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-800 ring-slate-300 hover:bg-slate-50")
                        }
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                ) : (
                <input
                  {...p}
                  type={f.type === "email" ? "email" : "text"}
                  inputMode={f.type === "email" ? "email" : f.type === "number" ? "decimal" : undefined}
                  placeholder={f.placeholder}
                  maxLength={(f.maxLength ?? LIMITS.field) + 20}
                  value={fields[f.id] ?? ""}
                  onChange={(e) => setFields({ ...fields, [f.id]: e.target.value })}
                />
                )
              }
            </FormField>
          ))}
          <p className="text-xs text-slate-600">Tu navegador, sistema y tamaño de pantalla se registran automáticamente.</p>
          {tried && !valid && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800" role="alert">
              Revisa {Object.keys(errors).length === 1 ? "el dato marcado" : `los ${Object.keys(errors).length} datos marcados`} en rojo.
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
              {error}
            </p>
          )}
          <Button size="lg" className="w-full" disabled={busy} pulse={valid && !busy}>
            {busy ? "Registrando…" : "Comenzar"}
          </Button>
        </form>
      </div>
    </main>
  );
}

/* ---------- Antes de empezar ---------- */
function Prep({
  guide,
  state,
  update,
  onDone,
  desktop = false,
}: {
  guide: Guide;
  state: RunState;
  update: ReturnType<typeof useRun>["update"];
  onDone: () => void;
  desktop?: boolean;
}) {
  const p = guide.prep;
  const allChecked = p.checklist.every((c) => state.prep[c.id]);
  const reduce = useReducedMotion();
  const dk = (c: string) => (desktop ? " " + c : "");
  const card = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" + dk("lg:p-6");
  return (
    <div className={"animate-pop space-y-5 pb-8" + dk("lg:max-w-6xl lg:space-y-6")}>
      <h1 className={"text-2xl font-bold" + dk("lg:text-3xl")}>{p.title}</h1>
      <div className={"space-y-5" + dk("lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0")}>
      {p.sections.map((s) => (
        <section key={s.title} className={card}>
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
      </div>
      <div className={"space-y-5" + dk("lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0")}>
      <section className={card}>
        <h2 className="mb-2 font-semibold">Confirma</h2>
        <ul className="space-y-2">
          {p.checklist.map((c) => (
            <motion.li key={c.id} layout={!reduce} whileTap={reduce ? undefined : { scale: 0.98 }}>
              <label
                className={`flex items-start gap-3 rounded-xl p-3 text-sm ring-1 transition-colors duration-300 ${
                  state.prep[c.id] ? "bg-emerald-50 ring-emerald-200" : "bg-slate-50 ring-transparent"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 accent-[#2f5da8]"
                  checked={!!state.prep[c.id]}
                  onChange={(e) => {
                    const prep = { ...state.prep, [c.id]: e.target.checked };
                    update((s) => ({ ...s, prep }), [{ type: "run", payload: { prep } }]);
                  }}
                />
                <span className="flex-1">{c.label}</span>
                <TickBadge on={!!state.prep[c.id]} />
              </label>
            </motion.li>
          ))}
        </ul>
      </section>
      <section className={card}>
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
      </div>
      {p.tour && (
        <section className={card + dk("lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6")}>
          <div>
          <h2 className="mb-2 font-semibold">{p.tour.title}</h2>
          <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
            {p.tour.items.map((r, i) => (
              <li key={i}>
                <Rich text={r} />
              </li>
            ))}
          </ol>
          </div>
          {p.tour.image && <StepImage src={p.tour.image} caption={p.tour.caption} desktop={desktop} />}
        </section>
      )}
      <Button
        size="lg"
        className={"w-full" + dk("lg:ml-auto lg:flex lg:w-auto lg:min-w-96")}
        disabled={!allChecked}
        pulse={allChecked && !state.prepDone}
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
  desktop = false,
}: {
  guide: Guide;
  state: RunState;
  update: ReturnType<typeof useRun>["update"];
  onSurvey: () => void;
  desktop?: boolean;
}) {
  const pending = guide.activities.filter((a) => !state.activities[a.id]?.done);
  const issues = state.issues.filter((i) => i.kind === "issue");
  const dk = (c: string) => (desktop ? " " + c : "");
  const reduce = useReducedMotion();
  return (
    <div className={"animate-pop space-y-5 pb-8" + dk("lg:max-w-5xl lg:space-y-6")}>
      <h1 className={"text-2xl font-bold" + dk("lg:text-3xl")}>Resumen de tu prueba</h1>
      <motion.div {...staggerList()} className={"grid grid-cols-3 gap-2 text-center" + dk("lg:gap-4")}>
        <Stat n={guide.activities.length - pending.length} label="Actividades listas" />
        <Stat
          n={guide.activities
            .filter((a) => ["ok", "issue"].includes(state.activities[a.id]?.result ?? ""))
            .reduce((n, a) => n + a.steps.filter((s) => state.steps[stepKey(a.id, s.id)] === "ok").length, 0)}
          label="Pasos logrados"
        />
        <Stat n={issues.length} label="Fallas reportadas" tone={issues.length ? "warn" : undefined} />
      </motion.div>
      {state.ended && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
          <strong>El guía terminó la prueba por un bloqueo.</strong>
          <p className="mt-1 whitespace-pre-wrap">{state.ended.reason}</p>
          {pending.length > 0 && <p className="mt-1 text-xs">No se realizaron: {pending.map((a) => a.id).join(", ")}.</p>}
        </div>
      )}
      <div className={dk("lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6")}>
      <motion.ul {...staggerList()} className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {guide.activities.map((a) => {
          const st = state.activities[a.id] ?? emptyActivity();
          const ok = a.steps.filter((s) => state.steps[stepKey(a.id, s.id)] === "ok").length;
          const fail = a.steps.filter((s) => state.steps[stepKey(a.id, s.id)] === "fail").length;
          const nIssues = state.issues.filter((i) => i.activityId === a.id && i.kind === "issue").length;
          return (
            <motion.li key={a.id} {...staggerItem(reduce)}>
              <div className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm">
                <span className="w-14 shrink-0 font-bold text-teal-ink">{a.id}</span>
                {desktop && <span className="hidden w-56 shrink-0 truncate text-slate-600 lg:block">{a.title}</span>}
                <span className="flex-1">
                  <span className="block font-medium">{st.done && st.result ? ACTIVITY_RESULTS[st.result] : state.ended ? "No realizada" : "Pendiente"}</span>
                  <span className="text-xs text-slate-600">
                    {st.result === "skipped" || st.result === "blocked"
                      ? `${ok + fail} de ${a.steps.length} pasos vistos`
                      : `✓ ${ok} logrados · ✗ ${fail} de ${a.steps.length} pasos`}
                    {nIssues ? ` · ${nIssues} reporte(s)` : ""}
                  </span>
                </span>
                {st.done && <span className="text-emerald-700" aria-label="Guardada">✓</span>}
              </div>
            </motion.li>
          );
        })}
      </motion.ul>
      <div className={"mt-5 space-y-5" + dk("lg:mt-0")}>
      {issues.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Tus reportes</h2>
          <ul className="space-y-2">
            {issues.map((i) => (
              <li key={i.id} className="rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200">
                <div className="text-xs font-semibold text-rose-700">
                  {i.activityId}
                  {i.stepId ? ` · paso ${(guide.activities.find((a) => a.id === i.activityId)?.steps.findIndex((x) => x.id === i.stepId) ?? -1) + 1 || i.stepId}` : ""} {i.blocking ? "· impide seguir" : i.severity === "bajo" ? "· detalle" : ""}
                </div>
                <p className="mt-0.5">{i.description}</p>
                {i.attachments.length > 0 && <p className="mt-1 text-xs text-slate-600">📎 {i.attachments.length} archivo(s)</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {(guide.finish.checklist.length > 0 || !!guide.finish.text) && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 font-semibold">Al terminar</h2>
          {guide.finish.text && (
            <p className="mb-3 text-sm text-slate-700">
              <Rich text={guide.finish.text} links />
            </p>
          )}
          {guide.finish.checklist.map((c) =>
            c.id === SURVEY_DONE_ID ? (
              // Se marca sola al enviar la encuesta (no se puede marcar antes de contestarla)
              <div key={c.id} className="mb-2 flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm" data-testid="finish-survey-auto">
                <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#2f5da8]" checked={state.finished} disabled readOnly aria-describedby={`finish-${c.id}-hint`} aria-label={c.label} />
                <span>
                  {c.label}
                  <span id={`finish-${c.id}-hint`} className="block text-xs text-slate-600">
                    {state.finished ? "Listo: se marcó sola al enviar la encuesta." : "Se marca sola cuando envías la encuesta final (botón de abajo)."}
                  </span>
                </span>
              </div>
            ) : (
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
            )
          )}
        </section>
      )}
      </div>
      </div>
      <Button size="lg" pulse={!state.finished} className={"w-full" + dk("lg:ml-auto lg:flex lg:w-auto lg:min-w-96")} onClick={onSurvey}>
        {state.finished ? "Ver mi encuesta" : "Contestar la encuesta final"} →
      </Button>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "warn" }) {
  const reduce = useReducedMotion();
  return (
    <motion.div {...staggerItem(reduce)} className={`rounded-2xl p-3 shadow-sm ring-1 ${tone ? "bg-amber-50 ring-amber-200" : "bg-white ring-slate-200"}`}>
      <CountUp value={n} className="block text-2xl font-bold tabular-nums" />
      <div className="text-xs text-slate-600">{label}</div>
    </motion.div>
  );
}

/* ---------- Hoja de datos / ayuda ---------- */
function ReferenceSheet({
  guide,
  open,
  onClose,
  desktop = false,
  activityId,
  part,
}: {
  guide: Guide;
  open: boolean;
  onClose: () => void;
  desktop?: boolean;
  /** Actividad en curso: solo se muestran sus datos (con opción de ver todos). */
  activityId?: string;
  part?: string;
}) {
  const [tab, setTab] = useState<"data" | "help">("data");
  const [all, setAll] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // Cada vez que se abre, empieza en «Datos» y solo con lo de la actividad
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTab("data");
      setAll(false);
    }
  }
  const fits = (tags?: string[]) =>
    !tags?.length ||
    tags.some((t) => {
      const [a, p] = t.split(":");
      return a === activityId && (!p || !part || p === part);
    });
  const filtering = !!activityId && !all;
  const tables = filtering
    ? guide.reference.tables
        .filter((t) => fits(t.activities))
        .map((t) => {
          const keep = t.rows.map((_, i) => fits(t.rowActivities?.[i]));
          return { ...t, rows: t.rows.filter((_, i) => keep[i]) };
        })
        .filter((t) => t.rows.length > 0)
    : guide.reference.tables;
  return (
    <Sheet open={open} onClose={onClose} title={tab === "data" ? guide.reference.title : "Qué hacer si…"} size={desktop ? "wide" : "default"}>
      <div className={"mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm" + (desktop ? " lg:max-w-sm" : "")}>
        {[
          ["data", "Datos"],
          ["help", "Qué hacer si…"],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k as "data" | "help")}
            aria-pressed={tab === k}
            className={`min-h-10 rounded-lg py-2 font-medium ${tab === k ? "bg-white shadow-sm" : "text-slate-700"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "data" ? (
        <div className="space-y-5">
          {activityId && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-slate-700">
                {filtering ? `Solo lo que usas en ${activityId}${part ? ` · Parte ${part}` : ""}` : "Todos los datos de la prueba"}
              </span>
              <button type="button" onClick={() => setAll(!all)} className="min-h-10 font-medium text-brand-700 hover:underline" data-testid="ref-toggle">
                {filtering ? "Ver todos los datos" : `Ver solo ${activityId}`}
              </button>
            </div>
          )}
          {!filtering && guide.reference.intro && <Callout tone="info">{guide.reference.intro}</Callout>}
          {filtering && tables.length === 0 && (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{activityId} no usa datos de esta hoja.</p>
          )}
          {tables.map((t) => (
            <section key={t.title}>
              <h3 className="mb-2 font-semibold">{t.title}</h3>
              <div className={"space-y-2" + (desktop ? " lg:hidden" : "")}>
                {t.rows.map((r, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 p-3 text-sm">
                    <div className="font-semibold">
                      <Rich text={r[0]} />
                    </div>
                    {r.slice(1).map((c, j) => (
                      <div key={j} className="mt-0.5 text-slate-700">
                        {t.columns.length > 2 && <span className="text-xs text-slate-600">{t.columns[j + 1]}: </span>}
                        <Rich text={c} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {desktop && (
                // En escritorio, tabla de verdad
                <div className="hidden overflow-hidden rounded-xl ring-1 ring-slate-200 lg:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        {t.columns.map((c) => (
                          <th key={c} className="px-3 py-2 font-semibold">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {t.rows.map((r, i) => (
                        <tr key={i} className="align-top even:bg-slate-50/50">
                          {r.map((c, j) => (
                            <td key={j} className={`px-3 py-2 ${j === 0 ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                              <Rich text={c} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {t.note && <p className="mt-2 text-xs text-slate-600">{t.note}</p>}
            </section>
          ))}
        </div>
      ) : (
        <ul className={"space-y-2" + (desktop ? " lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0" : "")}>
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
