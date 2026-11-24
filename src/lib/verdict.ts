import { getDb } from "./db";
import { GUIDES } from "./guides";
import { answerOf, loadCourier } from "./courier-data";
import { COURIER_QUESTIONS } from "./courier";
import { parseRec } from "./admin-data";
import { LEGACY_SEVERITY, PRIORITIES, SEVERITIES, TRIAGE, type Guide, type OrderRow, type Priority, type Severity } from "./types";

/**
 * Veredicto «¿Listo para producción?» con criterios de salida fijos, solo con lo que miden los
 * participantes (clientes, establecimientos y repartidores): manuales, reportes de falla y encuestas.
 *
 * - Proceso y documentación: ISO/IEC/IEEE 29119-2:2021 y 29119-3:2021 (pruebas de aceptación basadas en
 *   riesgo; criterios de salida fijados antes de probar).
 * - Criterios tomados del Plan de pruebas y del Informe de resultados que aplican a participantes:
 *   pedidos completados de punta a punta (≥ 90 %), ningún hallazgo crítico abierto (pedidos o cobros
 *   perdidos o duplicados) y, por actividad, ≥ 90 % «Todo salió bien» sin hallazgos críticos.
 *   Hallazgos con la severidad del Plan: crítico / alto / medio / bajo.
 * - Muestra, cobertura y satisfacción de las encuestas (UMUX-Lite → SUS para clientes y establecimientos;
 *   caritas 1–5 para repartidores). Usabilidad ISO 9241-11:2018.
 * - Intervalos de confianza del 95 % con Wald ajustado.
 * - Base del cálculo: solo las pruebas COMPLETAS (el tester terminó y envió la encuesta final). No cuentan
 *   quienes abandonaron o no terminaron, ni quienes tuvieron un problema de logística (no les asignaron
 *   repartidor, no pudieron comunicarse con él, o dejó de contestar y apareció sin conexión: pregunta «logistica»). Mesa de control
 *   puede incluir o excluir una prueba a mano desde su detalle. Los hallazgos críticos abiertos cuentan
 *   de todas las pruebas: una falla grave existe aunque el tester no haya terminado (se descarta en la revisión).
 * - Solo se califica el DESARROLLO. Un reporte que Mesa marca «Ajena al desarrollo» (servidor, correo que no
 *   llega, red) se cierra, y la actividad donde ocurrió no cuenta para ese tester (ni a favor ni en contra).
 *   Las encuestas de repartidores afectados por algo ajeno (p. ej. no pudieron entrar porque el correo nunca
 *   llegó) se pueden excluir desde el panel.
 */

// ---------------------------------------------------------------- Umbrales (criterios de salida)
export const THRESHOLDS = {
  /** Actividad: «Todo salió bien» de quienes la hicieron (Informe de resultados). */
  activityOk: 0.9,
  /** Criterio 1: pedidos completados de punta a punta. */
  endToEnd: 0.9,
  /**
   * Muestra real: quienes sí completaron la prueba son el 100 %. Basta 1 prueba completa por rol; con menos
   * de `refSample` se avisa que la confianza es menor (Nielsen y Landauer: 5 usuarios ≈ 85 % de los problemas).
   */
  minFinished: 1,
  refSample: 5,
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
  /** Respuestas mínimas de encuesta: la muestra real (cada prueba completa trae su encuesta). */
  minSurvey: 1,
  /** Satisfacción de repartidores (0–100, de caritas 1–5). */
  courier: 70,
  /** Eficiencia (informativo): un caso es lento si su mediana pasa de este múltiplo del estimado. */
  slowFactor: 2,
  /** Tiempos más largos se descartan (pausas, ediciones tardías). */
  maxCaseMin: 60,
};

/** Estados de revisión que sacan a una falla del conteo de vigentes. */
const CLOSED_TRIAGE = new Set(["no_es_falla", "externa", "tester", "duplicada", "corregida"]);

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
/** Pedidos que un establecimiento reportó como no entregados por una falla, con su «¿Por qué falló?». */
export type OrderFailure = { runId: string; tester: string; count: number; why: string };

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
  /** Criterios de los participantes (Plan e Informe). */
  criteria: Criterion[];
  openCritical: number;
  activities: ActivityRow[];
  participants: { clientes: number; establecimientos: number };
  orders: { total: number; completed: number; intentional: number; rate: number | null; failures: OrderFailure[] };
  ready: boolean;
  /** Frases cortas: por qué sí o por qué no. */
  reasons: string[];
  guides: GuideVerdict[];
  courier: { n: number; score: number | null; issues: number; criterion: Criterion | null };
  /** Quiénes entran en el cálculo (pruebas completas sin problema de logística). */
  population: Population;
  defects: DefectItem[];
  defectTotals: Record<Severity, { open: number; closed: number }>;
  generatedAt: string;
};

// ---------------------------------------------------------------- Cálculo
type RunRow = { id: string; guide_id: string; name: string; status: string; verdict_scope?: string; verdict_scope_note?: string };

/** Por qué una prueba no entra en el cálculo del veredicto. */
export type ExclusionReason = "sin_terminar" | "logistica" | "mesa";
export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  sin_terminar: "No terminó (abandonó o sigue en curso)",
  logistica: "Problema de logística",
  mesa: "Excluida por Mesa de control (problema ajeno al desarrollo)",
};
export type ExcludedRun = { runId: string; guideId: string; name: string; reason: ExclusionReason; detail: string };
export type Population = {
  total: number;
  valid: number;
  excluded: ExcludedRun[];
  counts: Record<ExclusionReason, number>;
  /** Actividades que no cuentan porque su falla fue ajena al desarrollo. */
  externalActs: number;
};
type ActRow = { run_id: string; activity_id: string; result: string | null; fields: string; updated_at: string };
type StepRow = { run_id: string; activity_id: string; updated_at: string };
type IssueRow = { id: string; run_id: string; activity_id: string; kind: string; blocking: number; severity: string; triage: string; description: string };

/** Pedidos fallados ajenos al desarrollo por prueba, según el último dictamen con Claude. */
function latestOrderAjenos(): Record<string, number> {
  const row = safeAll<{ applied: string }>("SELECT applied FROM claude_dictamen WHERE error = '' ORDER BY id DESC LIMIT 1")[0];
  const v = row ? (parseRec(row.applied).orderAjenos as unknown as Record<string, number> | undefined) : undefined;
  return v && typeof v === "object" ? v : {};
}

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
  let runs = safeAll<RunRow>("SELECT id, guide_id, name, status, verdict_scope, verdict_scope_note FROM runs");
  if (!runs.length) runs = safeAll<RunRow>("SELECT id, guide_id, name, status FROM runs");
  const acts = safeAll<ActRow>("SELECT run_id, activity_id, result, fields, updated_at FROM activity_results");
  const steps = safeAll<StepRow>("SELECT run_id, activity_id, updated_at FROM step_results");
  const issues = safeAll<IssueRow>(
    "SELECT id, run_id, activity_id, kind, blocking, severity, triage, description FROM issues WHERE kind = 'issue'"
  );
  const surveys = safeAll<{ run_id: string; answers: string }>("SELECT run_id, answers FROM survey_responses WHERE is_draft = 0");
  const runById = new Map(runs.map((r) => [r.id, r]));

  // ---- Base del cálculo: pruebas completas y sin problema de logística.
  const surveyByRun = new Map(surveys.map((s) => [s.run_id, parseRec(s.answers)]));
  const excluded: ExcludedRun[] = [];
  for (const r of runs) {
    const scope = r.verdict_scope ?? "";
    const note = r.verdict_scope_note ?? "";
    const g = GUIDES.find((x) => x.id === r.guide_id);
    const q = g?.survey.questions.find((x) => x.id === "logistica");
    const ans = String(surveyByRun.get(r.id)?.logistica ?? "");
    const logistics = !!ans && !!q?.options?.length && ans !== q.options[0];
    let reason: ExclusionReason | null = null;
    let detail = "";
    if (scope === "excluir") [reason, detail] = ["mesa", note];
    else if (r.status !== "finished") [reason, detail] = ["sin_terminar", r.status === "ended_blocked" ? "Terminada por bloqueo" : "Sin terminar"];
    else if (scope !== "incluir" && logistics) [reason, detail] = ["logistica", ans];
    if (reason) excluded.push({ runId: r.id, guideId: r.guide_id, name: r.name, reason, detail });
  }
  const excludedIds = new Set(excluded.map((e) => e.runId));
  const validRuns = runs.filter((r) => !excludedIds.has(r.id));
  const validIds = new Set(validRuns.map((r) => r.id));
  const counts = { sin_terminar: 0, logistica: 0, mesa: 0 } as Record<ExclusionReason, number>;
  for (const e of excluded) counts[e.reason]++;
  const population: Population = { total: runs.length, valid: validRuns.length, excluded, counts, externalActs: 0 };

  // Las guías ocultas (p. ej. la variante de la app móvil del establecimiento) entran si alguien las usó.
  const guides = GUIDES.filter((g) => !g.hidden || runs.some((r) => r.guide_id === g.id));
  const defects: DefectItem[] = [];
  const defectTotals = Object.fromEntries(Object.keys(SEVERITIES).map((k) => [k, { open: 0, closed: 0 }])) as Verdict["defectTotals"];

  const externalActs = { n: 0 };
  const guideVerdicts: GuideVerdict[] = guides.map((g) => {
    const gRuns = runs.filter((r) => r.guide_id === g.id);
    // Las fallas se revisan de todas las pruebas; los porcentajes, solo de las pruebas válidas.
    const allIds = new Set(gRuns.map((r) => r.id));
    const ids = new Set(gRuns.filter((r) => validIds.has(r.id)).map((r) => r.id));
    // Muestra, cobertura y encuesta se miden por rol: el establecimiento junta panel web y app móvil.
    const roleAll = runs.filter((r) => r.guide_id === g.id || (!!g.mobileGuideId && r.guide_id === g.mobileGuideId));
    const roleRuns = roleAll.filter((r) => validIds.has(r.id));
    const roleIds = new Set(roleRuns.map((r) => r.id));
    const roleOut = (k: ExclusionReason) => excluded.filter((e) => e.reason === k && roleAll.some((r) => r.id === e.runId)).length;
    const execOf = (id: string) =>
      acts.filter((x) => {
        if (!roleIds.has(x.run_id) || x.activity_id !== id || !x.result || x.result === "skipped") return false;
        const mine = issues.filter((i) => i.run_id === x.run_id && i.activity_id === id);
        return x.result === "ok" || !mine.length || !mine.every((i) => i.triage === "externa" || i.triage === "tester");
      }).length;
    const finished = roleRuns.length;
    const gIssues = issues.filter((i) => allIds.has(i.run_id));

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
      const rows = acts.filter((x) => {
        if (!ids.has(x.run_id) || x.activity_id !== a.id || !x.result || x.result === "skipped") return false;
        // Falla ajena al desarrollo (servidor, correo, red): esa actividad no cuenta para este tester.
        if (x.result !== "ok") {
          const mine = gIssues.filter((i) => i.run_id === x.run_id && i.activity_id === a.id);
          if (mine.length && mine.every((i) => i.triage === "externa" || i.triage === "tester")) {
            externalActs.n++;
            return false;
          }
        }
        return true;
      });
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
      .filter((s) => roleIds.has(s.run_id))
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
    const executedCases = cases.filter((c) => execOf(c.id) > 0).length;
    const coverage = cases.length ? executedCases / cases.length : 0;
    const crit = cases.filter((c) => c.priority === "critica");
    const critMinRuns = Math.min(T.minCriticalRuns, Math.max(1, roleRuns.length));
    const critUnder = crit.filter((c) => execOf(c.id) < critMinRuns);
    const short = g.title.replace(/^Manual del?\s*/i, "") + (g.mobileGuideId ? " (web y app)" : "");

    const criteria: Criterion[] = [
      {
        id: "muestra",
        label: "Muestra real",
        measured: `${finished} de ${roleAll.length} registrados completaron la prueba${finished ? `: esos ${finished} son el 100 % de la base` : ""}${
          finished && finished < T.refSample ? ` (con menos de ${T.refSample}, los porcentajes tienen menos confianza; ver IC 95 %)` : ""
        }${
          roleAll.length > finished
            ? ` (no cuentan: ${[
                roleOut("sin_terminar") && `${roleOut("sin_terminar")} sin terminar`,
                roleOut("logistica") && `${roleOut("logistica")} con problema de logística`,
                roleOut("mesa") && `${roleOut("mesa")} excluidas por Mesa`,
              ].filter(Boolean).join(", ")})`
            : ""
        }`,
        threshold: "al menos 1 prueba completa; la base es quien sí probó",
        pass: finished >= T.minFinished,
        basis: "Los porcentajes se calculan sobre quienes completaron la prueba. Referencia: Nielsen y Landauer (1993), con 5 usuarios aparecen cerca del 85 % de los problemas de uso.",
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
        threshold: `promedio ≥ ${T.sus} de las pruebas completas`,
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

  // Repartidores (formulario aparte, caritas 1–5). answerOf descarta «No me tocó» ("na"): no cuenta en el promedio.
  const { feedback: allFeedback, issues: allCIssues } = loadCourier();
  // Encuestas excluidas por Mesa de control (problema ajeno al desarrollo, p. ej. el correo nunca llegó).
  const feedback = allFeedback.filter((f) => f.verdict_scope !== "excluir");
  const courierOut = allFeedback.length - feedback.length;
  const cIssues = allCIssues.filter((i) => feedback.some((f) => f.id === i.feedback_id));
  const vals = feedback.flatMap((f) => {
    const a = parseRec(f.answers);
    return COURIER_QUESTIONS.map((q) => answerOf(a, q.id)).filter((v): v is number => v !== null);
  });
  const courierScore = vals.length ? ((vals.reduce((s, v) => s + v, 0) / vals.length - 1) / 4) * 100 : null;
  const courierCriterion: Criterion | null = allFeedback.length
    ? {
        id: "repartidores",
        label: "Satisfacción · Repartidores",
        measured: `${courierScore === null ? "—" : Math.round(courierScore)} / 100 con ${feedback.length} respuestas; ${cIssues.length} problemas reportados${
          courierOut ? `; ${courierOut} encuestas excluidas por problemas ajenos al desarrollo` : ""
        }`,
        threshold: `promedio ≥ ${T.courier} de las encuestas que cuentan`,
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

  // ---- Criterio 1: Hoja de pedidos (E07) de los establecimientos. Entregado = completado de punta a punta.
  // Solo se descuentan los rechazados y cancelados A PROPÓSITO: los folios que el establecimiento anotó en
  // E08 (rechazado y cancelado) y E09 (sin responder). Un rechazado o cancelado con otro folio cuenta como
  // pedido no completado. Si el establecimiento no anotó folios en E08/E09, se descuentan todos (como antes).
  const estRunIds = new Set(validRuns.filter((r) => r.guide_id.startsWith("establecimiento")).map((r) => r.id));
  const normFolio = (v: unknown) => String(v ?? "").split("·")[0].replace(/\s+/g, "").toLowerCase();
  const intentionalFolios = new Map<string, Set<string>>();
  for (const a of acts) {
    if (!estRunIds.has(a.run_id) || (a.activity_id !== "E08" && a.activity_id !== "E09")) continue;
    const f = parseRec(a.fields);
    const set = intentionalFolios.get(a.run_id) ?? new Set<string>();
    for (const k of ["rejectedFolio", "cancelledFolio", "folio"]) {
      const n = normFolio(f[k]);
      if (n) set.add(n);
    }
    intentionalFolios.set(a.run_id, set);
  }
  let oTotal = 0, oDone = 0, oIntentional = 0;
  const orderAjenos = latestOrderAjenos();
  const failures: OrderFailure[] = [];
  const assignMins: number[] = [];
  for (const a of acts) {
    if (!estRunIds.has(a.run_id)) continue;
    const f = parseRec(a.fields);
    // Conteo (desde 24-nov): entregados + no entregados por falla (sin E08/E09) y por qué fallaron.
    if (a.activity_id === "E07" && String(f.ordersDelivered ?? "").trim() !== "") {
      const d = Math.max(0, Math.floor(Number(f.ordersDelivered) || 0));
      // Pedidos fallados que el dictamen con Claude clasificó como ajenos al desarrollo (servidor, logística, tester).
      const x = Math.max(0, Math.floor(Number(f.ordersFailed) || 0) - (orderAjenos[a.run_id] ?? 0));
      oDone += d;
      oTotal += d + x;
      oIntentional += intentionalFolios.get(a.run_id)?.size ?? 0;
      const why = String(f.failedDetail ?? "").trim();
      if (x) failures.push({ runId: a.run_id, tester: runById.get(a.run_id)?.name ?? "", count: x, why });
    } else if (a.activity_id === "E07") {
      let rows: OrderRow[] = [];
      try {
        rows = typeof f.orderSheet === "string" ? JSON.parse(f.orderSheet) : Array.isArray(f.orderSheet) ? (f.orderSheet as OrderRow[]) : [];
      } catch {
        rows = [];
      }
      for (const o of rows) {
        if (!o || (!String(o.folio ?? "").trim() && !o.status)) continue;
        if (o.status === "Rechazado" || o.status === "Cancelado") {
          const known = intentionalFolios.get(a.run_id);
          if (!known?.size || known.has(normFolio(o.folio))) {
            oIntentional++;
            continue;
          }
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

  // ---- Criterios de los participantes (Plan de pruebas e Informe de resultados).
  const openCritical = defects.filter((d) => d.severity === "critico").length;
  const assignMed = median(assignMins);
  const executedActs = activities.filter((a) => a.meets !== null);
  const actFail = executedActs.filter((a) => !a.meets);
  const criteria: Criterion[] = [
    {
      id: "punta_a_punta",
      label: "Pedidos completados de punta a punta",
      measured: oTotal
        ? `${oDone} de ${oTotal} pedidos entregados (${pct(e2e)}) según el conteo de E07; ${oIntentional} rechazados o cancelados a propósito (E08 y E09) no cuentan`
        : "sin pedidos anotados en E07",
      threshold: `≥ ${pct(T.endToEnd)}`,
      pass: e2e !== null && e2e >= T.endToEnd,
      basis: "Plan de pruebas, criterio 1 (crítico): pedidos completados por usuarios reales.",
    },
    {
      id: "hallazgos_criticos",
      label: "Hallazgos críticos abiertos",
      measured: `${openCritical} (pedidos o cobros perdidos o duplicados, datos expuestos u otra falla grave)`,
      threshold: "0",
      pass: openCritical === 0,
      basis: "Plan de pruebas, criterio 2 (crítico), e Informe de resultados: no se publica con hallazgos críticos abiertos.",
    },
    {
      id: "actividades",
      label: "Actividades que cumplen",
      measured: `${executedActs.length - actFail.length} de ${executedActs.length} actividades con datos${actFail.length ? `; no cumplen: ${actFail.map((a) => `${a.id} ${pct(a.okRate)}`).join(", ")}` : ""}${
        assignMed !== null ? ` · asignación de repartidor (E11): mediana ${Math.round(assignMed * 10) / 10} min` : ""
      }`,
      threshold: `todas: ≥ ${pct(T.activityOk)} «Todo salió bien» y sin hallazgos críticos`,
      pass: executedActs.length > 0 && actFail.length === 0,
      basis: "Informe de resultados (ISO/IEC/IEEE 29119-3:2021): resultados por actividad de los manuales.",
    },
  ];
  const all = [...criteria, ...guideVerdicts.filter((g) => !g.guide.hidden).flatMap((g) => g.criteria), ...(courierCriterion ? [courierCriterion] : [])];
  const failed = all.filter((c) => !c.pass);
  const ready = failed.length === 0 && validRuns.length > 0;
  const reasons = ready
    ? ["Se cumplieron todos los criterios de salida definidos antes de la prueba.", ...criteria.map((c) => `${c.label}: ${c.measured}.`)]
    : failed.map((c) => `${c.label}: ${c.measured} (se pide ${c.threshold}).`);
  if (!runs.length) reasons.unshift("Todavía no hay pruebas registradas.");
  else if (!validRuns.length) reasons.unshift("Todavía no hay pruebas completas: solo cuentan quienes terminaron y enviaron la encuesta final.");

  const participants = {
    clientes: validRuns.filter((r) => r.guide_id === "cliente").length,
    establecimientos: validRuns.filter((r) => r.guide_id.startsWith("establecimiento")).length,
  };

  const sevRank: Record<Severity, number> = { critico: 0, alto: 1, medio: 2, bajo: 3 };
  const priRank = Object.fromEntries(Object.keys(PRIORITIES).map((k, i) => [k, i])) as Record<Priority, number>;
  defects.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || priRank[a.priority] - priRank[b.priority]);

  return {
    criteria,
    openCritical,
    activities,
    participants,
    orders: { total: oTotal, completed: oDone, intentional: oIntentional, rate: e2e, failures },
    ready,
    reasons,
    guides: guideVerdicts,
    courier: { n: feedback.length, score: courierScore, issues: cIssues.length, criterion: courierCriterion },
    population: { ...population, externalActs: externalActs.n },
    defects,
    defectTotals,
    generatedAt: new Date().toISOString(),
  };
}
