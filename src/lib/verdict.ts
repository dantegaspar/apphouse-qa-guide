import { getDb } from "./db";
import { GUIDES } from "./guides";
import { answerOf, loadCourier } from "./courier-data";
import { COURIER_QUESTIONS } from "./courier";
import { parseRec } from "./admin-data";
import { LEGACY_SEVERITY, PRIORITIES, SEVERITIES, TRIAGE, type Guide, type OrderRow, type Priority, type Severity } from "./types";

/**
 * Dictamen «¿Lista para publicar?» con los criterios de finalización del Plan de pruebas
 * (PP-APPHOUSE-ESTRES-001, sección 7.5) y el formato del Informe de resultados (IR-APPHOUSE-ESTRES-001,
 * plantilla de reporte de finalización de ISO/IEC/IEEE 29119-3:2021).
 *
 * - 13 criterios con peso; cada uno cumplido suma su peso completo. Puntaje = suma de pesos cumplidos.
 *   Aprobado: ≥ 90 %, los 3 críticos (1, 2 y 13) cumplidos y ningún hallazgo crítico abierto.
 *   Aprobado con observaciones: 80–89 % con lo demás igual. No aprobado: lo demás.
 * - El criterio 1 sale de los manuales (Hoja de pedidos de E07); los demás (bots, servidor, seguridad
 *   WSTG/MASVS) los captura Mesa de control. Sin dato = pendiente (no suma).
 * - Por actividad (Informe): cumple si ≥ 90 % de quienes la hicieron marcaron «Todo salió bien» y no tiene
 *   hallazgos críticos abiertos.
 * - Hallazgos con la severidad del Plan (crítico / alto / medio / bajo), revisados por Mesa de control.
 *   Los no revisados cuentan como abiertos.
 * - Complementarios (no cambian el dictamen): usabilidad ISO 9241-11:2018 (UMUX-Lite → SUS, minutos por
 *   caso) e intervalos de confianza del 95 % con Wald ajustado.
 */

// ---------------------------------------------------------------- Umbrales (criterios de salida)
export const THRESHOLDS = {
  /** Actividad: «Todo salió bien» de quienes la hicieron (Informe de resultados). */
  activityOk: 0.9,
  /** Criterio 1: pedidos completados de punta a punta. */
  endToEnd: 0.98,
  /** Puntaje para «Aprobado» y para «Aprobado con observaciones» (Plan 7.5). */
  scorePass: 90,
  scoreObs: 80,
  /** Testers con la prueba terminada por guía (Nielsen y Landauer: 5 usuarios ≈ 85 % de los problemas). */
  minFinished: 5,
  /** Casos de la guía ejecutados por al menos un tester. */
  coverage: 0.9,
  /** Ejecuciones mínimas de cada caso crítico. */
  minCriticalRuns: 3,
  /** Aprobación conjunta de los casos críticos. */
  criticalPassRate: 0.95,
  /** Aprobación mínima de cada caso crítico por separado. */
  criticalCasePassRate: 0.8,
  /** Aprobación de todos los casos. */
  overallPassRate: 0.9,
  /** SUS equivalente (a partir de UMUX-Lite). */
  sus: 68,
  /** Respuestas mínimas de encuesta para juzgar la satisfacción. */
  minSurvey: 5,
  /** Satisfacción de repartidores (0–100, de caritas 1–5). */
  courier: 70,
  /** Eficiencia (informativo): un caso es lento si su mediana pasa de este múltiplo del estimado. */
  slowFactor: 2,
  /** Tiempos más largos se descartan (pausas, ediciones tardías). */
  maxCaseMin: 60,
};

/** Estados de revisión que sacan a una falla del conteo de vigentes. */
const CLOSED_TRIAGE = new Set(["no_es_falla", "duplicada", "corregida"]);

// ---------------------------------------------------------------- Estadística
/** IC 95 % de una proporción con Wald ajustado (Agresti-Coull). */
export function adjustedWald(x: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96;
  const nAdj = n + z * z;
  const p = (x + (z * z) / 2) / nAdj;
  const m = z * Math.sqrt((p * (1 - p)) / nAdj);
  return [Math.max(0, p - m), Math.min(1, p + m)];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** UMUX-Lite (2 preguntas 1–7) → 0–100, y su equivalente SUS (Lewis, Utesch y Maher, 2013). */
export function umuxLite(a: number, b: number) {
  const raw = ((a - 1 + (b - 1)) / 12) * 100;
  return { raw, sus: 0.65 * raw + 22.9 };
}

// ---------------------------------------------------------------- Tipos
export type CaseStat = {
  guideId: string;
  id: string;
  title: string;
  priority: Priority;
  quality: string;
  estMin: number | null;
  executed: number;
  passed: number;
  /** Pasó, pero con fallas menores o descartadas. */
  passedWithNotes: number;
  failed: number;
  blocked: number;
  passRate: number | null;
  ci: [number, number] | null;
  medianMin: number | null;
  slow: boolean;
  openDefects: Record<Severity, number>;
  /** Marcaron «Todo salió bien» (resultado ok, sin tomar en cuenta la revisión de fallas). */
  allOk: number;
  okRate: number | null;
  /** Regla del Informe: ≥ 90 % «Todo salió bien» y sin hallazgos críticos abiertos. */
  meets: boolean | null;
};

/** Criterio de finalización del Plan (sección 7.5). */
export type PlanCriterion = {
  n: number;
  label: string;
  goal: string;
  weight: number;
  critical: boolean;
  /** Lo que midieron los bots el 20/11 (Informe, columna «Preliminar»). */
  prelim: string;
  /** Medido el 24/11 (de los manuales o capturado por Mesa de control). */
  measured: string;
  /** null = pendiente. */
  met: boolean | null;
  source: "manuales" | "mesa" | "pendiente";
  note: string;
  /** Dato de apoyo que sale de los manuales, para criterios que se capturan a mano. */
  hint?: string;
};

export const PLAN_CRITERIA: Omit<PlanCriterion, "measured" | "met" | "source" | "note" | "hint">[] = [
  { n: 1, label: "Pedidos completados de punta a punta por usuarios reales", goal: "≥ 98 %", weight: 15, critical: true, prelim: "No aplica a bots; se mide con participantes el 24/11." },
  { n: 2, label: "Pedidos o cobros perdidos o duplicados", goal: "0", weight: 15, critical: true, prelim: "0 duplicados en 112 reintentos idempotentes; 0 dobles asignaciones; pagos simulados sin cargos reales." },
  { n: 3, label: "Tiempo de respuesta de la API, p95", goal: "≤ 800 ms", weight: 10, critical: false, prelim: "Sin dato: el reporte da p95 de conexión WebSocket (308.9 ms) y de búsqueda de catálogo (1,920 ms), no de la API." },
  { n: 4, label: "Tiempo de respuesta de la API, p99", goal: "≤ 2 s", weight: 5, critical: false, prelim: "Sin dato." },
  { n: 5, label: "Tasa de errores 5xx a carga objetivo", goal: "≤ 1 %", weight: 10, critical: false, prelim: "0.026 % con 280 bots y 0.083 % en los 8 escenarios." },
  { n: 6, label: "Carga soportada sin caída", goal: "≥ 3 veces el pico esperado", weight: 10, critical: false, prelim: "Sin dato: falta definir el pico esperado. Quiebre entre 1,119 y 1,559 usuarios virtuales." },
  { n: 7, label: "Disponibilidad durante la prueba", goal: "≥ 99.5 %", weight: 5, critical: false, prelim: "Sin porcentaje; 0 caídas de Apache, PHP-FPM o Reverb durante el pico súbito." },
  { n: 8, label: "Aviso del pedido al establecimiento", goal: "≤ 5 s", weight: 5, critical: false, prelim: "Sin dato." },
  { n: 9, label: "Asignación de repartidor", goal: "≤ 60 s", weight: 5, critical: false, prelim: "Sin tiempo medido; 12 declinaciones reasignadas de inmediato al segundo repartidor." },
  { n: 10, label: "Retraso en la ubicación del repartidor", goal: "≤ 10 s", weight: 5, critical: false, prelim: "Sin dato; los bots reportan ubicación cada 4 s." },
  { n: 11, label: "Tráfico abusivo bloqueado / legítimos bloqueados", goal: "≥ 95 % / ≤ 1 %", weight: 5, critical: false, prelim: "Inicios de sesión: 18 de 18 ataques bloqueados y 0 falsos positivos. Falta extracción y denegación de servicio." },
  { n: 12, label: "Vuelta a la línea base tras detener los bots", goal: "≤ 5 min", weight: 5, critical: false, prelim: "Recuperación sin intervención manual; el reporte no da el tiempo." },
  { n: 13, label: "Vulnerabilidades críticas o altas abiertas", goal: "0", weight: 5, critical: true, prelim: "Sin evaluar (no hay pruebas WSTG ni MASVS)." },
];

export type Dictamen = "aprobado" | "observaciones" | "no_aprobado";
export const DICTAMEN_LABEL: Record<Dictamen, string> = {
  aprobado: "Lista para publicar",
  observaciones: "Lista con observaciones",
  no_aprobado: "No lista para publicar",
};

/** Fila de «Resultados por actividad de los manuales» (web y app del establecimiento juntas). */
export type ActivityRow = {
  id: string;
  title: string;
  priority: Priority;
  executed: number;
  allOk: number;
  failed: number;
  blocked: number;
  okRate: number | null;
  ci: [number, number] | null;
  openCritical: number;
  meets: boolean | null;
  medianMin: number | null;
  estMin: number | null;
  slow: boolean;
};

export type Criterion = {
  id: string;
  label: string;
  /** Qué se midió, con números. */
  measured: string;
  threshold: string;
  pass: boolean;
  /** Fundamento (norma o referencia). */
  basis: string;
};

export type DefectItem = {
  id: string;
  guideId: string;
  activityId: string;
  activityTitle: string;
  priority: Priority;
  severity: Severity;
  triage: string;
  description: string;
  runId: string;
  tester: string;
};

export type GuideVerdict = {
  guide: Guide;
  testers: number;
  finished: number;
  cases: CaseStat[];
  survey: { n: number; umux: number | null; sus: number | null; ci: [number, number] | null };
  criteria: Criterion[];
};

export type Verdict = {
  /** Dictamen del Plan (7.5). */
  dictamen: Dictamen;
  /** Hay criterios sin dato: el dictamen puede cambiar. */
  provisional: boolean;
  score: number;
  plan: PlanCriterion[];
  criticalMet: number;
  openCritical: number;
  activities: ActivityRow[];
  participants: { clientes: number; establecimientos: number };
  orders: { total: number; completed: number; intentional: number; rate: number | null };
  /** Igual a dictamen === "aprobado" (compatibilidad). */
  ready: boolean;
  /** Frases cortas: por qué sí o por qué no. */
  reasons: string[];
  guides: GuideVerdict[];
  courier: { n: number; score: number | null; issues: number; criterion: Criterion | null };
  defects: DefectItem[];
  defectTotals: Record<Severity, { open: number; closed: number }>;
  generatedAt: string;
};

// ---------------------------------------------------------------- Cálculo
type RunRow = { id: string; guide_id: string; name: string; status: string };
type ActRow = { run_id: string; activity_id: string; result: string | null; fields: string; updated_at: string };
type StepRow = { run_id: string; activity_id: string; updated_at: string };
type IssueRow = { id: string; run_id: string; activity_id: string; kind: string; blocking: number; severity: string; triage: string; description: string };

function safeAll<T>(sql: string): T[] {
  try {
    return getDb().prepare(sql).all() as T[];
  } catch {
    return [];
  }
}

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const sevOf = (i: IssueRow): Severity =>
  i.severity && i.severity in SEVERITIES ? (i.severity as Severity) : LEGACY_SEVERITY[i.severity] ?? (i.blocking ? "alto" : "medio");

export function computeVerdict(): Verdict {
  const T = THRESHOLDS;
  const runs = safeAll<RunRow>("SELECT id, guide_id, name, status FROM runs");
  const acts = safeAll<ActRow>("SELECT run_id, activity_id, result, fields, updated_at FROM activity_results");
  const steps = safeAll<StepRow>("SELECT run_id, activity_id, updated_at FROM step_results");
  const issues = safeAll<IssueRow>(
    "SELECT id, run_id, activity_id, kind, blocking, severity, triage, description FROM issues WHERE kind = 'issue'"
  );
  const surveys = safeAll<{ run_id: string; answers: string }>("SELECT run_id, answers FROM survey_responses WHERE is_draft = 0");
  const runById = new Map(runs.map((r) => [r.id, r]));

  // Las guías ocultas (p. ej. la variante de la app móvil del establecimiento) entran si alguien las usó.
  const guides = GUIDES.filter((g) => !g.hidden || runs.some((r) => r.guide_id === g.id));
  const defects: DefectItem[] = [];
  const defectTotals = Object.fromEntries(Object.keys(SEVERITIES).map((k) => [k, { open: 0, closed: 0 }])) as Verdict["defectTotals"];

  const guideVerdicts: GuideVerdict[] = guides.map((g) => {
    const gRuns = runs.filter((r) => r.guide_id === g.id);
    const ids = new Set(gRuns.map((r) => r.id));
    const finished = gRuns.filter((r) => r.status === "finished").length;
    const gIssues = issues.filter((i) => ids.has(i.run_id));

    for (const i of gIssues) {
      const a = g.activities.find((x) => x.id === i.activity_id);
      const sev = sevOf(i);
      const open = !CLOSED_TRIAGE.has(i.triage);
      defectTotals[sev][open ? "open" : "closed"]++;
      if (open)
        defects.push({
          id: i.id,
          guideId: g.id,
          activityId: i.activity_id,
          activityTitle: a?.title ?? "",
          priority: a?.priority ?? "media",
          severity: sev,
          triage: i.triage in TRIAGE ? i.triage : "pendiente",
          description: i.description,
          runId: i.run_id,
          tester: runById.get(i.run_id)?.name ?? "",
        });
    }

    const cases: CaseStat[] = g.activities.map((a) => {
      const rows = acts.filter((x) => ids.has(x.run_id) && x.activity_id === a.id && x.result && x.result !== "skipped");
      let passed = 0, passedWithNotes = 0, failed = 0, blocked = 0, allOk = 0;
      const mins: number[] = [];
      for (const r of rows) {
        if (r.result === "blocked") blocked++;
        else if (r.result === "ok") {
          passed++;
          allOk++;
        }
        else {
          // «Tuvo alguna falla»: falla si hay un hallazgo abierto crítico, alto o medio en este caso;
          // con solo bajos (o descartados) pasa con observaciones. Sin reporte, cuenta como falla.
          const mine = gIssues.filter((i) => i.run_id === r.run_id && i.activity_id === a.id);
          const serious = mine.some((i) => !CLOSED_TRIAGE.has(i.triage) && sevOf(i) !== "bajo");
          if (mine.length && !serious) {
            passed++;
            passedWithNotes++;
          } else failed++;
        }
        const marks = steps.filter((s) => s.run_id === r.run_id && s.activity_id === a.id).map((s) => new Date(s.updated_at).getTime());
        if (marks.length && r.result !== "blocked") {
          const d = (new Date(r.updated_at).getTime() - Math.min(...marks)) / 60_000;
          if (d > 0 && d <= T.maxCaseMin) mins.push(d);
        }
      }
      // Bloqueadas cuentan en el denominador: no se demostró que el caso funciona (conservador).
      const executed = passed + failed + blocked;
      const openDefects = Object.fromEntries(Object.keys(SEVERITIES).map((k) => [k, 0])) as Record<Severity, number>;
      for (const d of defects) if (d.guideId === g.id && d.activityId === a.id) openDefects[d.severity]++;
      const med = median(mins);
      return {
        guideId: g.id,
        id: a.id,
        title: a.title,
        priority: a.priority ?? "media",
        quality: a.quality ?? "Adecuación funcional",
        estMin: a.estMin ?? null,
        executed,
        passed,
        passedWithNotes,
        failed,
        blocked,
        passRate: executed ? passed / executed : null,
        ci: adjustedWald(passed, executed),
        medianMin: med,
        slow: med !== null && !!a.estMin && med > a.estMin * T.slowFactor,
        openDefects,
        allOk,
        okRate: executed ? allOk / executed : null,
        meets: executed ? allOk / executed >= T.activityOk && openDefects.critico === 0 : null,
      };
    });

    // Satisfacción (UMUX-Lite → SUS)
    const scores = surveys
      .filter((s) => ids.has(s.run_id))
      .map((s) => parseRec(s.answers))
      .map((a) => [Number(a.umux1), Number(a.umux2)])
      .filter(([x, y]) => x >= 1 && x <= 7 && y >= 1 && y <= 7)
      .map(([x, y]) => umuxLite(x, y));
    const nS = scores.length;
    const meanSus = nS ? scores.reduce((s, x) => s + x.sus, 0) / nS : null;
    const meanRaw = nS ? scores.reduce((s, x) => s + x.raw, 0) / nS : null;
    let susCi: [number, number] | null = null;
    if (nS >= 2 && meanSus !== null) {
      const sd = Math.sqrt(scores.reduce((s, x) => s + (x.sus - meanSus) ** 2, 0) / (nS - 1));
      // t de Student al 95 % (aprox. para n pequeñas)
      const tTable = [0, 12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23];
      const t = nS - 1 < tTable.length ? tTable[nS - 1] : 2.0;
      const m = (t * sd) / Math.sqrt(nS);
      susCi = [meanSus - m, meanSus + m];
    }

    // Criterios
    const executedCases = cases.filter((c) => c.executed > 0).length;
    const coverage = cases.length ? executedCases / cases.length : 0;
    const crit = cases.filter((c) => c.priority === "critica");
    const critMinRuns = Math.min(T.minCriticalRuns, Math.max(1, gRuns.length));
    const critUnder = crit.filter((c) => c.executed < critMinRuns);
    const short = g.title.replace(/^Manual del?\s*/i, "");

    const criteria: Criterion[] = [
      {
        id: "muestra",
        label: "Muestra suficiente",
        measured: `${finished} de ${gRuns.length} testers terminaron`,
        threshold: `≥ ${T.minFinished} terminados`,
        pass: finished >= T.minFinished,
        basis: "Nielsen y Landauer (1993): con 5 usuarios aparecen cerca del 85 % de los problemas de uso.",
      },
      {
        id: "cobertura",
        label: "Cobertura de casos",
        measured: `${executedCases} de ${cases.length} casos ejecutados (${pct(coverage)})${critUnder.length ? `; con pocas ejecuciones: ${critUnder.map((c) => c.id).join(", ")}` : ""}`,
        threshold: `≥ ${pct(T.coverage)} de los casos y cada caso crítico ≥ ${critMinRuns} veces`,
        pass: coverage >= T.coverage && critUnder.length === 0,
        basis: "ISO/IEC/IEEE 29119-3:2021: cobertura de la especificación de procedimientos (los manuales).",
      },
      {
        id: "satisfaccion",
        label: "Satisfacción (SUS equivalente)",
        measured: nS ? `${Math.round(meanSus!)} con ${nS} respuestas${susCi ? ` (IC 95 % ${Math.round(susCi[0])}–${Math.round(susCi[1])})` : ""}` : "sin respuestas",
        threshold: `≥ ${T.sus} con ≥ ${T.minSurvey} respuestas`,
        pass: nS >= T.minSurvey && meanSus !== null && meanSus >= T.sus,
        basis: "UMUX-Lite (Lewis et al., 2013) convertido a SUS; 68 es el promedio de referencia (Sauro, 2011).",
      },
    ].map((c) => ({ ...c, label: `${c.label} · ${short}` }));

    return {
      guide: g,
      testers: gRuns.length,
      finished,
      cases,
      survey: { n: nS, umux: meanRaw, sus: meanSus, ci: susCi },
      criteria,
    };
  });

  // Repartidores (formulario aparte, caritas 1–5)
  const { feedback, issues: cIssues } = loadCourier();
  const vals = feedback.flatMap((f) => {
    const a = parseRec(f.answers);
    return COURIER_QUESTIONS.map((q) => answerOf(a, q.id)).filter((v): v is number => v !== null);
  });
  const courierScore = vals.length ? ((vals.reduce((s, v) => s + v, 0) / vals.length - 1) / 4) * 100 : null;
  const courierCriterion: Criterion | null = feedback.length
    ? {
        id: "repartidores",
        label: "Satisfacción · Repartidores",
        measured: `${courierScore === null ? "—" : Math.round(courierScore)} / 100 con ${feedback.length} respuestas; ${cIssues.length} problemas reportados`,
        threshold: `≥ ${T.courier} con ≥ ${T.minSurvey} respuestas`,
        pass: feedback.length >= T.minSurvey && courierScore !== null && courierScore >= T.courier,
        basis: "Escala Likert de 5 puntos llevada a 0–100; 70 equivale a «fácil» en promedio.",
      }
    : null;

  // ---- Resultados por actividad (Informe): web y app del establecimiento juntas, primero C y luego E.
  const byId = new Map<string, CaseStat[]>();
  for (const g of guideVerdicts) for (const c of g.cases) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
  const activities: ActivityRow[] = [...byId.entries()]
    .sort(([a], [b]) => (a[0] === b[0] ? a.localeCompare(b) : a[0] === "C" ? -1 : 1))
    .map(([id, cs]) => {
      const executed = cs.reduce((s, c) => s + c.executed, 0);
      const allOk = cs.reduce((s, c) => s + c.allOk, 0);
      const openCritical = defects.filter((d) => d.activityId === id && d.severity === "critico").length;
      const mins = cs.map((c) => c.medianMin).filter((x): x is number => x !== null);
      const med = median(mins);
      const est = cs[0].estMin;
      return {
        id,
        title: cs[0].title,
        priority: cs[0].priority,
        executed,
        allOk,
        failed: cs.reduce((s, c) => s + c.failed, 0),
        blocked: cs.reduce((s, c) => s + c.blocked, 0),
        okRate: executed ? allOk / executed : null,
        ci: adjustedWald(allOk, executed),
        openCritical,
        meets: executed ? allOk / executed >= T.activityOk && openCritical === 0 : null,
        medianMin: med,
        estMin: est,
        slow: med !== null && !!est && med > est * T.slowFactor,
      };
    });

  // ---- Criterio 1: Hoja de pedidos (E07) de los establecimientos. Rechazados y cancelados a propósito
  // (E08 y E09) no cuentan; Entregado = completado de punta a punta.
  const estRunIds = new Set(runs.filter((r) => r.guide_id.startsWith("establecimiento")).map((r) => r.id));
  let oTotal = 0, oDone = 0, oIntentional = 0;
  const assignMins: number[] = [];
  for (const a of acts) {
    if (!estRunIds.has(a.run_id)) continue;
    const f = parseRec(a.fields);
    if (a.activity_id === "E07") {
      let rows: OrderRow[] = [];
      try {
        rows = typeof f.orderSheet === "string" ? JSON.parse(f.orderSheet) : Array.isArray(f.orderSheet) ? (f.orderSheet as OrderRow[]) : [];
      } catch {
        rows = [];
      }
      for (const o of rows) {
        if (!o || (!String(o.folio ?? "").trim() && !o.status)) continue;
        if (o.status === "Rechazado" || o.status === "Cancelado") {
          oIntentional++;
          continue;
        }
        oTotal++;
        if (o.status === "Entregado") oDone++;
      }
    }
    if (a.activity_id === "E11") {
      const m = Number(f.assignMinutes);
      if (Number.isFinite(m) && m >= 0) assignMins.push(m);
    }
  }
  const e2e = oTotal ? oDone / oTotal : null;

  // ---- Criterios del Plan (7.5): el 1 sale de los manuales; los demás los captura Mesa de control.
  const manual = new Map(
    safeAll<{ id: number; measured: string; met: number | null; note: string }>("SELECT id, measured, met, note FROM exit_criteria").map((r) => [r.id, r])
  );
  const openCritical = defects.filter((d) => d.severity === "critico").length;
  const assignMed = median(assignMins);
  const plan: PlanCriterion[] = PLAN_CRITERIA.map((c) => {
    const m = manual.get(c.n);
    const hasManual = !!m && (m.met !== null || m.measured.trim() !== "");
    let measured = hasManual ? m!.measured : "";
    let met: boolean | null = hasManual && m!.met !== null ? m!.met === 1 : null;
    let source: PlanCriterion["source"] = met !== null ? "mesa" : "pendiente";
    let hint: string | undefined;
    if (c.n === 1) {
      const auto = oTotal ? `${oDone} de ${oTotal} pedidos entregados (${pct(e2e)}), según la Hoja de pedidos de E07; ${oIntentional} rechazados o cancelados a propósito no cuentan.` : "Sin pedidos en la Hoja de pedidos (E07).";
      if (met === null) {
        measured = auto;
        met = e2e === null ? null : e2e >= T.endToEnd;
        source = met === null ? "pendiente" : "manuales";
      } else hint = auto;
    }
    if (c.n === 2 || c.n === 13) hint = `Hallazgos críticos abiertos de los participantes: ${openCritical}.`;
    if (c.n === 9 && assignMed !== null) hint = `Mediana que anotaron los establecimientos en E11: ${Math.round(assignMed * 10) / 10} min (${assignMins.length} respuestas).`;
    return { ...c, measured, met, source, note: m?.note ?? "", hint };
  });
  const score = plan.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const crits = plan.filter((c) => c.critical);
  const criticalMet = crits.filter((c) => c.met).length;
  const allCrit = criticalMet === crits.length;
  const dictamen: Dictamen =
    allCrit && openCritical === 0 && score >= T.scorePass ? "aprobado" : allCrit && openCritical === 0 && score >= T.scoreObs ? "observaciones" : "no_aprobado";
  const pending = plan.filter((c) => c.met === null);
  const ready = dictamen === "aprobado";

  const reasons: string[] = [];
  if (!runs.length) reasons.push("Todavía no hay pruebas registradas.");
  reasons.push(`Puntaje ${score} % (se pide ≥ ${T.scorePass} % para publicar y ≥ ${T.scoreObs} % para publicar con observaciones).`);
  reasons.push(`Criterios críticos cumplidos: ${criticalMet} de ${crits.length}${allCrit ? "." : ` (faltan: ${crits.filter((c) => !c.met).map((c) => `${c.n} ${c.label}`).join("; ")}).`}`);
  reasons.push(openCritical ? `Hay ${openCritical} hallazgo${openCritical === 1 ? "" : "s"} crítico${openCritical === 1 ? "" : "s"} abierto${openCritical === 1 ? "" : "s"}.` : "Ningún hallazgo crítico abierto.");
  for (const c of plan) if (c.met === false) reasons.push(`No cumple ${c.n} · ${c.label}: ${c.measured || "sin dato"} (meta ${c.goal}).`);
  if (pending.length) reasons.push(`Sin dato todavía (no suman): ${pending.map((c) => c.n).join(", ")}. El dictamen es provisional.`);
  const actFail = activities.filter((a) => a.meets === false);
  if (actFail.length) reasons.push(`Actividades que no cumplen (≥ ${pct(T.activityOk)} «Todo salió bien» y sin hallazgos críticos): ${actFail.map((a) => `${a.id} ${pct(a.okRate)}`).join(", ")}.`);

  const participants = {
    clientes: runs.filter((r) => r.guide_id === "cliente").length,
    establecimientos: runs.filter((r) => r.guide_id.startsWith("establecimiento")).length,
  };

  const sevRank: Record<Severity, number> = { critico: 0, alto: 1, medio: 2, bajo: 3 };
  const priRank = Object.fromEntries(Object.keys(PRIORITIES).map((k, i) => [k, i])) as Record<Priority, number>;
  defects.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || priRank[a.priority] - priRank[b.priority]);

  return {
    dictamen,
    provisional: pending.length > 0,
    score,
    plan,
    criticalMet,
    openCritical,
    activities,
    participants,
    orders: { total: oTotal, completed: oDone, intentional: oIntentional, rate: e2e },
    ready,
    reasons,
    guides: guideVerdicts,
    courier: { n: feedback.length, score: courierScore, issues: cIssues.length, criterion: courierCriterion },
    defects,
    defectTotals,
    generatedAt: new Date().toISOString(),
  };
}
