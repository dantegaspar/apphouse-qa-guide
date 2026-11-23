import { getDb } from "./db";
import { GUIDES } from "./guides";
import { answerOf, loadCourier } from "./courier-data";
import { COURIER_QUESTIONS } from "./courier";
import { parseRec } from "./admin-data";
import { PRIORITIES, SEVERITIES, TRIAGE, type Guide, type Priority, type Severity } from "./types";

/**
 * Veredicto «¿Listo para producción?» con criterios de salida fijos y medibles.
 *
 * Metodología (resumen; el texto completo se muestra en /admin/veredicto):
 * - Pruebas de aceptación de usuario (UAT) basadas en riesgo, ISO/IEC/IEEE 29119-2:2021 y 29119-3:2021:
 *   cada actividad de la guía es un caso de prueba con prioridad (riesgo) y veredicto
 *   (pasa / falla / bloqueada / no ejecutada). Criterios de salida definidos ANTES de probar.
 * - Defectos clasificados por gravedad (IEEE 1044-2009): bloqueante / mayor / menor, revisados por
 *   Mesa de control (triage). Los no revisados cuentan como vigentes (criterio conservador).
 * - Usabilidad ISO 9241-11:2018: efectividad (tasa de aprobación), eficiencia (minutos por caso vs.
 *   estimado) y satisfacción (UMUX-Lite convertido a escala SUS; 68 = promedio de la industria).
 * - Intervalos de confianza del 95 % con Wald ajustado (Agresti-Coull), recomendado para
 *   muestras pequeñas de tasas de éxito.
 */

// ---------------------------------------------------------------- Umbrales (criterios de salida)
export const THRESHOLDS = {
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
  /** Fallas mayores vigentes permitidas (fuera de casos críticos). */
  maxMajor: 5,
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
type ActRow = { run_id: string; activity_id: string; result: string | null; updated_at: string };
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
  i.severity && i.severity in SEVERITIES ? (i.severity as Severity) : i.blocking ? "bloqueante" : "mayor";

export function computeVerdict(): Verdict {
  const T = THRESHOLDS;
  const runs = safeAll<RunRow>("SELECT id, guide_id, name, status FROM runs");
  const acts = safeAll<ActRow>("SELECT run_id, activity_id, result, updated_at FROM activity_results");
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
      let passed = 0, passedWithNotes = 0, failed = 0, blocked = 0;
      const mins: number[] = [];
      for (const r of rows) {
        if (r.result === "blocked") blocked++;
        else if (r.result === "ok") passed++;
        else {
          // «Tuvo alguna falla»: falla si hay una falla vigente bloqueante o mayor en este caso;
          // con solo menores (o descartadas) pasa con observaciones. Sin reporte, cuenta como falla.
          const mine = gIssues.filter((i) => i.run_id === r.run_id && i.activity_id === a.id);
          const serious = mine.some((i) => !CLOSED_TRIAGE.has(i.triage) && sevOf(i) !== "menor");
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
    const critExec = crit.reduce((s, c) => s + c.executed, 0);
    const critPass = crit.reduce((s, c) => s + c.passed, 0);
    const critRate = critExec ? critPass / critExec : null;
    const critLow = crit.filter((c) => c.passRate !== null && c.passRate < T.criticalCasePassRate);
    const allExec = cases.reduce((s, c) => s + c.executed, 0);
    const allPass = cases.reduce((s, c) => s + c.passed, 0);
    const allRate = allExec ? allPass / allExec : null;
    const gDefects = defects.filter((d) => d.guideId === g.id);
    const blockers = gDefects.filter((d) => d.severity === "bloqueante");
    const majorsCrit = gDefects.filter((d) => d.severity === "mayor" && d.priority === "critica");
    const majors = gDefects.filter((d) => d.severity === "mayor");
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
        basis: "ISO/IEC/IEEE 29119-3:2021: criterio de cobertura de la especificación de pruebas.",
      },
      {
        id: "criticos",
        label: "Casos críticos aprobados",
        measured: `${critPass} de ${critExec} ejecuciones (${pct(critRate)})${critLow.length ? `; bajo ${pct(T.criticalCasePassRate)}: ${critLow.map((c) => `${c.id} ${pct(c.passRate)}`).join(", ")}` : ""}`,
        threshold: `≥ ${pct(T.criticalPassRate)} en conjunto y ≥ ${pct(T.criticalCasePassRate)} cada uno`,
        pass: critRate !== null && critRate >= T.criticalPassRate && critLow.length === 0,
        basis: "Pruebas basadas en riesgo (ISO/IEC/IEEE 29119-2:2021; ISTQB CTFL v4.0): los flujos de pedido y dinero tienen la exigencia más alta.",
      },
      {
        id: "global",
        label: "Aprobación global",
        measured: `${allPass} de ${allExec} ejecuciones (${pct(allRate)})`,
        threshold: `≥ ${pct(T.overallPassRate)}`,
        pass: allRate !== null && allRate >= T.overallPassRate,
        basis: "ISO 9241-11:2018: efectividad = tareas completadas con éxito.",
      },
      {
        id: "defectos",
        label: "Fallas vigentes",
        measured: `${blockers.length} bloqueantes · ${majors.length} mayores (${majorsCrit.length} en casos críticos)`,
        threshold: `0 bloqueantes · 0 mayores en críticos · ≤ ${T.maxMajor} mayores`,
        pass: blockers.length === 0 && majorsCrit.length === 0 && majors.length <= T.maxMajor,
        basis: "IEEE 1044-2009 (clasificación de anomalías): no se libera con defectos que impiden el uso.",
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

  const all = [...guideVerdicts.flatMap((g) => g.criteria), ...(courierCriterion ? [courierCriterion] : [])];
  const failed = all.filter((c) => !c.pass);
  const ready = failed.length === 0 && guideVerdicts.some((g) => g.testers > 0);
  const reasons = ready
    ? [
        "Se cumplieron todos los criterios de salida definidos antes de la prueba.",
        ...guideVerdicts.map(
          (g) => `${g.guide.title}: ${g.criteria.find((c) => c.id === "criticos")?.measured} en casos críticos; satisfacción ${g.criteria.find((c) => c.id === "satisfaccion")?.measured}.`
        ),
      ]
    : failed.map((c) => `${c.label}: ${c.measured} (se pide ${c.threshold}).`);
  if (!guideVerdicts.some((g) => g.testers > 0)) reasons.unshift("Todavía no hay pruebas registradas.");

  const sevRank: Record<Severity, number> = { bloqueante: 0, mayor: 1, menor: 2 };
  const priRank = Object.fromEntries(Object.keys(PRIORITIES).map((k, i) => [k, i])) as Record<Priority, number>;
  defects.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || priRank[a.priority] - priRank[b.priority]);

  return {
    ready,
    reasons,
    guides: guideVerdicts,
    courier: { n: feedback.length, score: courierScore, issues: cIssues.length, criterion: courierCriterion },
    defects,
    defectTotals,
    generatedAt: new Date().toISOString(),
  };
}
