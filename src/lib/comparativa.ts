import crypto from "node:crypto";
import { z } from "zod";
import { getDb, now } from "./db";
import { listRounds, runInRound, withRound } from "./rounds";
import { computeVerdict, THRESHOLDS, type Verdict } from "./verdict";
import { AUDIENCE_LABEL, audienceOf, plainTask, PLAIN_SEVERITY, susWord } from "./plain-summary";
import { askClaude, CLAUDE_MODEL, PRICE_IN, PRICE_OUT, scrub } from "./claude-dictamen";
import type { Severity } from "./types";
import type {
  ActivityDelta,
  ActivitySide,
  BugRef,
  ComparisonFacts,
  ComparisonNarrative,
  ComparisonRow,
  MetricDelta,
  PrevBugResult,
  PrevBugStatus,
  Trend,
} from "./comparativa-types";

/**
 * «Comparativa» entre dos encuestas (rondas): qué mejoró, qué retrocedió y qué bugs de la encuesta pasada se
 * solucionaron.
 *
 * - Todo sale de computeVerdict de cada ronda, así que se respetan las mismas reglas del veredicto: solo cuenta el
 *   desarrollo; pruebas sin terminar o con logística fuera; reportes reclasificados (ajena, tester, «No es falla»,
 *   «Duplicada», descartada) no son bugs. No hay métricas de bots ni de carga del servidor.
 * - Los números (antes, ahora, diferencias y conteos de bugs) se calculan aquí. Claude solo hace dos cosas:
 *   1) decide qué reportes de la encuesta nueva son el MISMO problema que un bug de la pasada (juicio sobre texto);
 *   2) redacta el resumen en lenguaje llano a partir de los números ya calculados.
 *   Las cifras del texto de Claude se revisan contra las del cálculo; las que no coinciden se avisan.
 */

/** Cambio mínimo para decir que una tarea mejoró o retrocedió (puntos porcentuales de «Todo salió bien»). */
export const ACTIVITY_MIN_PTS = 10;
/** Cambio mínimo en pedidos completos (puntos porcentuales). */
export const ORDERS_MIN_PTS = 5;
/** Cambio mínimo en facilidad de uso (escala 0–100). */
export const SUS_MIN_PTS = 5;
/** Con menos personas que esto en algún lado, el cambio se marca «pocas personas». */
export const FEW_PEOPLE = 5;

const pct = (x: number) => `${Math.round(x * 100)} %`;
const signed = (n: number, unit = "") => (n > 0 ? `+${n}${unit}` : n < 0 ? `−${Math.abs(n)}${unit}` : `0${unit}`);
const clip = (s: string, n = 220) => {
  const t = scrub(s).replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const yesNo = (b: boolean | null) => (b === null ? "Sin resultado" : b ? "Sí" : "No");

/** Encuesta anterior a la que está a la vista (para la comparación por omisión). */
export function defaultPair(view: number): { base: number | null; current: number } {
  const ids = listRounds().map((r) => r.id);
  const prev = ids.filter((id) => id < view);
  return { base: prev.length ? prev[prev.length - 1] : null, current: view };
}

// ---------------------------------------------------------------------------- indicadores generales

/** Tendencia de un valor donde «más es mejor» (o «menos es mejor» si lowerIsBetter). */
function trendOf(before: number | null, after: number | null, minDiff: number, lowerIsBetter = false): Trend {
  if (before === null || after === null) return "sin_datos";
  const d = (after - before) * (lowerIsBetter ? -1 : 1);
  if (d >= minDiff) return "mejoro";
  if (d <= -minDiff) return "retrocedio";
  return "igual";
}

/** Si cruzó la meta (de no cumplir a cumplir o al revés), eso decide la tendencia aunque el cambio sea chico. */
function withGoal(t: Trend, metBefore: boolean | null, metAfter: boolean | null): Trend {
  if (metBefore === null || metAfter === null || metBefore === metAfter) return t;
  return metAfter ? "mejoro" : "retrocedio";
}

const decided = (v: Verdict) => (v.population.valid > 0 ? v.ready : null);
const susOf = (v: Verdict, aud: "clientes" | "establecimientos") =>
  v.guides.find((g) => !g.guide.hidden && (aud === "establecimientos" ? g.guide.id.startsWith("establecimiento") : !g.guide.id.startsWith("establecimiento")))?.survey ?? null;
/** Bugs del desarrollo abiertos (sin «Corregida» ni reclasificados). */
const openDevBugs = (v: Verdict) => v.bugTypes.reduce((s, b) => s + b.open, 0);

function buildMetrics(a: Verdict, b: Verdict): MetricDelta[] {
  const out: MetricDelta[] = [];
  const va = decided(a), vb = decided(b);
  out.push({
    id: "veredicto",
    label: "¿Se puede pasar a producción?",
    before: yesNo(va),
    after: yesNo(vb),
    delta: va === vb ? "—" : vb ? "Ahora sí" : "Ahora no",
    trend: va === null || vb === null ? "sin_datos" : va === vb ? "igual" : vb ? "mejoro" : "retrocedio",
    sentence:
      va === null || vb === null
        ? "Todavía no hay resultado en alguna de las dos encuestas."
        : va === vb
          ? `El resultado no cambió: ${vb ? "sí se puede" : "todavía no se puede"} pasar a producción.`
          : vb
            ? "Antes no se podía pasar a producción; ahora sí."
            : "Antes sí se podía pasar a producción; ahora no.",
  });

  const oa = a.orders, ob = b.orders;
  const ra = oa.total ? oa.rate ?? 0 : null, rb = ob.total ? ob.rate ?? 0 : null;
  const ordersTrend = withGoal(
    trendOf(ra === null ? null : Math.round(ra * 100), rb === null ? null : Math.round(rb * 100), ORDERS_MIN_PTS),
    ra === null ? null : ra >= THRESHOLDS.endToEnd,
    rb === null ? null : rb >= THRESHOLDS.endToEnd,
  );
  const ordersText = (o: Verdict["orders"], r: number | null) => (r === null ? "sin pedidos anotados" : `${pct(r)} (${o.completed} de ${o.total})`);
  out.push({
    id: "pedidos",
    label: "Pedidos que llegaron completos",
    before: ordersText(oa, ra),
    after: ordersText(ob, rb),
    delta: ra === null || rb === null ? "—" : `${signed(Math.round(rb * 100) - Math.round(ra * 100))} puntos`,
    trend: ordersTrend,
    sentence: `Pedidos que llegaron completos al cliente: antes ${ordersText(oa, ra)}, ahora ${ordersText(ob, rb)} (meta: ${pct(THRESHOLDS.endToEnd)} o más).`,
  });

  out.push({
    id: "graves",
    label: "Problemas graves sin resolver",
    before: String(a.openCritical),
    after: String(b.openCritical),
    delta: signed(b.openCritical - a.openCritical),
    trend: a.population.total && b.population.total ? trendOf(a.openCritical, b.openCritical, 1, true) : "sin_datos",
    sentence: `Problemas graves sin resolver (pueden perder pedidos o dinero): antes ${a.openCritical}, ahora ${b.openCritical} (meta: 0).`,
  });

  const oba = openDevBugs(a), obb = openDevBugs(b);
  out.push({
    id: "bugs_abiertos",
    label: "Problemas de la app sin resolver",
    before: String(oba),
    after: String(obb),
    delta: signed(obb - oba),
    trend: a.population.total && b.population.total ? trendOf(oba, obb, 1, true) : "sin_datos",
    sentence: `Problemas de la app sin resolver (de cualquier gravedad): antes ${oba}, ahora ${obb}.`,
  });

  const meets = (v: Verdict) => {
    const xs = v.activities.filter((x) => x.meets !== null);
    return { ok: xs.filter((x) => x.meets).length, total: xs.length };
  };
  const ma = meets(a), mb = meets(b);
  const mra = ma.total ? ma.ok / ma.total : null, mrb = mb.total ? mb.ok / mb.total : null;
  out.push({
    id: "tareas",
    label: "Tareas que salieron bien",
    before: ma.total ? `${ma.ok} de ${ma.total}` : "sin datos",
    after: mb.total ? `${mb.ok} de ${mb.total}` : "sin datos",
    delta: mra === null || mrb === null ? "—" : `${signed(Math.round(mrb * 100) - Math.round(mra * 100))} puntos`,
    trend: trendOf(mra === null ? null : Math.round(mra * 100), mrb === null ? null : Math.round(mrb * 100), ACTIVITY_MIN_PTS),
    sentence: `Tareas en las que a casi todos les salió bien: antes ${ma.total ? `${ma.ok} de ${ma.total}` : "sin datos"}, ahora ${mb.total ? `${mb.ok} de ${mb.total}` : "sin datos"}.`,
  });

  for (const aud of ["clientes", "establecimientos"] as const) {
    const sa = susOf(a, aud), sb = susOf(b, aud);
    const xa = sa?.sus ?? null, xb = sb?.sus ?? null;
    const txt = (x: number | null, n: number) => (x === null ? "sin respuestas" : `${Math.round(x)} de 100, ${susWord(x).toLowerCase()} (${n} ${n === 1 ? "respuesta" : "respuestas"})`);
    out.push({
      id: `facilidad_${aud}`,
      label: `Facilidad de uso · ${AUDIENCE_LABEL[aud]}`,
      before: xa === null ? "sin respuestas" : String(Math.round(xa)),
      after: xb === null ? "sin respuestas" : String(Math.round(xb)),
      delta: xa === null || xb === null ? "—" : `${signed(Math.round(xb) - Math.round(xa))} puntos`,
      trend: withGoal(
        trendOf(xa === null ? null : Math.round(xa), xb === null ? null : Math.round(xb), SUS_MIN_PTS),
        xa === null ? null : xa >= THRESHOLDS.sus,
        xb === null ? null : xb >= THRESHOLDS.sus,
      ),
      sentence: `Facilidad de uso según los ${AUDIENCE_LABEL[aud].toLowerCase()}: antes ${txt(xa, sa?.n ?? 0)}, ahora ${txt(xb, sb?.n ?? 0)} (${THRESHOLDS.sus} es el promedio).`,
    });
  }

  out.push({
    id: "personas",
    label: "Personas que completaron la prueba",
    before: String(a.population.valid + a.courier.n),
    after: String(b.population.valid + b.courier.n),
    delta: signed(b.population.valid + b.courier.n - (a.population.valid + a.courier.n)),
    trend: "igual",
    informative: true,
    sentence: `Personas que completaron la prueba: antes ${a.population.valid + a.courier.n}, ahora ${b.population.valid + b.courier.n}.`,
  });

  // Repartidores: solo informativo (medida de percepción; no decide el veredicto).
  const ca = a.courier.score, cb = b.courier.score;
  if (ca !== null || cb !== null)
    out.push({
      id: "repartidores",
      label: "Opinión de los repartidores",
      before: ca === null ? "sin respuestas" : `${Math.round(ca)} de 100`,
      after: cb === null ? "sin respuestas" : `${Math.round(cb)} de 100`,
      delta: ca === null || cb === null ? "—" : `${signed(Math.round(cb) - Math.round(ca))} puntos`,
      trend: trendOf(ca === null ? null : Math.round(ca), cb === null ? null : Math.round(cb), SUS_MIN_PTS),
      informative: true,
      sentence: `Opinión de los repartidores sobre la app (solo informativo): antes ${ca === null ? "sin respuestas" : `${Math.round(ca)} de 100`}, ahora ${cb === null ? "sin respuestas" : `${Math.round(cb)} de 100`}.`,
    });
  return out;
}

// ---------------------------------------------------------------------------- tareas

function buildActivities(a: Verdict, b: Verdict): ActivityDelta[] {
  const side = (v: Verdict, id: string): ActivitySide => {
    const r = v.activities.find((x) => x.id === id);
    return r ? { executed: r.executed, allOk: r.allOk, okRate: r.okRate, meets: r.meets } : { executed: 0, allOk: 0, okRate: null, meets: null };
  };
  const ids = [...new Set([...a.activities.map((x) => x.id), ...b.activities.map((x) => x.id)])];
  return ids.map((id) => {
    const title = (b.activities.find((x) => x.id === id) ?? a.activities.find((x) => x.id === id))!.title;
    const before = side(a, id), after = side(b, id);
    const pa = before.okRate === null ? null : Math.round(before.okRate * 100);
    const pb = after.okRate === null ? null : Math.round(after.okRate * 100);
    const deltaPts = pa === null || pb === null ? null : pb - pa;
    const trend = withGoal(trendOf(pa, pb, ACTIVITY_MIN_PTS), before.meets, after.meets);
    const task = plainTask(id, title);
    const audience = audienceOf(id);
    const txt = (s: ActivitySide) => (s.executed ? `a ${s.allOk} de ${s.executed} ${s.executed === 1 ? "persona" : "personas"} les salió todo bien (${pct(s.okRate ?? 0)})` : "nadie la hizo");
    return {
      id,
      task,
      audience,
      before,
      after,
      deltaPts,
      trend,
      fewPeople: trend !== "sin_datos" && (before.executed < FEW_PEOPLE || after.executed < FEW_PEOPLE),
      sentence: `${task} (${AUDIENCE_LABEL[audience].toLowerCase()}): antes ${txt(before)}; ahora ${txt(after)}.`,
    };
  });
}

// ---------------------------------------------------------------------------- bugs

/** Bugs del desarrollo de una encuesta: pendientes, confirmados o corregidos (los reclasificados no son bugs). */
function devBugs(v: Verdict): BugRef[] {
  const titleOf = (id: string) => v.activities.find((x) => x.id === id)?.title ?? "";
  return v.bugTypes.flatMap((t) =>
    t.examples.map((e) => ({
      id: e.id,
      activityId: e.activityId,
      task: plainTask(e.activityId, titleOf(e.activityId)),
      audience: audienceOf(e.activityId),
      severity: e.severity,
      description: clip(e.description),
      open: e.open,
      markedFixed: !e.open,
    })),
  );
}

type Match = { anterior: string; actuales: string[]; motivo: string };

/**
 * Estado de cada bug de la encuesta pasada. Con el emparejamiento de Claude, «sigue pasando» = Claude encontró el
 * mismo problema en la encuesta nueva. Sin Claude, se compara por tarea (si en la misma tarea hay un bug nuevo, se
 * toma como que sigue). En ambos casos: si nadie volvió a hacer esa tarea, queda «sin verificar».
 */
function resolveBugs(prev: BugRef[], curr: BugRef[], b: Verdict, matches: Match[] | null) {
  const currIds = new Set(curr.map((x) => x.id));
  const byPrev = new Map((matches ?? []).map((m) => [m.anterior, m]));
  const retested = (activityId: string) => b.activities.find((x) => x.id === activityId)?.executed ?? 0;
  const used = new Set<string>();
  const results: PrevBugResult[] = prev.map((p) => {
    const n = retested(p.activityId);
    let sameAs: string[];
    let reason: string;
    if (matches) {
      const m = byPrev.get(p.id);
      sameAs = (m?.actuales ?? []).filter((id) => currIds.has(id));
      reason = m?.motivo ?? "";
    } else {
      sameAs = curr.filter((c) => c.activityId === p.activityId).map((c) => c.id);
      reason = sameAs.length ? "Hay reportes nuevos en la misma tarea (comparación por tarea, sin Claude)." : "";
    }
    let status: PrevBugStatus;
    if (sameAs.length) status = "persiste";
    else if (n > 0) status = "no_se_repitio";
    else status = "sin_verificar";
    if (status === "no_se_repitio" && !reason) reason = `La tarea se volvió a probar (${n} ${n === 1 ? "persona" : "personas"}) y nadie reportó este problema.`;
    if (status === "sin_verificar" && !reason) reason = "Nadie volvió a hacer esta tarea en la encuesta nueva.";
    for (const id of sameAs) used.add(id);
    return { ...p, status, sameAs, reason, retestedBy: n };
  });
  const newBugs = curr.filter((c) => !used.has(c.id));
  const count = (s: PrevBugStatus) => results.filter((r) => r.status === s).length;
  return {
    prevBugs: results,
    newBugs,
    bugCounts: { previous: prev.length, solved: count("no_se_repitio"), persist: count("persiste"), unverified: count("sin_verificar"), new: newBugs.length },
  };
}

// ---------------------------------------------------------------------------- armado

const pendingOf = (round: number) => {
  try {
    return (getDb().prepare(`SELECT COUNT(*) AS n FROM issues WHERE kind = 'issue' AND triage = 'pendiente' AND ${runInRound("run_id", round)}`).get() as { n: number }).n;
  } catch {
    return 0;
  }
};

type Raw = { a: Verdict; b: Verdict; prev: BugRef[]; curr: BugRef[]; metrics: MetricDelta[]; activities: ActivityDelta[]; hash: string };

function raw(base: number, current: number): Raw {
  const a = withRound(base, () => computeVerdict(base));
  const b = withRound(current, () => computeVerdict(current));
  const prev = devBugs(a);
  const curr = devBugs(b);
  const metrics = buildMetrics(a, b);
  const activities = buildActivities(a, b);
  // Huella de lo que se le manda a Claude: si algo cambia (un reporte nuevo, una reclasificación), la redacción ya no corresponde.
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ base, current, metrics, activities, prev: prev.map((x) => [x.id, x.severity, x.open, x.description]), curr: curr.map((x) => [x.id, x.severity, x.open, x.description]) }))
    .digest("hex")
    .slice(0, 16);
  return { a, b, prev, curr, metrics, activities, hash };
}

/** Comparación calculada (sin llamar a Claude). `matches`: el emparejamiento de bugs que devolvió Claude, si lo hay. */
export function buildComparison(base: number, current: number, matches: Match[] | null = null, r: Raw = raw(base, current)): ComparisonFacts {
  const rounds = listRounds();
  const name = (id: number) => rounds.find((x) => x.id === id)?.name ?? `Encuesta ${id}`;
  return {
    base: { id: base, name: name(base) },
    current: { id: current, name: name(current) },
    verdict: { before: decided(r.a), after: decided(r.b) },
    metrics: r.metrics,
    activities: r.activities,
    ...resolveBugs(r.prev, r.curr, r.b, matches),
    pending: { base: pendingOf(base), current: pendingOf(current) },
    matchedBy: matches ? "claude" : "tarea",
    hash: r.hash,
  };
}

/** Último resultado de Claude para el par de encuestas. */
export function latestComparativa(base: number, current: number): ComparisonRow | null {
  try {
    const r = getDb()
      .prepare(`SELECT * FROM claude_comparativa WHERE base_round = ? AND current_round = ? ORDER BY id DESC LIMIT 1`)
      .get(base, current) as
      | { id: number; created_at: string; model: string; base_round: number; current_round: number; facts_hash: string; matches: string; narrative: string; unverified: string; error: string; input_tokens: number; output_tokens: number }
      | undefined;
    if (!r) return null;
    const j = <T>(s: string): T | null => {
      try {
        return s ? (JSON.parse(s) as T) : null;
      } catch {
        return null;
      }
    };
    return {
      id: r.id,
      created_at: r.created_at,
      model: r.model,
      base_round: r.base_round,
      current_round: r.current_round,
      facts_hash: r.facts_hash,
      matches: j<Match[]>(r.matches),
      narrative: j<ComparisonNarrative>(r.narrative),
      unverifiedNumbers: j<string[]>(r.unverified) ?? [],
      error: r.error,
      costUsd: r.input_tokens || r.output_tokens ? (r.input_tokens * PRICE_IN + r.output_tokens * PRICE_OUT) / 1e6 : null,
    };
  } catch {
    return null;
  }
}

/** Lo que muestra la página: números calculados + lo último de Claude para ese par. */
export function loadComparison(base: number, current: number): { facts: ComparisonFacts; row: ComparisonRow | null; stale: boolean } {
  const r = raw(base, current);
  const row = latestComparativa(base, current);
  const fresh = !!row && row.facts_hash === r.hash;
  // El emparejamiento de Claude solo se usa si se hizo con estos mismos datos.
  const facts = buildComparison(base, current, fresh && row?.matches ? row.matches : null, r);
  return { facts, row, stale: !!row && !fresh };
}

// ---------------------------------------------------------------------------- verificación de cifras

/** Números que aparecen en un texto («90 %», «3 de 10», «−2»): se comparan sin signo ni separadores. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => String(Number(m[0].replace(",", "."))));
}

/** Cifras del texto de Claude que no están en los datos que recibió (debería salir vacío). */
export function unverifiedNumbers(texts: string[], facts: unknown): string[] {
  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  // Los números que no son cifras del resultado (listas, «1 de cada 10», la meta del 90 %) también se permiten.
  for (const n of [0, 1, 2, 3, 4, 5, 10, 100, Math.round(THRESHOLDS.endToEnd * 100), Math.round(THRESHOLDS.activityOk * 100), THRESHOLDS.sus, 2026]) allowed.add(String(n));
  return [...new Set(texts.flatMap(numbersIn).filter((n) => !allowed.has(n)))];
}

// ---------------------------------------------------------------------------- Claude

const SYSTEM = `Eres el analista de calidad que compara dos rondas de una prueba de aceptación con usuarios reales (clientes, establecimientos y repartidores) de AppHouse, una app de pedidos de comida.
La prueba califica ÚNICAMENTE el desarrollo (la app y su panel). Los datos ya vienen limpios con las reglas del veredicto: no cuentan pruebas sin terminar ni con problemas de logística, y los reportes reclasificados como ajenos (servidor, red, correo), del tester, configuración de la sucursal, versión vieja de la app, «No es falla» o «Duplicada» no son bugs. La opinión de los repartidores es solo informativa. No hay métricas de bots ni de carga del servidor y no debes hablar de ellas.
Responde en español de México. No inventes datos.`;

const MatchSchema = z.object({
  coincidencias: z.array(z.object({ anterior: z.string(), actuales: z.array(z.string()), motivo: z.string() })),
});

const NarrativeSchema = z.object({
  resumen: z.string(),
  puntosClave: z.array(z.string()),
  recomendaciones: z.array(z.string()),
  notaSistemas: z.string(),
});

/** Datos que recibe Claude para redactar: los mismos números de la página, ya calculados. */
function factsForClaude(f: ComparisonFacts) {
  return {
    encuestaAnterior: f.base.name,
    encuestaNueva: f.current.name,
    sePuedePasarAProduccion: { antes: yesNo(f.verdict.before), ahora: yesNo(f.verdict.after) },
    indicadores: f.metrics.map((m) => ({ indicador: m.label, antes: m.before, ahora: m.after, diferencia: m.delta, tendencia: m.trend, ...(m.informative ? { soloInformativo: true } : {}) })),
    tareas: f.activities
      .filter((a) => a.trend !== "sin_datos")
      .map((a) => ({
        codigo: a.id,
        tarea: a.task,
        publico: AUDIENCE_LABEL[a.audience],
        antes: `${a.before.allOk} de ${a.before.executed}`,
        ahora: `${a.after.allOk} de ${a.after.executed}`,
        diferenciaPuntos: a.deltaPts,
        tendencia: a.trend,
        ...(a.fewPeople ? { pocasPersonas: true } : {}),
      })),
    bugsDeLaEncuestaPasada: {
      total: f.bugCounts.previous,
      solucionados: f.bugCounts.solved,
      siguenPasando: f.bugCounts.persist,
      sinVerificar: f.bugCounts.unverified,
      detalle: f.prevBugs.map((p) => ({ tarea: p.task, gravedad: PLAIN_SEVERITY[p.severity], estado: p.status, problema: p.description.slice(0, 160) })).slice(0, 60),
    },
    bugsNuevos: { total: f.bugCounts.new, detalle: f.newBugs.map((n) => ({ tarea: n.task, gravedad: PLAIN_SEVERITY[n.severity], problema: n.description.slice(0, 160) })).slice(0, 40) },
    reportesSinRevisar: { anterior: f.pending.base, nueva: f.pending.current },
  };
}

const bugForMatch = (x: BugRef) => ({ id: x.id, codigo: x.activityId, tarea: x.task, gravedad: x.severity as Severity, problema: x.description });

/**
 * Pide a Claude el emparejamiento de bugs y la redacción, y lo guarda. Los números no cambian: se recalculan con el
 * emparejamiento y se le pasan ya hechos para que redacte.
 */
export async function runComparativa(base: number, current: number): Promise<ComparisonRow> {
  const acc = { input: 0, output: 0 };
  const db = getDb();
  const r = raw(base, current);
  const rowId = Number(
    db.prepare("INSERT INTO claude_comparativa (created_at, model, base_round, current_round, facts_hash) VALUES (?, ?, ?, ?, ?)").run(now(), CLAUDE_MODEL, base, current, r.hash)
      .lastInsertRowid,
  );
  try {
    // Paso 1: qué bugs de la encuesta nueva son el mismo problema que uno de la pasada.
    let matches: Match[] = [];
    if (r.prev.length && r.curr.length) {
      const res = await askClaude(
        MatchSchema,
        `Compara los bugs de dos rondas de prueba. Para CADA bug de «anteriores», di qué bugs de «actuales» son el MISMO problema (la misma falla de la app vuelta a reportar, aunque la escriba otra persona con otras palabras). Puede no haber ninguno, o varios.
Reglas:
- Solo es el mismo problema si describe la misma falla, normalmente en la misma tarea (mismo código). Un problema distinto en la misma tarea NO es el mismo.
- Si la descripción es demasiado vaga para saberlo (p. ej. «no pude»), no lo emparejes salvo que el otro diga lo mismo en la misma tarea.
- Usa los ids exactos. Un bug actual puede emparejarse con más de un anterior si repite varios.
- En "motivo" explica en una frase corta por qué es (o no es) el mismo problema.
Devuelve una entrada por cada bug de «anteriores».

Datos (JSON):
${JSON.stringify({ anteriores: r.prev.map(bugForMatch), actuales: r.curr.map(bugForMatch) })}`,
        "medium",
        { system: SYSTEM, acc },
      );
      const prevIds = new Set(r.prev.map((x) => x.id));
      matches = res.coincidencias.filter((m) => prevIds.has(m.anterior));
    }
    db.prepare("UPDATE claude_comparativa SET matches = ? WHERE id = ?").run(JSON.stringify(matches), rowId);

    // Paso 2: redactar con los números ya calculados (con el emparejamiento aplicado).
    const facts = buildComparison(base, current, matches, r);
    const data = factsForClaude(facts);
    const narrative = await askClaude(
      NarrativeSchema,
      `Redacta la comparativa entre «${facts.base.name}» y «${facts.current.name}» para personal de todas las áreas, SIN conocimientos técnicos.
Responde estas preguntas: ¿Qué mejoró? ¿Se tuvo un retroceso? ¿Se solucionaron los bugs de la encuesta pasada?
Reglas:
- Usa SOLO las cifras que vienen en los datos, tal cual. No calcules cifras nuevas (ni sumas, ni porcentajes, ni diferencias que no estén). Si no hace falta una cifra, no la pongas.
- En "resumen", "puntosClave" y "recomendaciones": lenguaje llano, frases cortas, sin códigos de tareas (C08, E04-A…), sin siglas, sin nombres de normas y sin la palabra «bug» (di «problema» o «falla»). Usa el nombre de la tarea ("tarea") y para quién es (clientes, establecimientos, repartidores).
- Las tareas con "pocasPersonas" tienen poca gente: dilo si las mencionas. Lo "soloInformativo" no decide el resultado.
- "resumen": 2 a 4 frases que respondan las tres preguntas y digan si el resultado de pasar a producción cambió.
- "puntosClave": de 3 a 6 puntos, primero lo más importante (problemas graves, pedidos, retrocesos).
- "recomendaciones": de 2 a 4 acciones concretas para la siguiente ronda (qué revisar o volver a probar).
- "notaSistemas": 2 a 4 frases técnicas para el área de Sistemas; aquí sí puedes usar los códigos de tarea.
- No hables de métricas de bots ni de carga del servidor.

Datos (JSON):
${JSON.stringify(data)}`,
      "medium",
      { system: SYSTEM, acc },
    );
    const unverified = unverifiedNumbers([narrative.resumen, ...narrative.puntosClave, ...narrative.recomendaciones, narrative.notaSistemas], data);
    db.prepare("UPDATE claude_comparativa SET narrative = ?, unverified = ? WHERE id = ?").run(JSON.stringify(narrative), JSON.stringify(unverified), rowId);
  } catch (e) {
    db.prepare("UPDATE claude_comparativa SET error = ? WHERE id = ?").run(e instanceof Error ? e.message : String(e), rowId);
  }
  db.prepare("UPDATE claude_comparativa SET input_tokens = ?, output_tokens = ? WHERE id = ?").run(acc.input, acc.output, rowId);
  return latestComparativa(base, current)!;
}
