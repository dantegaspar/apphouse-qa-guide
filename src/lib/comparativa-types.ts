import type { Severity } from "./types";
import type { Audience } from "./plain-summary";

/**
 * Tipos de la «Comparativa» entre dos encuestas (rondas). Los números (antes, ahora, diferencias, cuántos bugs se
 * solucionaron) los calcula el código en src/lib/comparativa.ts; Claude solo empareja bugs parecidos y redacta.
 */

export type Trend = "mejoro" | "retrocedio" | "igual" | "sin_datos";

export const TREND_LABEL: Record<Trend, string> = {
  mejoro: "Mejoró",
  retrocedio: "Retrocedió",
  igual: "Sin cambio",
  sin_datos: "Sin datos para comparar",
};

/** Indicador general antes / ahora (pedidos completos, problemas graves, facilidad de uso…). */
export type MetricDelta = {
  id: string;
  /** Nombre llano, sin códigos. */
  label: string;
  /** Texto listo para mostrar: «90 % (9 de 10)», «2», «Sí». */
  before: string;
  after: string;
  /** Diferencia legible: «+20 puntos», «−1», «—». */
  delta: string;
  trend: Trend;
  /** true: no decide el veredicto (p. ej. encuesta de repartidores). */
  informative?: boolean;
  /** Frase llana completa: «Pedidos que llegaron completos: antes 80 % (8 de 10), ahora 95 % (19 de 20)». */
  sentence: string;
};

export type ActivitySide = { executed: number; allOk: number; okRate: number | null; meets: boolean | null };

/** Una tarea (actividad de las guías) antes y ahora. */
export type ActivityDelta = {
  /** Código (C08, E04-A…): solo para «Para Sistemas». */
  id: string;
  /** Nombre llano (PLAIN_TASK). */
  task: string;
  audience: Audience;
  before: ActivitySide;
  after: ActivitySide;
  /** Diferencia en puntos porcentuales de «Todo salió bien» (null si falta un lado). */
  deltaPts: number | null;
  trend: Trend;
  /** Menos de 5 personas en algún lado: el cambio es poco confiable. */
  fewPeople: boolean;
  sentence: string;
};

/** Bug del desarrollo (pendiente, confirmado o corregido; NO los reclasificados como ajenos, del tester, «No es falla» o «Duplicada»). */
export type BugRef = {
  id: string;
  activityId: string;
  task: string;
  audience: Audience;
  severity: Severity;
  /** Descripción del tester, recortada y sin correos ni teléfonos. */
  description: string;
  /** Sigue abierto en su encuesta (no está «Corregida» ni cerrado). */
  open: boolean;
  /** Mesa lo marcó «Corregida». */
  markedFixed: boolean;
};

/**
 * Qué pasó en la encuesta nueva con un bug de la encuesta pasada:
 * - persiste: alguien volvió a reportar el mismo problema.
 * - no_se_repitio: la tarea se volvió a probar y nadie lo reportó (se cuenta como solucionado).
 * - sin_verificar: la tarea no se probó en la encuesta nueva.
 */
export type PrevBugStatus = "persiste" | "no_se_repitio" | "sin_verificar";

export const PREV_BUG_LABEL: Record<PrevBugStatus, string> = {
  persiste: "Sigue pasando",
  no_se_repitio: "Solucionado (no se repitió)",
  sin_verificar: "Sin verificar (nadie hizo esa tarea)",
};

export type PrevBugResult = BugRef & {
  status: PrevBugStatus;
  /** Ids de los bugs de la encuesta nueva que son el mismo problema. */
  sameAs: string[];
  /** Por qué Claude los considera el mismo problema (o el motivo del cálculo). */
  reason: string;
  /** Cuántas personas hicieron esa tarea en la encuesta nueva. */
  retestedBy: number;
};

export type ComparisonFacts = {
  base: { id: number; name: string };
  current: { id: number; name: string };
  verdict: { before: boolean | null; after: boolean | null };
  metrics: MetricDelta[];
  activities: ActivityDelta[];
  prevBugs: PrevBugResult[];
  /** Bugs de la encuesta nueva que no son ninguno de la pasada. */
  newBugs: BugRef[];
  bugCounts: { previous: number; solved: number; persist: number; unverified: number; new: number };
  /** Reportes todavía sin revisar en cada encuesta (los números pueden cambiar). */
  pending: { base: number; current: number };
  /** Cómo se emparejaron los bugs: con Claude o solo por tarea (sin Claude). */
  matchedBy: "claude" | "tarea";
  /** Huella de los datos: si cambia, la redacción guardada ya no corresponde. */
  hash: string;
};

/** Lo que redacta Claude (lenguaje llano; sin cifras que no estén en los datos). */
export type ComparisonNarrative = {
  resumen: string;
  puntosClave: string[];
  recomendaciones: string[];
  /** Nota técnica para Sistemas (aquí sí puede usar códigos). */
  notaSistemas: string;
};

export type ComparisonRow = {
  id: number;
  created_at: string;
  model: string;
  base_round: number;
  current_round: number;
  facts_hash: string;
  /** Emparejamiento de bugs devuelto por Claude: id anterior → ids actuales + motivo. */
  matches: { anterior: string; actuales: string[]; motivo: string }[] | null;
  narrative: ComparisonNarrative | null;
  /** Cifras del texto de Claude que no salen del cálculo (debería estar vacío). */
  unverifiedNumbers: string[];
  error: string;
  costUsd: number | null;
};
