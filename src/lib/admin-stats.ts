import { getDb } from "./db";
import { getGuide, GUIDES } from "./guides";
import { loadRuns, parseRec, type RunRow } from "./admin-data";
import type { Guide } from "./types";
import { SEQ } from "./guide-utils";
import { umuxLite } from "./verdict";

/** Agregados para la página de gráficas del panel (/admin/graficas). */

export const RESULT_ORDER = ["ok", "issue", "blocked", "skipped"] as const;
export type ResultKey = (typeof RESULT_ORDER)[number];

/** `seq`: facilidad promedio (Single Ease Question, 1 a 7) de quienes la contestaron al cerrar la actividad. */
export type ActivityResultCounts = { id: string; title: string; counts: Record<ResultKey, number>; pending: number; seq: { n: number; avg: number | null } };
export type StepBlocked = { label: string; activity: string; text: string; count: number };
export type FailureCounts = { id: string; title: string; blocking: number; nonBlocking: number };
export type ScaleDist = { id: string; label: string; min: number; max: number; minLabel?: string; maxLabel?: string; counts: number[]; n: number; avg: number | null };
export type ChoiceDist = { id: string; label: string; options: { label: string; count: number }[]; n: number };
export type NpsDist = {
  id: string;
  label: string;
  counts: number[]; // 0..10
  n: number;
  promoters: number;
  passives: number;
  detractors: number;
  score: number | null;
  avg: number | null;
};
export type GuideStats = {
  guide: Guide;
  runs: number;
  activities: ActivityResultCounts[];
  survey: { responses: number; scales: ScaleDist[]; choices: ChoiceDist[]; nps: NpsDist[] };
};
export type Count = { label: string; count: number };
/** Comentario abierto (pregunta de texto) no vacío de una encuesta enviada. */
export type OpenComment = { runId: string; guideId: string; guideTitle: string; tester: string; questionId: string; questionLabel: string; text: string; at: string };

/** Máximo de comentarios abiertos que se muestran en /admin/graficas. */
export const OPEN_COMMENTS_LIMIT = 50;

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Lee filas de una tabla; si la tabla aún no existe (migración pendiente) regresa []. */
function safeAll<T>(sql: string): T[] {
  try {
    return getDb().prepare(sql).all() as T[];
  } catch {
    return [];
  }
}

export const family = (s: string) => {
  const t = s.replace(/\s*\(navegador interno\)/, "").trim();
  // Quita la versión: "Chrome 120.0.1" → "Chrome", "iOS 17.2" → "iOS", "Android 14" → "Android"
  return t.replace(/\s+[\d._]+.*$/, "").trim() || "Desconocido";
};

export function deviceKind(dev: Record<string, unknown>): string {
  const os = String(dev.os ?? "");
  const variant = String(dev.guideVariant ?? "");
  if (/iPad/.test(os)) return "Tableta";
  if (/Android|iOS/.test(os)) {
    const vw = Number(String(dev.viewport ?? "").split("x")[0]);
    return vw >= 768 ? "Tableta" : "Celular";
  }
  if (/Windows|macOS|Linux|Chrome OS|ChromeOS/.test(os)) return "Computadora";
  if (variant === "mobile") return "Celular";
  if (variant === "desktop") return "Computadora";
  return "Desconocido";
}

function tally(values: string[]): Count[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Agrupa a partir del 7.º lugar en "Otros" para no pasar de 7 barras. */
function foldOther(rows: Count[], max = 7): Count[] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1).reduce((n, r) => n + r.count, 0);
  return [...head, { label: "Otros", count: rest }];
}

function npsOf(id: string, label: string, values: number[]): NpsDist {
  const counts = Array.from({ length: 11 }, () => 0);
  const vals = values.map((v) => Math.round(v)).filter((v) => v >= 0 && v <= 10);
  for (const v of vals) counts[v]++;
  const promoters = vals.filter((v) => v >= 9).length;
  const detractors = vals.filter((v) => v <= 6).length;
  const passives = vals.length - promoters - detractors;
  return {
    id,
    label,
    counts,
    n: vals.length,
    promoters,
    passives,
    detractors,
    score: vals.length ? Math.round(((promoters - detractors) / vals.length) * 100) : null,
    avg: mean(vals),
  };
}

export function loadStats(guideId?: string | null) {
  const runs = loadRuns(guideId);
  const ids = new Set(runs.map((r) => r.id));
  const keep = <T extends { run_id: string }>(rows: T[]) => rows.filter((r) => ids.has(r.run_id));
  const steps = keep(safeAll<{ run_id: string; activity_id: string; step_id: string; outcome: string }>("SELECT run_id, activity_id, step_id, outcome FROM step_results"));
  const acts = keep(safeAll<{ run_id: string; activity_id: string; result: string | null; fields: string }>("SELECT run_id, activity_id, result, fields FROM activity_results"));
  const issues = keep(safeAll<{ run_id: string; activity_id: string; step_id: string | null; kind: string; blocking: number }>("SELECT run_id, activity_id, step_id, kind, blocking FROM issues"));
  const surveys = keep(safeAll<{ run_id: string; answers: string; updated_at: string }>("SELECT run_id, answers, updated_at FROM survey_responses WHERE is_draft = 0"));
  const runById = new Map<string, RunRow>(runs.map((r) => [r.id, r]));

  // Guías presentes, en el orden del registro
  const guides = GUIDES.filter((g) => (guideId ? g.id === guideId : runs.some((r) => r.guide_id === g.id)));
  const runsOf = (gid: string) => new Set(runs.filter((r) => r.guide_id === gid).map((r) => r.id));

  // ---- KPIs
  const failures = issues.filter((i) => i.kind !== "evidence");
  const allNps: number[] = [];
  // SUS equivalente de UMUX-Lite (umux1 y umux2, escala 1–7), mismo criterio que verdict.ts
  const allSus: number[] = [];
  const comments: OpenComment[] = [];
  for (const s of surveys) {
    const run = runById.get(s.run_id);
    const g = getGuide(run?.guide_id ?? "");
    if (!g) continue;
    const ans = parseRec(s.answers);
    for (const q of g.survey.questions) {
      if (q.type === "text") {
        const t = ans[q.id];
        if (typeof t === "string" && t.trim() !== "")
          comments.push({
            runId: s.run_id,
            guideId: g.id,
            guideTitle: g.title,
            tester: (run?.name || run?.email || "").trim() || "Sin nombre",
            questionId: q.id,
            questionLabel: q.label,
            text: t.trim(),
            at: s.updated_at,
          });
        continue;
      }
      const v = num(ans[q.id]);
      if (v === null) continue;
      if (q.type === "nps") allNps.push(v);
    }
    const u1 = num(ans.umux1);
    const u2 = num(ans.umux2);
    if (u1 !== null && u2 !== null && u1 >= 1 && u1 <= 7 && u2 >= 1 && u2 <= 7) allSus.push(umuxLite(u1, u2).sus);
  }
  comments.sort((a, b) => b.at.localeCompare(a.at));
  const npsAll = npsOf("all", "", allNps);
  // El KPI de NPS sólo tiene sentido si alguna guía (en el filtro actual) pregunta NPS
  const scope = guideId ? GUIDES.filter((g) => g.id === guideId) : GUIDES;
  const hasNpsQuestion = scope.some((g) => g.survey.questions.some((q) => q.type === "nps"));
  const kpis = {
    testers: new Set(runs.map((r) => (r.email || r.name || r.id).trim().toLowerCase())).size,
    runs: runs.length,
    finished: runs.filter((r) => r.status === "finished").length,
    inProgress: runs.filter((r) => r.status === "in_progress").length,
    endedBlocked: runs.filter((r) => r.status === "ended_blocked").length,
    failures: failures.length,
    blocking: failures.filter((i) => i.blocking).length,
    nps: npsAll.score,
    npsAvg: npsAll.avg,
    npsN: npsAll.n,
    hasNps: hasNpsQuestion || npsAll.n > 0,
    susAvg: mean(allSus),
    susN: allSus.length,
  };
  const openComments = { total: comments.length, items: comments.slice(0, OPEN_COMMENTS_LIMIT) };

  // ---- Por guía: resultados por actividad y encuesta
  const perGuide: GuideStats[] = guides.map((g) => {
    const rids = runsOf(g.id);
    const activities = g.activities.map((a) => {
      const res = acts.filter((x) => x.activity_id === a.id && rids.has(x.run_id));
      const counts = Object.fromEntries(RESULT_ORDER.map((k) => [k, res.filter((x) => x.result === k).length])) as Record<ResultKey, number>;
      const answered = RESULT_ORDER.reduce((n, k) => n + counts[k], 0);
      const seqVals = res
        .filter((x) => x.result)
        .map((x) => num(parseRec(x.fields)[SEQ.field]))
        .filter((v): v is number => v !== null && v >= SEQ.min && v <= SEQ.max);
      return { id: a.id, title: a.title, counts, pending: Math.max(0, rids.size - answered), seq: { n: seqVals.length, avg: mean(seqVals) } };
    });
    const answers = surveys.filter((s) => rids.has(s.run_id)).map((s) => parseRec(s.answers));
    const scales: ScaleDist[] = [];
    const choices: ChoiceDist[] = [];
    const nps: NpsDist[] = [];
    for (const q of g.survey.questions) {
      if (q.type === "scale") {
        const min = q.min ?? 1;
        const max = q.max ?? 5;
        const vals = answers.map((a) => num(a[q.id])).filter((v): v is number => v !== null && v >= min && v <= max).map(Math.round);
        const counts = Array.from({ length: max - min + 1 }, (_, i) => vals.filter((v) => v === min + i).length);
        scales.push({ id: q.id, label: q.label, min, max, minLabel: q.minLabel, maxLabel: q.maxLabel, counts, n: vals.length, avg: mean(vals) });
      } else if (q.type === "nps") {
        nps.push(npsOf(q.id, q.label, answers.map((a) => num(a[q.id])).filter((v): v is number => v !== null)));
      } else if (q.type === "choice") {
        const vals = answers.map((a) => a[q.id]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
        const known = q.options ?? [];
        const options = known.map((o) => ({ label: o, count: vals.filter((v) => v === o).length }));
        const other = vals.filter((v) => !known.includes(v)).length;
        if (other) options.push({ label: "Otra respuesta", count: other });
        choices.push({ id: q.id, label: q.label, options, n: vals.length });
      }
    }
    return { guide: g, runs: rids.size, activities, survey: { responses: answers.length, scales, choices, nps } };
  });

  // ---- Pasos con más "No pude" (outcome = fail)
  const stepText = new Map<string, string>();
  const order = new Map<string, number>();
  let idx = 0;
  for (const g of guides)
    for (const a of g.activities) {
      order.set(a.id, idx++);
      for (const s of a.steps) stepText.set(`${a.id}|${s.id}`, s.text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim());
    }
  const failMap = new Map<string, number>();
  for (const s of steps) if (s.outcome === "fail") failMap.set(`${s.activity_id}|${s.step_id}`, (failMap.get(`${s.activity_id}|${s.step_id}`) ?? 0) + 1);
  const topBlockedSteps: StepBlocked[] = [...failMap.entries()]
    .map(([k, count]) => {
      const [activity, step] = k.split("|");
      return { label: `${activity} · ${step}`, activity, text: stepText.get(k) ?? "", count };
    })
    .sort((a, b) => b.count - a.count || (order.get(a.activity) ?? 999) - (order.get(b.activity) ?? 999) || a.label.localeCompare(b.label))
    .slice(0, 10);

  // ---- Fallas por actividad (bloqueantes / no bloqueantes), en orden de la guía
  const failuresByActivity: FailureCounts[] = [];
  for (const g of guides)
    for (const a of g.activities) {
      const f = failures.filter((i) => i.activity_id === a.id && runById.get(i.run_id)?.guide_id === g.id);
      if (!f.length) continue;
      const blocking = f.filter((i) => i.blocking).length;
      failuresByActivity.push({ id: a.id, title: a.title, blocking, nonBlocking: f.length - blocking });
    }

  // ---- Dispositivos
  const devs = runs.map((r) => parseRec(r.device));
  const devices = {
    kind: tally(devs.map(deviceKind)),
    os: foldOther(tally(devs.map((d) => family(String(d.os ?? ""))))),
    browser: foldOther(tally(devs.map((d) => family(String(d.browser ?? ""))))),
  };

  // ---- Corridas por día (zona horaria de México)
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const byDay = new Map<string, number>();
  for (const r of runs) byDay.set(dayKey(r.created_at), (byDay.get(dayKey(r.created_at)) ?? 0) + 1);
  const days = [...byDay.keys()].sort();
  const runsByDay: Count[] = [];
  if (days.length) {
    // Rellena los días sin corridas para que el eje de tiempo sea continuo (máx. 60 días)
    const start = new Date(days[0] + "T12:00:00Z");
    const end = new Date(days[days.length - 1] + "T12:00:00Z");
    for (let t = start; t <= end && runsByDay.length < 60; t = new Date(t.getTime() + 86400000)) {
      const k = t.toISOString().slice(0, 10);
      runsByDay.push({ label: k, count: byDay.get(k) ?? 0 });
    }
    if (runsByDay.length === 60) runsByDay.splice(0, runsByDay.length, ...days.slice(-60).map((k) => ({ label: k, count: byDay.get(k)! })));
  }

  return { kpis, perGuide, openComments, topBlockedSteps, failuresByActivity, devices, runsByDay };
}

export type Stats = ReturnType<typeof loadStats>;
