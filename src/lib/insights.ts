import { getDb } from "./db";
import { getGuide, GUIDES } from "./guides";
import { expectedText, NOT_APPLICABLE } from "./guide-utils";
import {
  ABANDON_MIN, checkValue, fmtMinutes, guideShortTitle, liveState, loadRuns, minutesSince, parseRec, runProgress,
  type HelpRow, type LiveState, type RunRow,
} from "./admin-data";
import { family } from "./admin-stats";
import { COURIER_QUESTIONS } from "./courier";
import { courierStats, loadCourier } from "./courier-data";
import type { Guide } from "./types";

/**
 * Resumen automático: frases en español con números concretos, calculadas con reglas fijas
 * (sin IA) a partir de la base. Se usan arriba de /admin, en /admin/graficas, en la hoja
 * «Resumen» del Excel y en el CSV «insights».
 */

export type InsightSeverity = "critical" | "warning" | "ok" | "info";
export type InsightCategory =
  | "avance"
  | "participacion"
  | "dispositivos"
  | "actividades"
  | "pasos"
  | "fallas"
  | "tiempos"
  | "encuesta"
  | "repartidores";

export type Insight = {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  text: string;
  /** Guía a la que se refiere (título corto), cuando hay varias guías en el resumen. */
  guide?: string;
};

export const INSIGHT_CATEGORIES: { id: InsightCategory; label: string }[] = [
  { id: "avance", label: "Avance y conclusión" },
  { id: "participacion", label: "Participación" },
  { id: "dispositivos", label: "Dispositivos" },
  { id: "actividades", label: "Actividades" },
  { id: "pasos", label: "Pasos y resultados esperados" },
  { id: "fallas", label: "Fallas y ayuda" },
  { id: "tiempos", label: "Tiempos" },
  { id: "encuesta", label: "Encuesta" },
  { id: "repartidores", label: "Repartidores" },
];

export const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  critical: "Crítico",
  warning: "Atención",
  ok: "Bien",
  info: "Dato",
};

// ---- Umbrales
const SMALL_SAMPLE = 5;
const INCONCLUSIVE_ABANDON = 0.3;
const ENOUGH_FINISHED = 0.7;
const FREQUENT = 0.3; // «No aplica» / «No me apareció» frecuentes
const MAX_ACTIVITY_MIN = 180; // tiempos por actividad más largos se descartan (pausas, ediciones tardías)

// ---- Utilidades de texto
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
/** "3 de 9 testers (33%)" */
const of = (a: number, b: number, noun = "testers") => `${a} de ${b} ${noun} (${pct(a, b)}%)`;
/** Verbo en singular o plural según n. */
const vb = (n: number, one: string, many: string) => (n === 1 ? one : many);
const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nf1 = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
/** "a, b y c" (con «e» antes de i-/hi-: «Android e iOS»). */
function list(xs: string[]) {
  if (xs.length <= 1) return xs[0] ?? "";
  const last = xs[xs.length - 1];
  const y = /^(h?i(?![aeoáéó])|iOS)/i.test(last) ? "e" : "y";
  return `${xs.slice(0, -1).join(", ")} ${y} ${last}`;
}
const clean = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
const clip = (s: string, n = 70) => {
  const t = clean(s);
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const actLabel = (id: string, title?: string) => (title ? `${id} «${clip(title, 50)}»` : id);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const rateSeverity = (rate: number): InsightSeverity => (rate >= 0.5 ? "critical" : rate >= 0.25 ? "warning" : "info");

/** Familia del sistema operativo de un dispositivo detectado. */
export function osFamily(dev: Record<string, unknown>): string {
  const os = String(dev.os ?? "");
  if (/Android/i.test(os)) return "Android";
  if (/iOS|iPadOS|iPhone|iPad/i.test(os)) return "iOS";
  if (/Windows/i.test(os)) return "Windows";
  if (/mac/i.test(os)) return "macOS";
  if (/Chrome ?OS/i.test(os)) return "ChromeOS";
  if (/Linux/i.test(os)) return "Linux";
  return "Desconocido";
}
const MOBILE_OS = new Set(["Android", "iOS"]);

function safeAll<T>(sql: string): T[] {
  try {
    return getDb().prepare(sql).all() as T[];
  } catch {
    return [];
  }
}

function tally<T extends string>(values: T[]) {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

type ActRow = { run_id: string; activity_id: string; result: string | null; checks: string; updated_at: string };
type StepRow = { run_id: string; activity_id: string; step_id: string; outcome: string; updated_at: string };
type IssueRow = { run_id: string; activity_id: string; step_id: string | null; kind: string; blocking: number };

/** Calcula el resumen automático (opcionalmente solo de una guía). Determinista. */
export function computeInsights(guideId?: string | null, nowMs = Date.now()): Insight[] {
  const out: Insight[] = [];
  const add = (category: InsightCategory, severity: InsightSeverity, text: string, guide?: string) =>
    out.push({ id: `${category}-${out.length}`, category, severity, text, guide });

  const runs = loadRuns(guideId);
  const ids = new Set(runs.map((r) => r.id));
  const keep = <T extends { run_id: string }>(rows: T[]) => rows.filter((r) => ids.has(r.run_id));
  const acts = keep(safeAll<ActRow>("SELECT run_id, activity_id, result, checks, updated_at FROM activity_results"));
  const steps = keep(safeAll<StepRow>("SELECT run_id, activity_id, step_id, outcome, updated_at FROM step_results"));
  const issues = keep(safeAll<IssueRow>("SELECT run_id, activity_id, step_id, kind, blocking FROM issues"));
  const help = keep(safeAll<HelpRow>("SELECT * FROM help_requests"));
  const surveys = keep(safeAll<{ run_id: string; answers: string }>("SELECT run_id, answers FROM survey_responses WHERE is_draft = 0"));
  const runById = new Map(runs.map((r) => [r.id, r]));
  const guides = GUIDES.filter((g) => runs.some((r) => r.guide_id === g.id));
  const multi = guides.length > 1;
  const tag = (g: Guide) => (multi ? guideShortTitle(g.id) : undefined);
  const runsOf = (gid: string) => runs.filter((r) => r.guide_id === gid);
  const n = runs.length;

  if (n === 0) {
    add("avance", "info", guideId ? `Todavía no hay pruebas de ${guideShortTitle(guideId)}.` : "Todavía no hay pruebas registradas.");
  } else {
    // ------------------------------------------------------------------ Avance y conclusión
    const state = new Map<string, LiveState>(runs.map((r) => [r.id, liveState(r, nowMs)]));
    const count = (s: LiveState) => runs.filter((r) => state.get(r.id) === s).length;
    const finished = count("finished");
    const active = count("active");
    const abandoned = count("abandoned");
    const endedBlocked = count("ended_blocked");
    const abandonRate = abandoned / n;
    const finishedRate = finished / n;

    if (abandoned && abandonRate >= INCONCLUSIVE_ABANDON) {
      add("avance", "critical", `La prueba no es concluyente por la tasa de abandono (${pct(abandoned, n)}%, ${abandoned} de ${n} testers).`);
    } else if (n < SMALL_SAMPLE) {
      add("avance", "warning", `Muestra pequeña: con solo ${pl(n, "tester")} los porcentajes cambian mucho con una sola persona; tómalos como señales, no como conclusiones.`);
    } else if (finishedRate >= ENOUGH_FINISHED) {
      add("avance", "ok", `Resultados suficientes: ${of(finished, n)} ${vb(finished, "terminó", "terminaron")} la prueba.`);
    } else if (active) {
      add("avance", "info", `La prueba sigue en curso (${pl(active, "tester activo", "testers activos")}); espera a que terminen antes de sacar conclusiones.`);
    } else {
      add("avance", "warning", `Resultados parciales: solo ${of(finished, n)} ${vb(finished, "terminó", "terminaron")} la prueba.`);
    }
    if (abandoned && abandonRate >= INCONCLUSIVE_ABANDON && n < SMALL_SAMPLE) {
      add("avance", "warning", `Además la muestra es pequeña (${pl(n, "tester")}).`);
    }

    const parts = [
      `${finished} ${finished === 1 ? "terminada" : "terminadas"}`,
      active ? `${active} en curso` : "",
      abandoned ? `${abandoned} ${abandoned === 1 ? "abandonada" : "abandonadas"}` : "",
      endedBlocked ? `${endedBlocked} ${endedBlocked === 1 ? "terminada" : "terminadas"} por bloqueo` : "",
    ].filter(Boolean);
    add("avance", "info", `Estado de las ${pl(n, "prueba")}: ${list(parts)}.`);

    if (abandoned) {
      // Dónde se quedaron los que abandonaron
      const stops = tally(
        runs
          .filter((r) => state.get(r.id) === "abandoned")
          .map((r) => {
            const p = runProgress(
              r.guide_id,
              acts.filter((a) => a.run_id === r.id),
              steps.filter((s) => s.run_id === r.id),
            );
            return p.current ? actLabel(p.current.id, p.current.title) : "el inicio";
          }),
      );
      const where =
        stops[0] && stops[0][1] > 1
          ? ` El punto de abandono más común fue ${stops[0][0]} (${stops[0][1]} de ${abandoned}).`
          : abandoned === 1
            ? ` Se quedó en ${stops[0][0]}.`
            : stops.length <= 4
              ? ` Se quedaron en ${list(stops.map(([w]) => w.split(" ")[0]))}.`
              : "";
      add(
        "avance",
        abandonRate >= INCONCLUSIVE_ABANDON ? "critical" : "warning",
        `Se detectó que un ${pct(abandoned, n)}% de los testers (${abandoned} de ${n}) abandonaron: llevan más de ${ABANDON_MIN} min sin actividad y no terminaron.${where}`,
      );
    }
    if (endedBlocked) {
      add("avance", "warning", `${endedBlocked === 1 ? "1 prueba se terminó" : `${endedBlocked} pruebas se terminaron`} antes de tiempo por un bloqueo (${pct(endedBlocked, n)}%).`);
    }

    // ------------------------------------------------------------------ Participación
    const testerKey = (r: RunRow) => (r.email || r.name || r.id).trim().toLowerCase();
    const testers = new Set(runs.map(testerKey)).size;
    const byGuide = guides.map((g) => `${runsOf(g.id).length} en ${guideShortTitle(g.id)}`);
    add(
      "participacion",
      "info",
      `Participaron ${pl(testers, "tester")}${testers !== n ? ` en ${pl(n, "corrida")}` : ""}${multi ? `: ${list(byGuide)}` : guides[0] ? ` en ${guideShortTitle(guides[0].id)}` : ""}.`,
    );
    const roles = tally(runs.map((r) => r.role || "Sin rol"));
    if (roles.length > 1) add("participacion", "info", `Por rol: ${list(roles.map(([r, c]) => `${c} ${r}`))}.`);
    const branches = tally(
      runs.map((r) => String(parseRec(r.tester_fields).branch ?? "").trim()).filter(Boolean) as string[],
    );
    if (branches.length) {
      const names = branches.slice(0, 5).map(([b, c]) => (c > 1 ? `${b} (${c})` : b));
      add(
        "participacion",
        "info",
        `${branches.length === 1 ? "Participó 1 sucursal" : `Participaron ${branches.length} sucursales`}: ${list(branches.length > 5 ? [...names, `${branches.length - 5} más`] : names)}.`,
      );
    }
    const finishedSurvey = surveys.length;
    if (finished || finishedSurvey) {
      add("participacion", "info", `${of(finishedSurvey, n)} ${vb(finishedSurvey, "contestó", "contestaron")} la encuesta final.`);
    }

    // ------------------------------------------------------------------ Dispositivos
    const devs = new Map(runs.map((r) => [r.id, parseRec(r.device)]));
    const osOf = (runId: string) => osFamily(devs.get(runId) ?? {});
    const osCounts = tally(runs.map((r) => osOf(r.id)));
    const mobile = osCounts.filter(([o]) => MOBILE_OS.has(o));
    const desktop = osCounts.filter(([o]) => !MOBILE_OS.has(o) && o !== "Desconocido");
    const unknown = osCounts.find(([o]) => o === "Desconocido")?.[1] ?? 0;
    const desktopN = desktop.reduce((s, [, c]) => s + c, 0);
    const devParts = [
      ...mobile.map(([o, c], i) => (i === 0 ? `${c} ${c === 1 ? "usuario" : "usuarios"} de ${o}` : `${c} de ${o}`)),
      desktopN ? `${desktopN} en computadora (${list(desktop.map(([o, c]) => `${c} ${o}`))})` : "",
      unknown ? `${unknown} sin identificar` : "",
    ].filter(Boolean);
    add("dispositivos", "info", `Dados los datos se tuvieron ${list(devParts)}.`);
    const tablets = runs.filter((r) => {
      const d = devs.get(r.id) ?? {};
      return /iPad/i.test(String(d.os ?? "")) || (MOBILE_OS.has(osOf(r.id)) && Number(String(d.viewport ?? "").split("x")[0]) >= 768);
    }).length;
    if (tablets) add("dispositivos", "info", `${tablets === 1 ? "1 tester usó" : `${tablets} testers usaron`} tableta (iPad o similar).`);
    const browsers = tally(runs.map((r) => family(String(devs.get(r.id)?.browser ?? ""))).filter((b) => b !== "Otro" && b !== "Desconocido"));
    if (browsers.length) add("dispositivos", "info", `Navegadores: ${list(browsers.slice(0, 5).map(([b, c]) => `${b} ${c}`))}${browsers.length > 5 ? " y otros" : ""}.`);
    const inApp = runs.filter((r) => /navegador interno/.test(String(devs.get(r.id)?.browser ?? ""))).length;
    if (inApp) {
      add("dispositivos", "warning", `${inApp === 1 ? "1 tester abrió" : `${inApp} testers abrieron`} la guía desde el navegador interno de otra app (WhatsApp, Facebook…), donde fotos y descargas pueden fallar.`);
    }

    // Fallas concentradas en un sistema
    for (const g of guides) {
      const gRuns = runsOf(g.id);
      const osShare = new Map(tally(gRuns.map((r) => osOf(r.id))));
      for (const a of g.activities) {
        const f = issues.filter((i) => i.kind !== "evidence" && i.activity_id === a.id && runById.get(i.run_id)?.guide_id === g.id);
        if (f.length < 3) continue;
        const [topOs, topN] = tally(f.map((i) => osOf(i.run_id)))[0];
        if (topOs === "Desconocido") continue;
        const usersOnOs = osShare.get(topOs) ?? 0;
        if (topN / f.length >= 0.7 && usersOnOs / gRuns.length <= topN / f.length - 0.2) {
          add(
            "dispositivos",
            "warning",
            `${topN} de ${f.length} fallas en ${actLabel(a.id, a.title)} fueron en ${topOs}, aunque solo ${usersOnOs} de ${gRuns.length} testers usan ${topOs}: posible problema específico de ${topOs}.`,
            tag(g),
          );
        }
      }
    }

    // ------------------------------------------------------------------ Actividades
    type ActStat = { g: Guide; id: string; title: string; n: number; issue: number; blocked: number; skipped: number; reports: number };
    const actStats: ActStat[] = [];
    let unknownRows = 0;
    const unknownIds = new Set<string>();
    for (const g of guides) {
      const gIds = new Set(runsOf(g.id).map((r) => r.id));
      const known = new Set(g.activities.map((a) => a.id));
      for (const x of acts) {
        if (gIds.has(x.run_id) && !known.has(x.activity_id)) {
          unknownRows++;
          unknownIds.add(x.activity_id);
        }
      }
      for (const a of g.activities) {
        const res = acts.filter((x) => x.activity_id === a.id && gIds.has(x.run_id));
        actStats.push({
          g,
          id: a.id,
          title: a.title,
          n: gIds.size,
          issue: res.filter((x) => x.result === "issue").length,
          blocked: res.filter((x) => x.result === "blocked").length,
          skipped: res.filter((x) => x.result === "skipped").length,
          reports: issues.filter((i) => i.kind !== "evidence" && i.activity_id === a.id && gIds.has(i.run_id)).length,
        });
      }
    }
    const troubled = actStats
      .filter((s) => s.issue + s.blocked > 0)
      .sort((a, b) => b.issue + b.blocked - (a.issue + a.blocked) || (b.issue + b.blocked) / b.n - (a.issue + a.blocked) / a.n);
    for (const s of troubled.slice(0, 3)) {
      const bits = [
        s.issue ? `${of(s.issue, s.n)} ${vb(s.issue, "tuvo", "tuvieron")} alguna falla` : "",
        s.blocked ? `${s.issue ? `${s.blocked} (${pct(s.blocked, s.n)}%)` : of(s.blocked, s.n)} ${vb(s.blocked, "marcó", "marcaron")} «No pude hacerla»` : "",
      ].filter(Boolean);
      add(
        "actividades",
        rateSeverity((s.issue + s.blocked) / s.n),
        `${actLabel(s.id, s.title)}: ${list(bits)}${s.reports ? ` (${pl(s.reports, "reporte")} de falla)` : ""}.`,
        tag(s.g),
      );
    }
    if (!troubled.length && acts.some((x) => x.result)) add("actividades", "ok", "Ninguna actividad guardada se marcó con falla ni como «No pude hacerla».");
    const mostBlocked = [...actStats].filter((s) => s.blocked >= 2).sort((a, b) => b.blocked - a.blocked)[0];
    if (mostBlocked && !troubled.slice(0, 3).includes(mostBlocked)) {
      add("actividades", rateSeverity(mostBlocked.blocked / mostBlocked.n), `${actLabel(mostBlocked.id, mostBlocked.title)}: ${of(mostBlocked.blocked, mostBlocked.n)} no pudieron hacerla.`, tag(mostBlocked.g));
    }
    const skippedMost = [...actStats].filter((s) => s.skipped >= 2 && s.skipped / s.n >= FREQUENT).sort((a, b) => b.skipped - a.skipped)[0];
    if (skippedMost) {
      add("actividades", "info", `${actLabel(skippedMost.id, skippedMost.title)}: ${of(skippedMost.skipped, skippedMost.n)} marcaron «No me tocó».`, tag(skippedMost.g));
    }
    if (unknownRows) {
      add(
        "actividades",
        "info",
        `Se ignoraron ${pl(unknownRows, "registro")} de ${unknownIds.size === 1 ? "la actividad" : "actividades"} ${list([...unknownIds].sort())}, que ya no ${unknownIds.size === 1 ? "está" : "están"} en la guía (corridas anteriores).`,
      );
    }

    // ------------------------------------------------------------------ Pasos y resultados esperados
    type StepStat = { g: Guide; actId: string; idx: number; text: string; n: number; fail: number; na: number; answered: number };
    const stepStats: StepStat[] = [];
    for (const g of guides) {
      const gIds = new Set(runsOf(g.id).map((r) => r.id));
      for (const a of g.activities) {
        const rows = steps.filter((s) => s.activity_id === a.id && gIds.has(s.run_id));
        a.steps.forEach((st, idx) => {
          const r = rows.filter((x) => x.step_id === st.id);
          if (!r.length) return;
          stepStats.push({
            g,
            actId: a.id,
            idx,
            text: st.text,
            n: gIds.size,
            fail: r.filter((x) => x.outcome === "fail").length,
            na: r.filter((x) => x.outcome !== "ok" && x.outcome !== "fail").length,
            answered: r.length,
          });
        });
      }
    }
    const failSteps = stepStats.filter((s) => s.fail > 0).sort((a, b) => b.fail - a.fail || b.fail / b.n - a.fail / a.n);
    failSteps.slice(0, 3).forEach((s, i) => {
      add(
        "pasos",
        rateSeverity(s.fail / s.n),
        `${i === 0 ? "Paso más difícil: " : ""}${s.actId} paso ${s.idx + 1} «${clip(s.text)}» — ${of(s.fail, s.n)} ${vb(s.fail, "marcó", "marcaron")} «No pude».`,
        tag(s.g),
      );
    });
    if (!failSteps.length && stepStats.length) add("pasos", "ok", "Ningún paso se marcó con «No pude».");
    stepStats
      .filter((s) => s.na >= 2 && s.na / s.answered >= FREQUENT)
      .sort((a, b) => b.na - a.na)
      .slice(0, 2)
      .forEach((s) =>
        add(
          "pasos",
          "info",
          `${s.actId} paso ${s.idx + 1} «${clip(s.text)}»: ${s.na} de ${s.answered} testers ${vb(s.na, "marcó", "marcaron")} «No me apareció»; revisa si ese paso sigue haciendo falta.`,
          tag(s.g),
        ),
      );

    // Resultados esperados: «No» y «No aplica»
    type ExpStat = { g: Guide; actId: string; text: string; no: number; na: number; answered: number };
    const expStats: ExpStat[] = [];
    for (const g of guides) {
      const gIds = new Set(runsOf(g.id).map((r) => r.id));
      for (const a of g.activities) {
        const rows = acts.filter((x) => x.activity_id === a.id && gIds.has(x.run_id) && x.result).map((x) => parseRec(x.checks));
        if (!rows.length) continue;
        a.expected.forEach((e, i) => {
          const t = expectedText(e);
          const vals = rows.map((c) => checkValue(c, i, t)).filter((v) => v !== undefined);
          if (!vals.length) return;
          expStats.push({ g, actId: a.id, text: t, no: vals.filter((v) => v === false).length, na: vals.filter((v) => v === NOT_APPLICABLE).length, answered: vals.length });
        });
      }
    }
    expStats
      .filter((s) => s.no > 0)
      .sort((a, b) => b.no - a.no || b.no / b.answered - a.no / a.answered)
      .slice(0, 3)
      .forEach((s, i) =>
        add(
          "pasos",
          s.no / s.answered >= 0.5 ? "critical" : s.no / s.answered >= FREQUENT ? "warning" : "info",
          `${i === 0 ? "Resultado esperado que más falló: " : ""}${s.actId} «${clip(s.text)}» no se cumplió para ${s.no} de ${s.answered} testers (${pct(s.no, s.answered)}%).`,
          tag(s.g),
        ),
      );
    expStats
      .filter((s) => s.na >= 2 && s.na / s.answered >= FREQUENT)
      .sort((a, b) => b.na - a.na)
      .slice(0, 2)
      .forEach((s) => add("pasos", "info", `${s.actId} «${clip(s.text)}» se marcó «No aplica» en ${s.na} de ${s.answered} respuestas.`, tag(s.g)));

    // ------------------------------------------------------------------ Fallas y ayuda
    const failures = issues.filter((i) => i.kind !== "evidence");
    const blocking = failures.filter((i) => i.blocking);
    const reporters = new Set(failures.map((i) => i.run_id)).size;
    if (failures.length) {
      add(
        "fallas",
        blocking.length ? "warning" : "info",
        `${vb(failures.length, "Se reportó", "Se reportaron")} ${pl(failures.length, "falla")}${blocking.length ? ` (${blocking.length} ${blocking.length === 1 ? "bloqueante" : "bloqueantes"})` : ""} por ${of(reporters, n)}.`,
      );
    } else if (acts.some((x) => x.result)) {
      add("fallas", "ok", "No se ha reportado ninguna falla.");
    }
    if (blocking.length) {
      const top = tally(blocking.map((i) => `${runById.get(i.run_id)?.guide_id}|${i.activity_id}`))[0];
      const [gid, aid] = top[0].split("|");
      const a = getGuide(gid)?.activities.find((x) => x.id === aid);
      const where = `${actLabel(aid, a?.title)}${multi ? ` de ${guideShortTitle(gid)}` : ""}`;
      add(
        "fallas",
        "critical",
        `${pl(blocking.length, "falla bloqueante", "fallas bloqueantes")} en ${pl(new Set(blocking.map((i) => i.run_id)).size, "tester")}${
          top[1] > 1 ? (top[1] / blocking.length >= 0.5 ? `; se concentran en ${where} (${top[1]} de ${blocking.length})` : `; la actividad con más es ${where} (${top[1]})`) : ""
        }.`,
      );
    }
    if (help.length) {
      const open = help.filter((h) => h.status === "open");
      const resolved = help.filter((h) => h.status === "resolved");
      const ended = help.filter((h) => h.status === "ended");
      const parts = [
        resolved.length ? `${resolved.length} ${resolved.length === 1 ? "resuelta" : "resueltas"}` : "",
        ended.length ? `${ended.length} ${ended.length === 1 ? "terminó" : "terminaron"} la prueba` : "",
        open.length ? `${open.length} ${open.length === 1 ? "abierta" : "abiertas"}` : "",
      ].filter(Boolean);
      add("fallas", open.length ? "warning" : "info", `Se pidió ayuda al guía ${help.length === 1 ? "1 vez" : `${help.length} veces`}: ${list(parts)}.`);
      if (open.length) {
        const oldest = Math.max(...open.map((h) => minutesSince(h.created_at, nowMs) ?? 0));
        add(
          "fallas",
          "critical",
          `${open.length === 1 ? "1 solicitud de ayuda sigue abierta" : `${open.length} solicitudes de ayuda siguen abiertas`}; ${open.length === 1 ? "lleva" : "la más antigua lleva"} ${fmtMinutes(oldest)} esperando.`,
        );
      }
      const waits = resolved.filter((h) => h.resolved_at).map((h) => (new Date(h.resolved_at!).getTime() - new Date(h.created_at).getTime()) / 60_000);
      const med = median(waits.filter((w) => w >= 0));
      if (med !== null && waits.length >= 2) {
        add("fallas", med > 15 ? "warning" : "info", `Las ayudas resueltas se atendieron en una mediana de ${fmtMinutes(Math.max(1, Math.round(med)))}.`);
      }
    }

    // ------------------------------------------------------------------ Tiempos
    for (const g of guides) {
      const gIds = new Set(runsOf(g.id).map((r) => r.id));
      const durations = g.activities
        .map((a) => {
          const ds: number[] = [];
          for (const x of acts) {
            if (x.activity_id !== a.id || !gIds.has(x.run_id) || !x.result || x.result === "skipped") continue;
            const marks = steps.filter((s) => s.run_id === x.run_id && s.activity_id === a.id).map((s) => new Date(s.updated_at).getTime());
            if (!marks.length) continue;
            const d = (new Date(x.updated_at).getTime() - Math.min(...marks)) / 60_000;
            if (d > 0 && d <= MAX_ACTIVITY_MIN) ds.push(d);
          }
          return { a, n: ds.length, med: median(ds) };
        })
        .filter((x): x is { a: (typeof g.activities)[number]; n: number; med: number } => x.med !== null && x.n >= 2);
      if (durations.length >= 2) {
        const longest = [...durations].sort((a, b) => b.med - a.med).slice(0, 3);
        add(
          "tiempos",
          "info",
          `Actividades más largas (tiempo típico, mediana): ${list(longest.map((d) => `${d.a.id} ${fmtMinutes(Math.max(1, Math.round(d.med)))}`))}.`,
          tag(g),
        );
      }
      const total = runsOf(g.id)
        .filter((r) => r.status === "finished" && r.finished_at)
        .map((r) => (new Date(r.finished_at!).getTime() - new Date(r.created_at).getTime()) / 60_000)
        .filter((d) => d > 0);
      const med = median(total);
      if (med !== null) {
        add(
          "tiempos",
          "info",
          `${total.length === 1 ? "La prueba terminada duró" : `Las ${total.length} pruebas terminadas duraron en mediana`} ${fmtMinutes(Math.round(med))} de inicio a fin.`,
          tag(g),
        );
      }
    }

    // ------------------------------------------------------------------ Encuesta
    for (const g of guides) {
      const gIds = new Set(runsOf(g.id).map((r) => r.id));
      const answers = surveys.filter((s) => gIds.has(s.run_id)).map((s) => parseRec(s.answers));
      if (!answers.length) continue;
      const small = answers.length < SMALL_SAMPLE ? ` (solo ${pl(answers.length, "respuesta")})` : "";
      const scales = g.survey.questions
        .filter((q) => q.type === "scale")
        .map((q) => {
          const min = q.min ?? 1;
          const max = q.max ?? 5;
          const vals = answers.map((a) => num(a[q.id])).filter((v): v is number => v !== null && v >= min && v <= max);
          return { q, max, n: vals.length, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0, norm: 0 };
        })
        .filter((s) => s.n > 0)
        .map((s) => ({ ...s, norm: s.avg / s.max }));
      if (scales.length) {
        const lowest = [...scales].sort((a, b) => a.norm - b.norm || a.q.label.localeCompare(b.q.label))[0];
        add(
          "encuesta",
          lowest.norm < 0.5 ? "critical" : lowest.norm < 0.6 ? "warning" : "info",
          `Pregunta peor calificada: «${clip(lowest.q.label, 80)}» con ${nf1(lowest.avg)} de ${lowest.max}${small || ` (${pl(lowest.n, "respuesta")})`}.`,
          tag(g),
        );
        if (scales.length >= 2) {
          const best = [...scales].sort((a, b) => b.norm - a.norm || a.q.label.localeCompare(b.q.label))[0];
          if (best !== lowest) {
            add("encuesta", best.norm >= 0.8 && best.n >= SMALL_SAMPLE ? "ok" : "info", `Mejor calificada: «${clip(best.q.label, 80)}» con ${nf1(best.avg)} de ${best.max}.`, tag(g));
          }
        }
      }
      for (const q of g.survey.questions.filter((x) => x.type === "nps")) {
        const vals = answers.map((a) => num(a[q.id])).filter((v): v is number => v !== null && v >= 0 && v <= 10).map(Math.round);
        if (!vals.length) continue;
        const pro = vals.filter((v) => v >= 9).length;
        const det = vals.filter((v) => v <= 6).length;
        const pas = vals.length - pro - det;
        const score = Math.round(((pro - det) / vals.length) * 100);
        const [meaning, sev]: [string, InsightSeverity] =
          vals.length < SMALL_SAMPLE
            ? [`tendencia ${score > 0 ? "positiva" : score < 0 ? "negativa" : "neutra"}, pero con tan pocas respuestas es solo una señal`, score < 0 ? "warning" : "info"]
            : score >= 50
            ? ["excelente: la mayoría recomendaría la app", "ok"]
            : score >= 30
              ? ["muy bueno", "ok"]
              : score >= 0
                ? ["positivo pero mejorable", "info"]
                : score > -30
                  ? ["negativo: hay más detractores que promotores", "warning"]
                  : ["muy negativo: la mayoría no recomendaría la app", "critical"];
        add(
          "encuesta",
          sev,
          `NPS de ${score > 0 ? "+" : ""}${score} con ${pl(vals.length, "respuesta")} (${pl(pro, "promotor", "promotores")}, ${pl(pas, "pasivo")} y ${pl(det, "detractor", "detractores")}): ${meaning}.`,
          tag(g),
        );
      }
    }
  }

  // ------------------------------------------------------------------ Repartidores (sin filtro de guía)
  if (!guideId) {
    const { feedback, issues: cIssues, attachments } = loadCourierSafe();
    if (feedback.length) {
      const st = courierStats(feedback);
      const faces = ["", "Muy mal", "Mal", "Regular", "Bien", "Muy bien"];
      if (st.avg !== null) {
        add(
          "repartidores",
          st.avg >= 4 ? "ok" : st.avg >= 3 ? "info" : "warning",
          `Se recibieron ${pl(feedback.length, "encuesta")} de repartidores; promedio general ${nf1(st.avg)} de 5 («${faces[Math.round(st.avg)]}»).`,
        );
      } else {
        add("repartidores", "info", `Se recibieron ${pl(feedback.length, "encuesta")} de repartidores, aún sin calificaciones.`);
      }
      const answered = st.questions.filter((q) => q.avg !== null);
      if (answered.length >= 2) {
        const low = [...answered].sort((a, b) => a.avg! - b.avg! || COURIER_QUESTIONS.findIndex((q) => q.id === a.id) - COURIER_QUESTIONS.findIndex((q) => q.id === b.id))[0];
        add("repartidores", low.avg! < 3 ? "warning" : "info", `Lo peor calificado por los repartidores: «${low.short}» con ${nf1(low.avg!)} de 5 (${pl(low.n, "respuesta")}).`);
      }
      if (cIssues.length) {
        const who = new Set(cIssues.map((i) => i.feedback_id)).size;
        const withPhoto = new Set(attachments.map((a) => a.issue_id)).size;
        add(
          "repartidores",
          "warning",
          `Los repartidores reportaron ${pl(cIssues.length, "problema")} (${who} de ${feedback.length} repartidores)${withPhoto ? `, ${withPhoto} con foto` : ""}.`,
        );
      } else {
        add("repartidores", "ok", "Ningún repartidor reportó problemas.");
      }
      const os = tally(feedback.map((f) => osFamily(parseRec(f.device))).filter((o) => o !== "Desconocido"));
      if (os.length) add("repartidores", "info", `Teléfonos de los repartidores: ${list(os.map(([o, c]) => `${c} ${o}`))}.`);
    }
  }

  const order = new Map(INSIGHT_CATEGORIES.map((c, i) => [c.id, i]));
  return out.map((x, i) => ({ x, i })).sort((a, b) => order.get(a.x.category)! - order.get(b.x.category)! || a.i - b.i).map(({ x }) => x);
}

function loadCourierSafe() {
  try {
    return loadCourier();
  } catch {
    return { feedback: [], issues: [], attachments: [] };
  }
}

/** Agrupa por categoría, en el orden de INSIGHT_CATEGORIES (solo las que tienen frases). */
export function groupInsights(insights: Insight[]) {
  return INSIGHT_CATEGORIES.map((c) => ({ ...c, items: insights.filter((i) => i.category === c.id) })).filter((c) => c.items.length);
}

/** Tabla para el Excel (hoja «Resumen») y el CSV «insights». */
export function insightsExport(guideId: string | null): { headers: string[]; rows: (string | number)[][] } {
  const label = new Map(INSIGHT_CATEGORIES.map((c) => [c.id, c.label]));
  const scope = guideId ? guideShortTitle(guideId) : "Todas las guías";
  return {
    headers: ["categoría", "nivel", "resumen", "guía"],
    rows: computeInsights(guideId).map((i) => [label.get(i.category) ?? i.category, SEVERITY_LABEL[i.severity], i.text, i.guide ?? scope]),
  };
}
