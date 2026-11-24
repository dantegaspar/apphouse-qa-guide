import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getDb, now } from "./db";
import { GUIDES } from "./guides";
import { loadCourier } from "./courier-data";
import { parseRec } from "./admin-data";
import { computeVerdict, THRESHOLDS } from "./verdict";

/**
 * Dictamen con Claude, en dos pasos:
 *  1. Clasifica cada reporte pendiente, cada «¿Por qué falló?» de E07 y cada problema de repartidor según su
 *     origen: desarrollo, servidor, logística o tester. Lo que no es del desarrollo se cierra
 *     («Ajena al desarrollo» o «Error del tester») y sale del cálculo. Las decisiones de Mesa no se tocan.
 *  2. Con los resultados ya limpios (pruebas completas, sin logística ni errores ajenos), Claude revisa los
 *     criterios de salida fijos (ISO/IEC/IEEE 29119-2 y 29119-3:2021) y redacta el dictamen. Los umbrales no
 *     cambian; el veredicto de la página sigue siendo el cálculo fijo y se muestra si Claude coincide.
 *
 * A Claude no se le mandan nombres, correos ni teléfonos: cada prueba va como T1, T2…
 */

export const CLAUDE_MODEL = "claude-opus-5-5";
/** Precio de lista de Claude Opus 5.5 (USD por millón de tokens) para estimar el costo de cada dictamen. */
const PRICE_IN = 4;
const PRICE_OUT = 20;
const usage = { input: 0, output: 0 };

const ORIGINS = ["desarrollo", "servidor", "logistica", "tester"] as const;
const Origin = z.enum(ORIGINS);
const Sev = z.enum(["critico", "alto", "medio", "bajo"]);

const ClassificationSchema = z.object({
  reportes: z.array(z.object({ id: z.string(), origen: Origin, severidad: Sev, motivo: z.string() })),
  pedidos: z.array(
    z.object({ ref: z.string(), ajenos: z.number().int(), origenes: z.array(Origin), motivo: z.string() })
  ),
  repartidores: z.array(z.object({ ref: z.string(), origen: Origin, motivo: z.string() })),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** Normas y versiones en que se basa el veredicto (se citan siempre en el dictamen). */
export const NORMAS = [
  "ISO/IEC/IEEE 29119-2:2021 · Procesos de prueba: criterios de salida fijados en el plan antes de probar.",
  "ISO/IEC/IEEE 29119-3:2021 · Documentación de prueba: informe de finalización y resultados por actividad.",
  "Plan de pruebas PP-APPHOUSE-ESTRES-001 v1.1 (sección 7.5) e Informe de resultados (plantilla de ISO/IEC/IEEE 29119-3): criterios de participantes.",
  "ISO 9241-11:2018 · Usabilidad (satisfacción): UMUX-Lite (Lewis, Utesch y Maher, 2013) convertido a SUS; 68 = promedio (Sauro, 2011).",
  "Intervalos de confianza del 95 % con Wald ajustado (Agresti-Coull), informativos.",
];

/** Porcentajes y umbrales de aprobación vigentes (salen de THRESHOLDS, no del modelo). */
export function umbralesAprobacion() {
  const T = THRESHOLDS;
  const p = (x: number) => `${Math.round(x * 100)} %`;
  return [
    { criterio: "Pedidos completados de punta a punta (Plan, criterio 1, crítico)", umbral: `≥ ${p(T.endToEnd)}` },
    { criterio: "Pedidos o cobros perdidos o duplicados / hallazgos críticos abiertos (Plan, criterio 2, crítico)", umbral: "0" },
    { criterio: "Cada actividad de los manuales (Informe)", umbral: `≥ ${p(T.activityOk)} «Todo salió bien» y sin hallazgos críticos` },
    { criterio: "Muestra real por rol", umbral: `≥ ${T.minFinished} prueba completa; quienes completan = 100 % de la base` },
    { criterio: "Cobertura de casos por rol", umbral: `≥ ${p(T.coverage)} de los casos; cada caso crítico ≥ ${T.minCriticalRuns} ejecuciones (o todas las pruebas si son menos)` },
    { criterio: "Satisfacción de clientes y establecimientos (SUS equivalente)", umbral: `≥ ${T.sus}` },
    { criterio: "Satisfacción de repartidores (0–100)", umbral: `≥ ${T.courier}` },
  ];
}

const DictamenSchema = z.object({
  veredicto: z.enum(["Sí", "No"]),
  resumen: z.string(),
  criterios: z.array(z.object({ criterio: z.string(), cumple: z.boolean(), comentario: z.string() })),
  justificacion29119: z.string(),
  erroresPorOrigen: z.object({ desarrollo: z.string(), servidor: z.string(), logistica: z.string(), tester: z.string() }),
  recomendaciones: z.array(z.string()),
  /** Normas y versiones citadas por Claude. */
  normasCitadas: z.array(z.string()),
  /** Porcentajes de aprobación citados por Claude. */
  umbralesCitados: z.array(z.object({ criterio: z.string(), umbral: z.string() })),
});
export type Dictamen = z.infer<typeof DictamenSchema>;

export type DictamenRow = {
  id: number;
  created_at: string;
  model: string;
  classification: Classification | null;
  dictamen: Dictamen | null;
  applied: { reportes: number; pedidosAjenos: number; orderAjenos: Record<string, number> } | null;
  error: string;
  /** Costo aproximado en USD (precio de lista), o null si no se registraron tokens. */
  costUsd: number | null;
};

/** Quita correos y teléfonos del texto libre antes de mandarlo. */
const scrub = (s: unknown) =>
  String(s ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo]")
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[teléfono]")
    .slice(0, 1500);

const SYSTEM = `Eres el analista de calidad de una prueba de aceptación con usuarios reales (clientes, establecimientos y repartidores) de AppHouse, una app de pedidos de comida.
La prueba califica ÚNICAMENTE el desarrollo (la app y su panel). Los errores de servidor o infraestructura (correo que no llega, caídas, red), de logística (no se asignó repartidor, el repartidor dejó de contestar o apareció sin conexión) y de los testers (no siguieron la guía, se equivocaron de dato, confundieron un paso) NO cuentan contra el desarrollo.
Responde en español de México, claro y breve. Basa todo en los datos que recibes; no inventes datos.`;

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en el .env del servidor.");
  return new Anthropic();
}

async function ask<T>(schema: z.ZodType<T>, prompt: string, effort: "medium" | "high"): Promise<T> {
  const res = await client().beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content: prompt }],
  });
  const u = res.usage;
  usage.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  usage.output += u.output_tokens ?? 0;
  if (res.stop_reason === "refusal") throw new Error("Claude no quiso procesar estos datos.");
  if (res.stop_reason === "max_tokens") throw new Error("La respuesta de Claude quedó incompleta; vuelve a intentarlo.");
  if (!res.parsed_output) throw new Error("Claude no devolvió el formato esperado.");
  return res.parsed_output as T;
}

type RunRow = { id: string; guide_id: string; status: string };
type IssueRow = { id: string; run_id: string; activity_id: string; severity: string; triage: string; description: string; expected: string };

export async function runDictamen(): Promise<DictamenRow> {
  const db = getDb();
  usage.input = 0;
  usage.output = 0;
  const runs = db.prepare("SELECT id, guide_id, status FROM runs ORDER BY created_at").all() as RunRow[];
  const ref = new Map(runs.map((r, i) => [r.id, `T${i + 1}`]));
  const byRef = new Map(runs.map((r, i) => [`T${i + 1}`, r.id]));
  const titleOf = (guideId: string, actId: string) =>
    GUIDES.find((g) => g.id === guideId)?.activities.find((a) => a.id === actId)?.title ?? "";

  // ---- Paso 1: clasificar lo pendiente
  const pending = db
    .prepare("SELECT id, run_id, activity_id, severity, triage, description, expected FROM issues WHERE kind = 'issue' AND triage = 'pendiente'")
    .all() as IssueRow[];
  const runOf = new Map(runs.map((r) => [r.id, r]));
  const e07 = db.prepare("SELECT run_id, fields FROM activity_results WHERE activity_id = 'E07'").all() as { run_id: string; fields: string }[];
  const failedOrders = e07
    .map((a) => ({ run: a.run_id, f: parseRec(a.fields) }))
    .filter((x) => Number(x.f.ordersFailed) > 0)
    .map((x) => ({ ref: ref.get(x.run) ?? "", fallados: Number(x.f.ordersFailed), porQue: scrub(x.f.failedDetail) }));
  const { feedback, issues: cIssues } = loadCourier();
  const cRef = new Map(feedback.map((f, i) => [f.id, `R${i + 1}`]));
  const courier = cIssues.map((i) => ({ ref: cRef.get(i.feedback_id) ?? "", problema: scrub(i.description) }));

  let classification: Classification = { reportes: [], pedidos: [], repartidores: [] };
  if (pending.length || failedOrders.length || courier.length) {
    const data = {
      reportes: pending.map((i) => {
        const r = runOf.get(i.run_id);
        return {
          id: i.id,
          prueba: ref.get(i.run_id),
          rol: r?.guide_id.startsWith("establecimiento") ? "establecimiento" : "cliente",
          actividad: `${i.activity_id} ${titleOf(r?.guide_id ?? "", i.activity_id)}`,
          severidadDelTester: i.severity,
          queEsperaba: scrub(i.expected),
          queOcurrio: scrub(i.description),
        };
      }),
      pedidosFallados: failedOrders,
      repartidores: courier,
    };
    classification = await ask(
      ClassificationSchema,
      `Clasifica el ORIGEN de cada problema reportado en la prueba:
- "desarrollo": falla de la app o del panel (pantallas, botones, cálculos, estados del pedido, cobros, notificaciones de la app).
- "servidor": infraestructura (correo de acceso o verificación que nunca llega, caída, lentitud del servidor, error 5xx, red).
- "logistica": operación de reparto ajena al software (no hubo repartidor disponible, el repartidor dejó de contestar o apareció sin conexión).
- "tester": el tester se equivocó o no siguió la guía (dato mal escrito, paso saltado, confusión), sin falla real.
Si hay duda razonable entre desarrollo y otra causa, elige "desarrollo".
Para cada reporte da también la severidad del Plan: "critico" solo si hay pedidos o cobros perdidos o duplicados, o datos expuestos; "alto" si no se pudo seguir; "medio" si el flujo sigue pero el resultado está mal; "bajo" para texto o apariencia.
En "pedidos", por cada prueba con pedidos fallados di cuántos (ajenos) NO son del desarrollo según su «por qué falló» (0 si todos son del desarrollo).
Devuelve una entrada por cada reporte (con su id exacto), por cada prueba con pedidos fallados y por cada problema de repartidor.

Datos (JSON):
${JSON.stringify(data)}`,
      "medium"
    );
  }

  // Aplicar: solo a reportes todavía pendientes; Mesa puede cambiarlo después.
  const ids = new Set(pending.map((i) => i.id));
  const upd = db.prepare("UPDATE issues SET triage = ?, severity = ?, triage_note = ?, triage_at = ? WHERE id = ? AND triage = 'pendiente'");
  let applied = 0;
  const ts = now();
  db.transaction(() => {
    for (const c of classification.reportes) {
      if (!ids.has(c.id)) continue;
      const triage = c.origen === "desarrollo" ? "confirmada" : c.origen === "tester" ? "tester" : "externa";
      applied += upd.run(triage, c.severidad, `Claude (${c.origen}): ${c.motivo}`.slice(0, 1000), ts, c.id).changes;
    }
  })();
  const orderAjenos: Record<string, number> = {};
  for (const p of classification.pedidos) {
    const runId = byRef.get(p.ref);
    const max = failedOrders.find((o) => o.ref === p.ref)?.fallados ?? 0;
    if (runId && p.ajenos > 0) orderAjenos[runId] = Math.min(max, p.ajenos);
  }
  const appliedInfo = { reportes: applied, pedidosAjenos: Object.values(orderAjenos).reduce((a, b) => a + b, 0), orderAjenos };
  // Se guarda antes del paso 2 para que el cálculo ya descuente los pedidos ajenos.
  const rowId = Number(
    db
      .prepare("INSERT INTO claude_dictamen (created_at, model, classification, applied) VALUES (?, ?, ?, ?)")
      .run(ts, CLAUDE_MODEL, JSON.stringify(classification), JSON.stringify(appliedInfo)).lastInsertRowid
  );

  // ---- Paso 2: dictamen sobre los resultados limpios y los criterios fijos
  try {
    const v = computeVerdict();
    const clean = {
      veredictoDelCalculoFijo: v.ready ? "Sí" : "No",
      umbrales: THRESHOLDS,
      umbralesDeAprobacion: umbralesAprobacion(),
      normasYVersiones: NORMAS,
      base: { pruebasQueCuentan: v.population.valid, registradas: v.population.total, fueraPor: v.population.counts, actividadesAjenas: v.population.externalActs },
      criteriosDeSalida: [...v.criteria, ...v.guides.filter((g) => !g.guide.hidden).flatMap((g) => g.criteria), ...(v.courier.criterion ? [v.courier.criterion] : [])].map(
        (c) => ({ criterio: c.label, medicion: c.measured, umbral: c.threshold, cumple: c.pass })
      ),
      actividades: v.activities.map((a) => ({ id: a.id, titulo: a.title, prioridad: a.priority, ejecutadas: a.executed, todoBien: a.allOk, porcentaje: a.okRate, criticosAbiertos: a.openCritical, cumple: a.meets })),
      pedidos: { entregados: v.orders.completed, total: v.orders.total, aPropósito: v.orders.intentional, tasa: v.orders.rate, ajenosDescontados: appliedInfo.pedidosAjenos },
      hallazgosAbiertos: v.defects.map((d) => ({ actividad: `${d.activityId} ${d.activityTitle}`, prioridad: d.priority, severidad: d.severity, descripcion: scrub(d.description).slice(0, 400) })),
      clasificacion: {
        desarrollo: classification.reportes.filter((c) => c.origen === "desarrollo").length,
        servidor: classification.reportes.filter((c) => c.origen === "servidor").length,
        logistica: classification.reportes.filter((c) => c.origen === "logistica").length,
        tester: classification.reportes.filter((c) => c.origen === "tester").length,
        motivosNoDesarrollo: classification.reportes.filter((c) => c.origen !== "desarrollo").map((c) => `${c.origen}: ${c.motivo}`).slice(0, 60),
        repartidores: classification.repartidores.map((c) => `${c.origen}: ${c.motivo}`).slice(0, 60),
      },
    };
    const dictamen = await ask(
      DictamenSchema,
      `Emite el dictamen de paso a producción con base en ISO/IEC/IEEE 29119-2:2021 (proceso de prueba: evaluar los criterios de salida definidos en el plan) y 29119-3:2021 (informe de finalización de la prueba).
Reglas:
- Los criterios de salida y sus umbrales son FIJOS: se definieron antes de la prueba. No los cambies, no los relajes ni agregues otros que decidan el veredicto.
- Los datos ya vienen filtrados: solo pruebas completas, sin problemas de logística, y sin errores de servidor ni de testers.
- El veredicto es "Sí" solo si se cumplen TODOS los criterios de salida. Si alguno no se cumple, es "No".
- En "criterios" revisa cada criterio de salida recibido, uno por uno, con un comentario corto.
- En "justificacion29119" explica en 3–5 frases cómo se aplicó la norma (criterios de salida fijos, evaluación, informe).
- En "erroresPorOrigen" resume en una frase cada origen: desarrollo, servidor, logística y tester.
- En "recomendaciones" da de 3 a 6 acciones concretas para el equipo de desarrollo, priorizadas.
- SIEMPRE cita las bases: en "normasCitadas" copia cada norma con su versión de "normasYVersiones"; en "umbralesCitados" copia cada criterio con su porcentaje o umbral de aprobación de "umbralesDeAprobacion". En cada comentario de "criterios" menciona la medición y el umbral (por ejemplo «92 % frente a ≥ 90 %»), y en "resumen" y "justificacion29119" nombra las normas con su año.

Resultados limpios (JSON):
${JSON.stringify(clean)}`,
      "high"
    );
    db.prepare("UPDATE claude_dictamen SET dictamen = ? WHERE id = ?").run(JSON.stringify(dictamen), rowId);
  } catch (e) {
    db.prepare("UPDATE claude_dictamen SET error = ? WHERE id = ?").run(e instanceof Error ? e.message : String(e), rowId);
  }
  db.prepare("UPDATE claude_dictamen SET input_tokens = ?, output_tokens = ? WHERE id = ?").run(usage.input, usage.output, rowId);
  return latestDictamen()!;
}

export function latestDictamen(): DictamenRow | null {
  try {
    const r = getDb().prepare("SELECT * FROM claude_dictamen ORDER BY id DESC LIMIT 1").get() as
      | { id: number; created_at: string; model: string; classification: string; dictamen: string; applied: string; error: string; input_tokens?: number; output_tokens?: number }
      | undefined;
    if (!r) return null;
    const j = (s: string) => {
      try {
        const v = JSON.parse(s);
        return v && typeof v === "object" && Object.keys(v).length ? v : null;
      } catch {
        return null;
      }
    };
    const cost = r.input_tokens || r.output_tokens ? ((r.input_tokens ?? 0) * PRICE_IN + (r.output_tokens ?? 0) * PRICE_OUT) / 1e6 : null;
    return { id: r.id, created_at: r.created_at, model: r.model, classification: j(r.classification), dictamen: j(r.dictamen), applied: j(r.applied), error: r.error, costUsd: cost };
  } catch {
    return null;
  }
}

export const hasClaudeKey = () => !!process.env.ANTHROPIC_API_KEY;

/**
 * ¿Hay que dictaminar con Claude antes de mostrar el veredicto? Sí, si hay pruebas y todavía no hay un
 * dictamen completo, o si después del último llegaron reportes sin revisar, pedidos fallados o problemas
 * de repartidores. Sin ANTHROPIC_API_KEY no se bloquea: se muestra el veredicto del cálculo fijo.
 */
export function dictamenGate() {
  const db = getDb();
  const keyOk = hasClaudeKey();
  const last = latestDictamen();
  const since = last && !last.error && last.dictamen ? last.created_at : "";
  const one = (sql: string, ...a: unknown[]) => {
    try {
      return (db.prepare(sql).get(...a) as { n: number }).n;
    } catch {
      return 0;
    }
  };
  const runs = one("SELECT COUNT(*) AS n FROM runs");
  const pendingReports = one("SELECT COUNT(*) AS n FROM issues WHERE kind = 'issue' AND triage = 'pendiente'");
  const e07 = db.prepare("SELECT fields, updated_at FROM activity_results WHERE activity_id = 'E07'").all() as { fields: string; updated_at: string }[];
  const newOrders = e07.filter((a) => Number(parseRec(a.fields).ordersFailed) > 0 && (!since || a.updated_at > since)).length;
  const newCourier = since ? one("SELECT COUNT(*) AS n FROM courier_issues WHERE created_at > ?", since) : one("SELECT COUNT(*) AS n FROM courier_issues");
  const needed = keyOk && runs > 0 && (!since || pendingReports > 0 || newOrders > 0 || newCourier > 0);
  return { needed, keyOk, pendingReports, newOrders, newCourier };
}
