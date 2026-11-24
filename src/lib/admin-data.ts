import { getDb } from "./db";
import { getGuide } from "./guides";
import { ACTIVITY_RESULTS } from "./types";

export type RunRow = {
  id: string;
  guide_id: string;
  guide_version: string;
  name: string;
  email: string;
  role: string;
  tester_fields: string;
  device: string;
  prep: string;
  finish: string;
  status: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  ended_reason: string;
  ended_at: string | null;
  verdict_scope?: string;
  verdict_scope_note?: string;
};
/** outcome "na" = «No me apareció» (paso condicional). */
export type StepRow = { run_id: string; activity_id: string; step_id: string; outcome: "ok" | "fail" | "na" };
export type ActivityRow = { run_id: string; activity_id: string; result: string | null; checks: string; fields: string; notes: string };
export type IssueRow = {
  id: string;
  run_id: string;
  activity_id: string;
  step_id: string | null;
  kind: "issue" | "evidence";
  description: string;
  expected: string;
  blocking: number;
  /** critico | alto | medio | bajo ('' en evidencias). */
  severity: string;
  /** Revisión de Mesa de control (ver TRIAGE). */
  triage: string;
  triage_note: string;
  /** Tipo de bug del desarrollo (ver BUG_TYPES); '' = sin clasificar. */
  bug_type?: string;
  order_number: string;
  created_at: string;
};
export type HelpRow = {
  id: string;
  run_id: string;
  activity_id: string;
  step_id: string | null;
  issue_id: string | null;
  reason: string;
  status: "open" | "resolved" | "ended";
  created_at: string;
  resolved_at: string | null;
  resolution: string;
};
export const HELP_STATUS: Record<HelpRow["status"], string> = { open: "Abierta", resolved: "Resuelta", ended: "Prueba terminada" };

export const RUN_STATUS: Record<string, string> = {
  in_progress: "En curso",
  finished: "Terminada",
  ended_blocked: "Terminada por bloqueo",
};
export const runStatusLabel = (s: string) => RUN_STATUS[s] ?? s;
export const runStatusClass = (s: string) =>
  s === "finished" ? "bg-emerald-100 text-emerald-800" : s === "ended_blocked" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";

/** "hace 5 min" */
export function timeAgo(iso: string, nowMs = Date.now()) {
  const m = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (m < 1) return "hace menos de 1 min";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h ${m % 60} min`;
  return `hace ${Math.floor(h / 24)} día(s)`;
}

/** Solicitudes de ayuda abiertas de todas las guías (las más antiguas primero). */
export function loadOpenHelp() {
  const rows = getDb()
    .prepare(
      `SELECT h.*, r.name AS tester, r.guide_id AS guide_id FROM help_requests h JOIN runs r ON r.id = h.run_id
       WHERE h.status = 'open' ORDER BY h.created_at`
    )
    .all() as (HelpRow & { tester: string; guide_id: string })[];
  return { rows, at: Date.now() };
}

export type AttachmentRow = { id: string; run_id: string; issue_id: string; original_name: string; mime: string; size: number };

export type Rec = Record<string, string | number | boolean>;

export function parseRec(s: string | null | undefined): Rec {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const flatten = (r: Rec, sep = "; ") =>
  Object.entries(r)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "boolean" ? (v ? "sí" : "no") : v}`)
    .join(sep);

/** Resumen corto del dispositivo (sin IP). */
export function deviceSummary(device: Rec, fields?: Rec): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim() && !parts.includes(v.trim())) parts.push(v.trim());
  };
  push(fields?.device);
  for (const [k, v] of Object.entries(device)) {
    if (k === "ip" || k === "userAgent" || k === "ua") continue;
    push(v);
  }
  return parts.slice(0, 3).join(" · ");
}

export const guideTitle = (id: string) => getGuide(id)?.title ?? id;

export const resultLabel = (r: string | null | undefined) =>
  r && r in ACTIVITY_RESULTS ? ACTIVITY_RESULTS[r as keyof typeof ACTIVITY_RESULTS] : "Pendiente";

export function loadRuns(guideId?: string | null): RunRow[] {
  const db = getDb();
  return (guideId
    ? db.prepare("SELECT * FROM runs WHERE guide_id = ? ORDER BY created_at DESC").all(guideId)
    : db.prepare("SELECT * FROM runs ORDER BY created_at DESC").all()) as RunRow[];
}

export function loadAll(guideId?: string | null) {
  const db = getDb();
  const runs = loadRuns(guideId);
  const ids = new Set(runs.map((r) => r.id));
  const keep = <T extends { run_id: string }>(rows: T[]) => rows.filter((r) => ids.has(r.run_id));
  return {
    runs,
    steps: keep(db.prepare("SELECT run_id, activity_id, step_id, outcome FROM step_results").all() as StepRow[]),
    activities: keep(db.prepare("SELECT * FROM activity_results").all() as ActivityRow[]),
    issues: keep(db.prepare("SELECT * FROM issues ORDER BY created_at DESC").all() as IssueRow[]),
    attachments: keep(db.prepare("SELECT id, run_id, issue_id, original_name, mime, size FROM attachments ORDER BY created_at").all() as AttachmentRow[]),
    help: keep(db.prepare("SELECT * FROM help_requests ORDER BY created_at DESC").all() as HelpRow[]),
    surveys: keep(db.prepare("SELECT run_id, answers FROM survey_responses WHERE is_draft = 0").all() as { run_id: string; answers: string }[]),
  };
}

export const isImage = (mime: string) => mime.startsWith("image/") && !/hei[cf]/.test(mime);
export const isVideo = (mime: string) => mime.startsWith("video/");

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "";

/** Estado de una verificación "qué debería pasar"; la clave puede ser el índice o el texto. */
/** true = sí, false = no, "na" = no aplica, undefined = sin contestar. */
export function checkValue(checks: Rec, index: number, text: string): boolean | "na" | undefined {
  for (const k of [String(index), `e${index}`, `${index}`, text]) {
    if (k in checks) return checks[k] === "na" ? "na" : Boolean(checks[k]);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Estado en vivo de cada corrida (Mesa de control y Resumen automático)

/** Minutos sin ninguna señal (evento) para considerar abandonada una corrida no terminada. */
export const ABANDON_MIN = 45;
/** Minutos sin guardar una actividad para marcar a un tester como «sin avance». */
export const STALL_MIN = 20;

export type LiveState = "finished" | "ended_blocked" | "abandoned" | "active";

/** Terminada, terminada por bloqueo, abandonada (> ABANDON_MIN sin señal) o activa. */
export function liveState(run: Pick<RunRow, "status" | "updated_at">, nowMs = Date.now()): LiveState {
  if (run.status === "finished") return "finished";
  if (run.status === "ended_blocked") return "ended_blocked";
  return nowMs - new Date(run.updated_at).getTime() > ABANDON_MIN * 60_000 ? "abandoned" : "active";
}

export const minutesSince = (iso: string | null | undefined, nowMs = Date.now()) =>
  iso ? Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000)) : null;

const SAVED_RESULTS = new Set(Object.keys(ACTIVITY_RESULTS));

export type RunProgress = {
  /** Actividades de la guía con resultado guardado. */
  saved: number;
  total: number;
  /**
   * Actividad actual: la no guardada con el paso marcado más reciente; si no hay, la primera no
   * guardada en el orden de la guía; si ya guardó todas, la última guardada.
   */
  current: { id: string; title: string; known: boolean; mode: "working" | "next" | "last" } | null;
  /** Último guardado de una actividad (incluye ids que ya no están en la guía). */
  lastSavedAt: string | null;
  /** Ids guardados que ya no existen en la guía (p. ej. actividades retiradas). */
  unknownSaved: string[];
};

/** Avance de una corrida a partir de sus filas de actividad y de pasos (ya filtradas por run_id). */
export function runProgress(
  guideId: string,
  acts: { activity_id: string; result: string | null; updated_at?: string }[],
  steps: { activity_id: string; updated_at?: string }[],
): RunProgress {
  const g = getGuide(guideId);
  const order = g?.activities ?? [];
  const known = new Set(order.map((a) => a.id));
  const saved = acts.filter((a) => a.result && SAVED_RESULTS.has(a.result));
  const savedIds = new Set(saved.map((a) => a.activity_id));
  const byTime = [...saved].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  const lastSaved = byTime[0];
  // Para mostrar «Última: …» se prefiere una actividad que siga en la guía
  const lastKnown = byTime.find((a) => known.has(a.activity_id)) ?? lastSaved;
  const title = (id: string) => order.find((a) => a.id === id)?.title ?? "";

  let current: RunProgress["current"] = null;
  const pending = order.filter((a) => !savedIds.has(a.id));
  if (pending.length) {
    const pendingIds = new Set(pending.map((a) => a.id));
    const touched = steps
      .filter((s) => pendingIds.has(s.activity_id))
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0];
    const a = touched ? order.find((x) => x.id === touched.activity_id)! : pending[0];
    current = { id: a.id, title: a.title, known: true, mode: touched ? "working" : "next" };
  } else if (lastKnown) {
    current = { id: lastKnown.activity_id, title: title(lastKnown.activity_id), known: known.has(lastKnown.activity_id), mode: "last" };
  }
  return {
    saved: order.filter((a) => savedIds.has(a.id)).length,
    total: order.length,
    current,
    lastSavedAt: lastSaved?.updated_at ?? null,
    unknownSaved: [...savedIds].filter((id) => !known.has(id)),
  };
}

export type MesaState = "help" | "stalled" | "abandoned" | "active" | "ended_blocked" | "finished";

export const MESA_STATE: Record<MesaState, { label: string; cls: string; rank: number }> = {
  help: { label: "Pide ayuda", cls: "bg-red-600 text-white", rank: 0 },
  stalled: { label: `Sin avance`, cls: "bg-amber-100 text-amber-900 ring-1 ring-amber-300", rank: 1 },
  abandoned: { label: "Abandonada", cls: "bg-slate-200 text-slate-700", rank: 3 },
  active: { label: "Avanzando", cls: "bg-sky-100 text-sky-800", rank: 4 },
  ended_blocked: { label: "Terminada por bloqueo", cls: "bg-red-100 text-red-800", rank: 5 },
  finished: { label: "Terminada", cls: "bg-emerald-100 text-emerald-800", rank: 6 },
};

export type MesaRow = {
  run: RunRow;
  guideTitle: string;
  branch: string;
  fields: string;
  device: string;
  progress: RunProgress;
  /** Minutos desde el último guardado (o desde el inicio si no ha guardado nada). */
  minsSinceSave: number;
  minsSinceSignal: number;
  failures: number;
  blocking: number;
  openHelp: (HelpRow & { minsOpen: number }) | null;
  state: MesaState;
  /** Menor = necesita atención antes. */
  rank: number;
  /** Por qué necesita atención (vacío si no). */
  reason: string;
};

/** Filas de la Mesa de control: todos los testers, los que necesitan atención primero. */
export function loadMesa(guideId?: string | null, nowMs = Date.now()) {
  const db = getDb();
  const runs = loadRuns(guideId);
  const ids = new Set(runs.map((r) => r.id));
  const by = <T extends { run_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (ids.has(r.run_id)) m.set(r.run_id, [...(m.get(r.run_id) ?? []), r]);
    return m;
  };
  const acts = by(db.prepare("SELECT run_id, activity_id, result, updated_at FROM activity_results").all() as { run_id: string; activity_id: string; result: string | null; updated_at: string }[]);
  const steps = by(db.prepare("SELECT run_id, activity_id, updated_at FROM step_results").all() as { run_id: string; activity_id: string; updated_at: string }[]);
  const issues = by(db.prepare("SELECT run_id, blocking FROM issues WHERE kind = 'issue'").all() as { run_id: string; blocking: number }[]);
  const help = by(db.prepare("SELECT * FROM help_requests WHERE status = 'open' ORDER BY created_at").all() as HelpRow[]);

  const rows: MesaRow[] = runs.map((run) => {
    const fieldsRec = parseRec(run.tester_fields);
    const progress = runProgress(run.guide_id, acts.get(run.id) ?? [], steps.get(run.id) ?? []);
    const iss = issues.get(run.id) ?? [];
    const h = (help.get(run.id) ?? [])[0];
    const live = liveState(run, nowMs);
    const minsSinceSave = minutesSince(progress.lastSavedAt ?? run.created_at, nowMs) ?? 0;
    const minsSinceSignal = minutesSince(run.updated_at, nowMs) ?? 0;
    const blocking = iss.filter((i) => i.blocking).length;
    let state: MesaState = live;
    if (h) state = "help";
    else if (live === "active" && minsSinceSave > STALL_MIN) state = "stalled";
    let rank = MESA_STATE[state].rank;
    // Una corrida activa con fallas bloqueantes va justo después de las que piden ayuda
    if (state === "active" && blocking) rank = 2;
    const reason =
      state === "help"
        ? `Pidió ayuda hace ${minutesSince(h!.created_at, nowMs)} min`
        : state === "stalled"
          ? `${minsSinceSave} min sin guardar una actividad`
          : state === "abandoned"
            ? `Sin actividad desde hace ${fmtMinutes(minsSinceSignal)}`
            : state === "active" && blocking
              ? `${blocking} falla${blocking === 1 ? "" : "s"} bloqueante${blocking === 1 ? "" : "s"}`
              : "";
    return {
      run,
      guideTitle: guideShortTitle(run.guide_id),
      branch: String(fieldsRec.branch ?? fieldsRec.sucursal ?? "").trim(),
      fields: Object.entries(fieldsRec)
        .filter(([k, v]) => !["branch", "sucursal", "device", "browser", "system"].includes(k) && typeof v === "string" && v.trim())
        .map(([, v]) => String(v).trim())
        .join(" · "),
      device: deviceSummary(parseRec(run.device), fieldsRec),
      progress,
      minsSinceSave,
      minsSinceSignal,
      failures: iss.length,
      blocking,
      openHelp: h ? { ...h, minsOpen: minutesSince(h.created_at, nowMs) ?? 0 } : null,
      state,
      rank,
      reason,
    };
  });
  rows.sort(
    (a, b) =>
      a.rank - b.rank ||
      // dentro del mismo grupo: el que lleva más tiempo sin guardar primero (terminadas: la más reciente primero)
      (a.rank >= MESA_STATE.ended_blocked.rank ? b.run.updated_at.localeCompare(a.run.updated_at) : b.minsSinceSave - a.minsSinceSave) ||
      a.run.name.localeCompare(b.run.name),
  );
  return { rows, at: nowMs };
}

/** "45 min", "1 h 20 min", "2 día(s)". */
export function fmtMinutes(m: number) {
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h${m % 60 ? ` ${Math.round(m % 60)} min` : ""}`;
  const d = Math.floor(h / 24);
  return `${d} día${d === 1 ? "" : "s"}`;
}

/** Título corto de la guía: "Manual del Cliente final" → "Cliente final". */
export const guideShortTitle = (id: string) => {
  const t = getGuide(id)?.title ?? id;
  return t.replace(/^Manual (del|de la|de) /i, "");
};

// ---------------------------------------------------------------------------------------------
// Mapa de testers (Mesa de control): una ficha por corrida, en orden de llegada

/**
 * blocked = pide ayuda, actividad en pausa por una falla bloqueante o terminada por bloqueo ·
 * active = avanzando · stalled = sin guardar > STALL_MIN · idle = aún no marca nada ·
 * abandoned = sin señal > ABANDON_MIN · finished = terminó la guía.
 */
export type QaTileKind = "blocked" | "active" | "stalled" | "idle" | "abandoned" | "finished";

export type QaTile = {
  id: string;
  name: string;
  guideId: string;
  guideTitle: string;
  branch: string;
  kind: QaTileKind;
  /** Por qué está bloqueado (vacío si no lo está). */
  blockedWhy: string;
  saved: number;
  total: number;
  pct: number;
  /** "E05 · Paso 3", "Sigue: E06", "Terminó"… */
  where: string;
  whereTitle: string;
  /** Última señal del tester (cualquier evento). */
  lastSignalAt: string;
  minsSinceSave: number;
};

/** Fichas del mapa de testers a partir de las filas de la Mesa (mismo filtro de guía). */
export function qaTiles(rows: MesaRow[]): QaTile[] {
  const db = getDb();
  const ids = new Set(rows.map((r) => r.run.id));
  const blockIss = (db
    .prepare("SELECT run_id, activity_id, step_id, created_at FROM issues WHERE kind = 'issue' AND blocking = 1 ORDER BY created_at DESC")
    .all() as { run_id: string; activity_id: string; step_id: string | null; created_at: string }[]).filter((i) => ids.has(i.run_id));
  const resolved = (db
    .prepare("SELECT run_id, activity_id, resolved_at FROM help_requests WHERE status = 'resolved'")
    .all() as { run_id: string; activity_id: string; resolved_at: string | null }[]).filter((h) => ids.has(h.run_id));
  const saved = (db.prepare("SELECT run_id, activity_id FROM activity_results WHERE result IS NOT NULL").all() as { run_id: string; activity_id: string }[])
    .filter((a) => ids.has(a.run_id));
  const savedKey = new Set(saved.map((a) => `${a.run_id}|${a.activity_id}`));
  const lastStep = new Map<string, { step_id: string; updated_at: string }>();
  for (const s of db.prepare("SELECT run_id, activity_id, step_id, updated_at FROM step_results ORDER BY updated_at").all() as {
    run_id: string;
    activity_id: string;
    step_id: string;
    updated_at: string;
  }[])
    if (ids.has(s.run_id)) lastStep.set(`${s.run_id}|${s.activity_id}`, s);
  const touched = new Set([...lastStep.keys()].map((k) => k.split("|")[0]));

  const stepLabel = (guideId: string, actId: string, stepId: string | null | undefined) => {
    const act = getGuide(guideId)?.activities.find((a) => a.id === actId);
    const i = stepId && act ? act.steps.findIndex((s) => s.id === stepId) : -1;
    return { label: i >= 0 ? `${actId} · Paso ${i + 1}` : actId, title: act?.title ?? "" };
  };

  // Orden fijo (de llegada) para que cada tester conserve su lugar en el mapa
  return [...rows]
    .sort((a, b) => a.run.created_at.localeCompare(b.run.created_at) || a.run.name.localeCompare(b.run.name))
    .map((r): QaTile => {
      const { run, progress } = r;
      const ended = r.state === "finished" || r.state === "ended_blocked";
      // Pausa: falla bloqueante en una actividad aún sin guardar y que el guía no ha destrabado después
      const pause = ended
        ? undefined
        : blockIss.find(
            (i) =>
              i.run_id === run.id &&
              !savedKey.has(`${run.id}|${i.activity_id}`) &&
              !resolved.some((h) => h.run_id === run.id && h.activity_id === i.activity_id && (h.resolved_at ?? "") >= i.created_at),
          );
      const kind: QaTileKind =
        r.openHelp || r.state === "ended_blocked" || pause
          ? "blocked"
          : r.state === "finished"
            ? "finished"
            : r.state === "abandoned"
              ? "abandoned"
              : r.state === "stalled"
                ? "stalled"
                : !progress.saved && !touched.has(run.id)
                  ? "idle"
                  : "active";
      const blockedWhy = r.openHelp
        ? `Pide ayuda · ${r.openHelp.minsOpen} min`
        : r.state === "ended_blocked"
          ? "Terminó por bloqueo"
          : pause
            ? "Falla bloqueante"
            : "";
      const c = progress.current;
      let where = "Sin empezar";
      let whereTitle = "";
      if (r.openHelp) ({ label: where, title: whereTitle } = stepLabel(run.guide_id, r.openHelp.activity_id, r.openHelp.step_id));
      else if (pause) ({ label: where, title: whereTitle } = stepLabel(run.guide_id, pause.activity_id, pause.step_id));
      else if (r.state === "finished") where = "Terminó la guía";
      else if (c) {
        const s = stepLabel(run.guide_id, c.id, lastStep.get(`${run.id}|${c.id}`)?.step_id);
        where = c.mode === "working" ? s.label : c.mode === "next" ? (progress.saved ? `Sigue: ${c.id}` : `Por empezar: ${c.id}`) : `Última: ${c.id}`;
        whereTitle = c.title;
      }
      return {
        id: run.id,
        name: run.name,
        guideId: run.guide_id,
        guideTitle: r.guideTitle,
        branch: r.branch,
        kind,
        blockedWhy,
        saved: progress.saved,
        total: progress.total,
        pct: progress.total ? Math.round((progress.saved / progress.total) * 100) : 0,
        where,
        whereTitle,
        lastSignalAt: run.updated_at,
        minsSinceSave: r.minsSinceSave,
      };
    });
}
