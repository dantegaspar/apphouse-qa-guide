import type { Severity } from "./types";
import { loadCourier } from "./courier-data";
import { computeVerdict, THRESHOLDS, type Verdict } from "./verdict";

/**
 * Resumen ejecutivo en lenguaje llano a partir del veredicto ya calculado (no cambia el cálculo).
 * Es para personal de cualquier área: sin códigos de actividad (C08, E04-A…), sin siglas de normas y con
 * frases cortas: qué no funcionó, para quién (clientes, establecimientos, repartidores) y a cuántas personas
 * les pasó. El detalle técnico sigue en la sección «Para Sistemas».
 */

export type Audience = "clientes" | "establecimientos" | "repartidores";
export type Tone = "good" | "bad" | "neutral";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  clientes: "Clientes",
  establecimientos: "Establecimientos",
  repartidores: "Repartidores",
};

/** Qué hace la persona en cada actividad, en palabras de todos los días (sin el código). */
export const PLAIN_TASK: Record<string, string> = {
  C01: "Crear su cuenta o entrar a la app",
  C02: "Guardar y editar sus direcciones",
  C03: "Ver el menú y los precios",
  C04: "Ver y usar las promociones",
  C05: "Revisar el carrito antes de pagar",
  C06: "Pagar con tarjeta o en efectivo",
  C07: "Pedir en dos sucursales distintas",
  C08: "Seguir su pedido hasta que llega",
  C09: "Escribirle al repartidor",
  C10: "Hacer un pedido que pasa el monto máximo",
  C11: "Cancelar un pedido",
  C12: "Ver bien las pantallas (textos y botones)",
  C13: "Cerrar y volver a abrir la app",
  E01: "Entrar al panel o a la app del negocio",
  E02: "Poner el horario de la sucursal",
  E03: "Dar de alta un repartidor",
  "E04-A": "Crear el menú",
  "E04-B": "Crear una promoción",
  "E04-C": "Poner el costo de envío",
  "E04-D": "Configurar pagos, montos máximos y horario",
  E05: "Abrir la sucursal para recibir pedidos",
  E06: "Ver a qué sucursal llegó cada pedido",
  E07: "Recibir, confirmar y avanzar los pedidos",
  E08: "Rechazar o cancelar un pedido",
  E09: "Atender pedidos que nadie respondió",
  E10: "Asignar repartidor a un pedido",
  E11: "Ver el tiempo de asignación del repartidor",
};

/** Qué tan grave es un problema, sin la jerga de severidades. */
export const PLAIN_SEVERITY: Record<Severity, string> = {
  critico: "Grave: se pueden perder pedidos o dinero",
  alto: "No dejó terminar la tarea",
  medio: "Se pudo seguir, pero algo salió mal",
  bajo: "Detalle de texto o de apariencia",
};

export const audienceOf = (activityId: string): Audience => (activityId.startsWith("E") ? "establecimientos" : "clientes");
const guideAudience = (guideId: string): Audience => (guideId.startsWith("establecimiento") ? "establecimientos" : "clientes");
export const plainTask = (id: string, title: string) => PLAIN_TASK[id] ?? title.replace(/^Prepara tu sucursal · /, "");

const pct = (x: number) => `${Math.round(x * 100)} %`;
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n = 140) => {
  const t = s.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
/** Calificación de facilidad de uso (escala 0–100, 68 = promedio de referencia) en una palabra. */
export const susWord = (sus: number) => (sus >= 80 ? "Muy buena" : sus >= THRESHOLDS.sus ? "Buena" : sus >= 50 ? "Regular" : "Baja");

export type Problem = {
  audience: Audience;
  task: string;
  /** Personas a las que les falló o no pudieron hacerla. */
  affected: number;
  /** Personas que hicieron la tarea. */
  of: number;
  /** Lo más grave que se reportó (sin revisar o confirmado). */
  severity: Severity | null;
  /** Ejemplos tal como los escribieron los participantes. */
  examples: string[];
};

export type KeyFigure = { id: string; label: string; value: string; detail: string; tone: Tone };

export type PlainSummary = {
  /** null: todavía no hay con qué decidir. */
  ready: boolean | null;
  headline: string;
  /** Una frase: por qué sí o por qué no. */
  why: string;
  /** Otras razones (si hay más de una). */
  moreReasons: string[];
  figures: KeyFigure[];
  problems: Problem[];
  /** Tareas que salieron bien, por público. */
  wentWell: { audience: Audience; ok: number; total: number }[];
  courier: { responses: number; score: number | null; issues: string[] };
  /** Quiénes no se contaron y por qué, en una frase. */
  notCounted: string | null;
};

const SEV_RANK: Record<Severity, number> = { critico: 0, alto: 1, medio: 2, bajo: 3 };

export function buildPlainSummary(v: Verdict, courierIssues: string[] = []): PlainSummary {
  const crit = (id: string) => v.criteria.find((c) => c.id === id);
  const deciding = (c: { pass: boolean; informative?: boolean } | undefined) => !!c && !c.pass && !c.informative;
  const orders = v.orders;

  // ---- Por qué sí / por qué no
  const reasons: string[] = [];
  if (v.population.total === 0) reasons.push("Todavía no hay pruebas registradas.");
  else if (v.population.valid === 0) reasons.push("Todavía nadie ha completado la prueba (terminar y enviar la encuesta final).");
  if (deciding(crit("hallazgos_criticos")))
    reasons.push(
      v.openCritical === 1
        ? "Queda 1 problema grave sin resolver, de los que pueden perder pedidos o dinero."
        : `Quedan ${v.openCritical} problemas graves sin resolver, de los que pueden perder pedidos o dinero.`,
    );
  if (deciding(crit("punta_a_punta")))
    reasons.push(
      orders.total
        ? `Solo ${orders.completed} de ${orders.total} pedidos de prueba (${pct(orders.rate ?? 0)}) llegaron completos al cliente; se necesita al menos ${pct(THRESHOLDS.endToEnd)}.`
        : "Ningún establecimiento anotó sus pedidos, así que no se pudo medir si los pedidos llegan completos.",
    );
  const executed = v.activities.filter((a) => a.meets !== null);
  const notMet = executed.filter((a) => !a.meets);
  if (deciding(crit("actividades"))) {
    const tenth = Math.round((1 - THRESHOLDS.activityOk) * 10);
    reasons.push(
      `En ${pl(notMet.length, "tarea", "tareas")}, a más de ${tenth} de cada 10 personas algo les falló (o quedó un problema grave abierto).`,
    );
  }
  for (const g of v.guides.filter((x) => !x.guide.hidden)) {
    const who = AUDIENCE_LABEL[guideAudience(g.guide.id)].toLowerCase();
    for (const c of g.criteria) {
      if (!deciding(c)) continue;
      if (c.id === "muestra") reasons.push(`Ningún participante de ${who} completó la prueba.`);
      else if (c.id === "cobertura") reasons.push(`Faltó probar algunas tareas de ${who}, o se probaron muy pocas veces.`);
      else if (c.id === "satisfaccion")
        reasons.push(
          g.survey.sus === null
            ? `Los ${who} no contestaron la encuesta de facilidad de uso.`
            : `Los ${who} calificaron la facilidad de uso con ${Math.round(g.survey.sus)} de 100; se pide al menos ${THRESHOLDS.sus}.`,
        );
    }
  }

  const decided = v.population.valid > 0;
  const ready = decided ? v.ready : null;
  let why: string;
  if (ready) {
    why = orders.total
      ? `${orders.completed} de ${orders.total} pedidos de prueba (${pct(orders.rate ?? 0)}) llegaron completos al cliente y no quedó ningún problema grave sin resolver.`
      : "Se cumplieron todas las condiciones acordadas antes de la prueba y no quedó ningún problema grave sin resolver.";
  } else {
    why = reasons[0] ?? "No se cumplieron todas las condiciones acordadas antes de la prueba.";
  }
  const headline =
    ready === null ? "Todavía no hay resultado" : ready ? "Sí, se puede pasar a producción" : "Todavía no se puede pasar a producción";

  // ---- Indicadores clave (pocos)
  const susParts = v.guides
    .filter((g) => !g.guide.hidden && g.survey.sus !== null)
    .map((g) => ({ who: AUDIENCE_LABEL[guideAudience(g.guide.id)], sus: g.survey.sus! }));
  const figures: KeyFigure[] = [
    {
      id: "pedidos",
      label: "Pedidos que llegaron completos",
      value: orders.total ? pct(orders.rate ?? 0) : "—",
      detail: orders.total ? `${orders.completed} de ${orders.total} pedidos · meta: ${pct(THRESHOLDS.endToEnd)} o más` : "Sin pedidos anotados todavía",
      tone: orders.total ? ((orders.rate ?? 0) >= THRESHOLDS.endToEnd ? "good" : "bad") : "neutral",
    },
    {
      id: "graves",
      label: "Problemas graves sin resolver",
      value: String(v.openCritical),
      detail: "Pueden perder pedidos o dinero · meta: 0",
      tone: v.openCritical === 0 ? "good" : "bad",
    },
    {
      id: "personas",
      label: "Personas que completaron la prueba",
      value: String(v.population.valid + v.courier.n),
      detail: [
        pl(v.participants.clientes, "cliente", "clientes"),
        pl(v.participants.establecimientos, "establecimiento", "establecimientos"),
        pl(v.courier.n, "repartidor", "repartidores"),
      ].join(" · "),
      tone: "neutral",
    },
    {
      id: "facilidad",
      label: "Facilidad de uso (0 a 100)",
      value: susParts.length ? susWord(susParts.reduce((s, p) => s + p.sus, 0) / susParts.length) : "—",
      detail: susParts.length
        ? `${susParts.map((p) => `${p.who}: ${Math.round(p.sus)}`).join(" · ")} · ${THRESHOLDS.sus} es el promedio`
        : "Sin encuestas todavía",
      tone: susParts.length ? (susParts.every((p) => p.sus >= THRESHOLDS.sus) ? "good" : "bad") : "neutral",
    },
  ];

  // ---- Qué no funcionó: tareas que no cumplen o con reportes abiertos, por público.
  const problems: Problem[] = v.activities
    .map((a) => {
      const ds = v.defects.filter((d) => d.activityId === a.id);
      const affectedRuns = new Set(ds.map((d) => d.runId)).size;
      const severity = ds.length ? ds.map((d) => d.severity).sort((x, y) => SEV_RANK[x] - SEV_RANK[y])[0] : null;
      return {
        audience: audienceOf(a.id),
        task: plainTask(a.id, a.title),
        affected: Math.max(a.failed + a.blocked, affectedRuns),
        of: Math.max(a.executed, affectedRuns),
        severity,
        examples: [...new Set(ds.map((d) => clip(d.description)).filter(Boolean))].slice(0, 2),
        relevant: a.meets === false || ds.length > 0,
      };
    })
    .filter((p) => p.relevant && p.affected > 0)
    .map((p): Problem => ({ audience: p.audience, task: p.task, affected: p.affected, of: p.of, severity: p.severity, examples: p.examples }))
    .sort(
      (a, b) =>
        (a.severity ? SEV_RANK[a.severity] : 2.5) - (b.severity ? SEV_RANK[b.severity] : 2.5) ||
        b.affected / Math.max(1, b.of) - a.affected / Math.max(1, a.of) ||
        b.affected - a.affected,
    );

  const wentWell = (["clientes", "establecimientos"] as const)
    .map((aud) => {
      const xs = executed.filter((a) => audienceOf(a.id) === aud);
      return { audience: aud, ok: xs.filter((a) => a.meets).length, total: xs.length };
    })
    .filter((x) => x.total > 0);

  const c = v.population.counts;
  const notCountedParts = [
    c.sin_terminar && pl(c.sin_terminar, "persona no terminó la prueba", "personas no terminaron la prueba"),
    c.logistica && pl(c.logistica, "persona tuvo un problema de logística (sin repartidor o sin poder comunicarse con él)", "personas tuvieron un problema de logística (sin repartidor o sin poder comunicarse con él)"),
    c.mesa && pl(c.mesa, "prueba se dejó fuera por un problema ajeno a la app", "pruebas se dejaron fuera por un problema ajeno a la app"),
  ].filter(Boolean) as string[];

  return {
    ready,
    headline,
    why,
    moreReasons: ready ? [] : reasons.filter((r) => r !== why),
    figures,
    problems,
    wentWell,
    courier: { responses: v.courier.n, score: v.courier.score, issues: courierIssues.map((s) => clip(s)).filter(Boolean) },
    notCounted: notCountedParts.length
      ? `No se contaron para el resultado: ${notCountedParts.join("; ")}. Solo se califica la app, no fallas de servidor, correo o red.`
      : null,
  };
}

/** Resumen de la ronda a la vista, con los problemas que reportaron los repartidores (sin las encuestas excluidas por Mesa). */
export function loadPlainSummary(v: Verdict = computeVerdict()): PlainSummary {
  let issues: string[] = [];
  try {
    const c = loadCourier();
    const kept = new Set(c.feedback.filter((f) => f.verdict_scope !== "excluir").map((f) => f.id));
    issues = c.issues.filter((i) => kept.has(i.feedback_id)).map((i) => i.description);
  } catch {
    issues = [];
  }
  return buildPlainSummary(v, issues);
}
