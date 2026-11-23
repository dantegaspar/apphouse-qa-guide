/**
 * Validación de entradas, sin dependencias: la usan las rutas del servidor y algunos formularios del
 * navegador (para que las reglas sean las mismas). Cada función devuelve `null` si el valor es
 * válido, o un mensaje en español sencillo pensado para mostrarse junto al campo.
 *
 * Las rutas juntan los errores en `{ campo: mensaje }` y responden 400 con `{ error, fields }`
 * (ver `invalid` en ./http).
 */
import type { FieldDef, SurveyQuestion } from "./types";
import { daysError, folioTimeError, timeError, timeRangeError } from "./time-fields";
import { COURIER_NA } from "./courier";

export type FieldErrors = Record<string, string>;

/* ---------- Expresiones ---------- */

/** Igual que la validación del formulario de registro del tester. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Teléfono: números, espacios, + o -, de 8 a 20 caracteres. */
export const PHONE_RE = /^[0-9+\- ]{8,20}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids que genera el navegador (uuid o el respaldo de `uid()`), o derivados como `<uuid>-f`. */
export const SAFE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Hora de un <input type="time"> (HH:MM o HH:MM:SS). Los campos de la guía usan time-fields.ts. */
export const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export const NUMBER_RE = /^-?\d+([.,]\d+)?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/* ---------- Básicos ---------- */

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** El texto recortado, o "" si no es texto. */
export const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type TextOpts = { min?: number; max: number; required?: boolean; label?: string };

/** Texto con largo mínimo/máximo (contado sin espacios al inicio y al final). */
export function textError(v: unknown, { min = 0, max, required = false, label = "este dato" }: TextOpts): string | null {
  if (empty(v)) return required || min > 0 ? `Escribe ${label}.` : null;
  if (typeof v !== "string") return `Escribe ${label} como texto.`;
  const t = v.trim();
  if (t.length < min) return `Escribe ${label} con al menos ${plural(min, "letra", "letras")}.`;
  if (t.length > max) return `${capitalize(label)} es muy largo: máximo ${plural(max, "carácter", "caracteres")} (llevas ${t.length}).`;
  return null;
}

export function emailError(v: unknown, { required = false, label = "tu correo" } = {}): string | null {
  if (empty(v)) return required ? `Escribe ${label}.` : null;
  if (typeof v !== "string") return `Escribe ${label} como texto.`;
  const t = v.trim();
  if (t.length > 200 || !EMAIL_RE.test(t)) return `Revisa ${label}: debe verse como nombre@correo.com.`;
  return null;
}

export function phoneError(v: unknown, { required = false } = {}): string | null {
  if (empty(v)) return required ? "Escribe tu teléfono." : null;
  if (typeof v !== "string") return "Escribe el teléfono como texto.";
  const t = v.trim();
  if (!PHONE_RE.test(t) || t.replace(/\D/g, "").length < 8)
    return "Revisa el teléfono: usa solo números, espacios, + o - (de 8 a 20, con al menos 8 números).";
  return null;
}

export function enumError(v: unknown, allowed: readonly unknown[], { required = true, label = "una opción" } = {}): string | null {
  if (v === undefined || v === null) return required ? `Elige ${label}.` : null;
  return allowed.includes(v) ? null : `Elige ${label} de la lista.`;
}

/** Entero dentro de [min, max]. Solo números (no texto). */
export function intError(v: unknown, min: number, max: number, { required = true, label = "un número" } = {}): string | null {
  if (v === undefined || v === null || v === "") return required ? `Elige ${label}.` : null;
  if (typeof v !== "number" || !Number.isInteger(v)) return `Elige ${label} (un número entero).`;
  if (v < min || v > max) return `Elige ${label} entre ${min} y ${max}.`;
  return null;
}

export function boolError(v: unknown, { required = false, label = "sí o no" } = {}): string | null {
  if (v === undefined || v === null) return required ? `Elige ${label}.` : null;
  return typeof v === "boolean" ? null : `Elige ${label}.`;
}

/** Fecha y hora ISO 8601 (p. ej. 2026-11-20T15:04:05.000Z) que además sea una fecha real. */
export function isoDateError(v: unknown, { required = false } = {}): string | null {
  if (empty(v)) return required ? "Falta la fecha." : null;
  if (typeof v !== "string" || !ISO_RE.test(v) || Number.isNaN(Date.parse(v))) return "La fecha no es válida.";
  return null;
}

type IdOpts = { kind?: "uuid" | "safe"; known?: Iterable<string>; required?: boolean; label?: string };

/** Id seguro: uuid, id del navegador (letras, números, - y _) o uno de una lista conocida. */
export function idError(v: unknown, { kind = "safe", known, required = true, label = "el elemento" }: IdOpts = {}): string | null {
  if (empty(v)) return required ? `Falta ${label}.` : null;
  if (typeof v !== "string") return `${capitalize(label)} no es válido.`;
  if (known) {
    for (const k of known) if (k === v) return null;
    return `${capitalize(label)} no existe.`;
  }
  return (kind === "uuid" ? UUID_RE : SAFE_ID_RE).test(v) ? null : `${capitalize(label)} no es válido.`;
}

type ObjOpts = { maxKeys?: number; maxBytes?: number; maxString?: number; required?: boolean; label?: string };

/**
 * Objeto plano y chico (p. ej. los datos del dispositivo): solo textos, números o sí/no,
 * con un máximo de llaves, de largo por texto y de tamaño total en JSON.
 */
export function objectError(v: unknown, { maxKeys = 30, maxBytes = 8 * 1024, maxString = 500, required = false, label = "los datos" }: ObjOpts = {}): string | null {
  if (v === undefined || v === null) return required ? `Faltan ${label}.` : null;
  if (!isPlainObject(v)) return `${capitalize(label)} no tienen el formato correcto.`;
  const entries = Object.entries(v);
  if (entries.length > maxKeys) return `${capitalize(label)} tienen demasiados datos (máximo ${maxKeys}).`;
  for (const [k, val] of entries) {
    if (k.length > 64) return `${capitalize(label)} tienen un nombre de dato demasiado largo.`;
    if (typeof val === "string") {
      if (val.length > maxString) return `${capitalize(label)} tienen un texto demasiado largo («${k}»).`;
    } else if (!(typeof val === "boolean" || (typeof val === "number" && Number.isFinite(val)))) {
      return `${capitalize(label)} solo pueden tener textos, números o sí/no («${k}»).`;
    }
  }
  if (jsonBytes(v) > maxBytes) return `${capitalize(label)} pesan demasiado (máximo ${Math.round(maxBytes / 1024)} KB).`;
  return null;
}

export const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v) ?? "").length;

/**
 * Marcas sí/no (checklists). Las llaves deben estar en `keys` y los valores ser booleanos.
 * Devuelve errores por llave (`prefijo.llave`).
 */
export function boolRecordErrors(v: unknown, keys: Iterable<string>, prefix: string, { required = false, label = "las casillas" } = {}): FieldErrors {
  const out: FieldErrors = {};
  if (v === undefined || v === null) {
    if (required) out[prefix] = `Faltan ${label}.`;
    return out;
  }
  if (!isPlainObject(v)) return { [prefix]: `${capitalize(label)} no tienen el formato correcto.` };
  const allowed = new Set(keys);
  for (const [k, val] of Object.entries(v)) {
    if (!allowed.has(k)) out[`${prefix}.${k.slice(0, 64)}`] = "Esta casilla no existe en la guía.";
    else if (typeof val !== "boolean") out[`${prefix}.${k}`] = "Marca la casilla con sí o no.";
  }
  return out;
}

/* ---------- Campos de la guía (FieldDef) ---------- */

/** Largo máximo por omisión de un campo de la guía sin `maxLength`. */
export const DEFAULT_FIELD_MAX = 500;

const patternCache = new Map<string, RegExp | null>();
function compile(p: string): RegExp | null {
  if (!patternCache.has(p)) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(p);
    } catch {
      re = null; // patrón mal escrito en la guía: no se aplica
    }
    patternCache.set(p, re);
  }
  return patternCache.get(p)!;
}

/**
 * Valida un valor contra la definición del campo (maxLength, pattern o, sin pattern, el formato
 * del tipo). `required` solo se aplica si `enforceRequired` es true. Un valor vacío pasa las
 * demás reglas.
 */
export function fieldDefError(def: FieldDef, v: unknown, { enforceRequired = true } = {}): string | null {
  const label = `«${def.label}»`;
  if (def.type === "orders") return ordersError(def, v, enforceRequired);
  if (empty(v)) return enforceRequired && def.required ? `Completa ${label}.` : null;
  if (typeof v !== "string" && typeof v !== "number") return `${label} debe ser texto.`;
  const t = String(v).trim();
  const max = def.maxLength ?? DEFAULT_FIELD_MAX;
  if (t.length > max) return `${label} es muy largo: máximo ${plural(max, "carácter", "caracteres")}.`;
  // Horas y días (selectores): se revisan siempre, aunque haya pattern. Aceptan los formatos de
  // 24 h que guardan los selectores y los de 12 h («2:15 p.m.») escritos en versiones anteriores.
  const pickerErr =
    def.type === "time"
      ? timeError(t)
      : def.type === "timeRange"
        ? timeRangeError(t)
        : def.type === "folioTime"
          ? folioTimeError(t)
          : def.type === "days"
            ? daysError(t)
            : null;
  if (pickerErr) return `${label}: ${pickerErr.charAt(0).toLowerCase()}${pickerErr.slice(1)}`;
  // Si la guía define un pattern, ese manda sobre el formato de los demás tipos; email siempre se
  // revisa como correo.
  if (def.pattern) {
    const re = compile(def.pattern);
    if (re && !re.test(t)) return def.patternHint || `${label} no tiene el formato esperado.`;
    if (re && def.type !== "email") return null;
  }
  switch (def.type) {
    case "number":
      if (!NUMBER_RE.test(t)) return `${label} debe ser un número (por ejemplo 12).`;
      break;
    case "email":
      if (t.length > 200 || !EMAIL_RE.test(t)) return `Revisa ${label}: debe verse como nombre@correo.com.`;
      break;
  }
  return null;
}

/* ---------- Hoja de pedidos (FieldDef type "orders") ---------- */

export const ORDER_KEYS = ["folio", "arrived", "confirmed", "ready", "rider", "status", "notes"] as const;
export const ORDER_STATUS = ["Entregado", "Rechazado", "Cancelado", "Otro", ""];
export const MAX_ORDER_ROWS = 200;
const MAX_ORDER_TEXT = 500;

/** Renglones de la hoja de pedidos: arreglo (o JSON de un arreglo) de OrderRow. */
export function parseOrders(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const orderFilled = (r: unknown) => isPlainObject(r) && ORDER_KEYS.some((k) => typeof r[k] === "string" && (r[k] as string).trim() !== "");

/**
 * Hoja de pedidos: hasta 200 renglones con solo las llaves de OrderRow (textos ≤500, status de la
 * lista). Si es obligatoria, al menos un renglón con folio. El pattern/maxLength del campo no se
 * aplican (son para la versión de texto libre).
 */
function ordersError(def: FieldDef, v: unknown, enforceRequired: boolean): string | null {
  const label = `«${def.label}»`;
  const rows = empty(v) ? [] : parseOrders(v);
  if (!rows) return `${label} no tiene el formato correcto.`;
  if (rows.length > MAX_ORDER_ROWS) return `${label}: máximo ${MAX_ORDER_ROWS} pedidos.`;
  for (const [i, r] of rows.entries()) {
    if (!isPlainObject(r)) return `${label}: el pedido ${i + 1} no tiene el formato correcto.`;
    for (const [k, val] of Object.entries(r)) {
      if (!(ORDER_KEYS as readonly string[]).includes(k)) return `${label}: el pedido ${i + 1} tiene un dato desconocido.`;
      if (typeof val !== "string") return `${label}: el pedido ${i + 1} tiene un dato que no es texto.`;
      if (val.length > MAX_ORDER_TEXT) return `${label}: el pedido ${i + 1} tiene un texto demasiado largo.`;
      if (k === "status" && !ORDER_STATUS.includes(val)) return `${label}: elige el estado del pedido ${i + 1} de la lista.`;
    }
  }
  if (enforceRequired && def.required && !rows.some((r) => isPlainObject(r) && typeof r.folio === "string" && r.folio.trim()))
    return `Agrega al menos un pedido con su folio en ${label}.`;
  return null;
}

/** Valor que se guarda para un campo (las hojas de pedidos se guardan como JSON sin renglones vacíos). */
function storedValue(def: FieldDef, v: unknown): string {
  if (def.type === "orders") return JSON.stringify((parseOrders(v) ?? []).filter(orderFilled));
  return String(v).trim();
}

/**
 * Valida un objeto de campos libres contra sus definiciones. Llaves desconocidas o valores que no
 * son texto/número son error. Devuelve los valores limpios (texto recortado) y los errores por campo.
 */
export function fieldsCheck(
  v: unknown,
  defs: FieldDef[],
  prefix: string,
  { enforceRequired = true } = {}
): { values: Record<string, string>; errors: FieldErrors; missing: FieldErrors } {
  const values: Record<string, string> = {};
  const errors: FieldErrors = {};
  const missing: FieldErrors = {};
  if (v !== undefined && v !== null && !isPlainObject(v)) {
    errors[prefix] = "Los datos anotados no tienen el formato correcto.";
    return { values, errors, missing };
  }
  const raw = (v ?? {}) as Record<string, unknown>;
  const byId = new Map(defs.map((d) => [d.id, d]));
  for (const k of Object.keys(raw)) if (!byId.has(k)) errors[`${prefix}.${k.slice(0, 64)}`] = "Este dato no existe en la guía.";
  for (const d of defs) {
    const val = raw[d.id];
    const e = fieldDefError(d, val, { enforceRequired: false });
    if (e) errors[`${prefix}.${d.id}`] = e;
    else if (d.type === "orders") {
      const stored = empty(val) ? "[]" : storedValue(d, val);
      if (stored !== "[]") values[d.id] = stored;
      const req = d.required ? ordersError(d, val, true) : null;
      if (req) missing[`${prefix}.${d.id}`] = req;
    } else if (!empty(val)) values[d.id] = storedValue(d, val);
    else if (d.required) missing[`${prefix}.${d.id}`] = `Completa «${d.label}».`;
  }
  if (enforceRequired) Object.assign(errors, missing);
  return { values, errors, missing };
}

/* ---------- Encuesta ---------- */

export const SURVEY_TEXT_MAX = 2000;

/** Rango de una pregunta de escala o NPS. */
export const surveyRange = (q: SurveyQuestion): [number, number] => (q.type === "nps" ? [0, 10] : [q.min ?? 1, q.max ?? 5]);

/** Valida la respuesta a una pregunta según su tipo. Con `partial` (borrador) no exige las obligatorias. */
export function surveyAnswerError(q: SurveyQuestion, v: unknown, { partial = false } = {}): string | null {
  if (empty(v)) return q.required && !partial ? "Contesta esta pregunta." : null;
  switch (q.type) {
    case "scale":
    case "nps": {
      const [min, max] = surveyRange(q);
      return intError(v, min, max, { label: "un valor" });
    }
    case "choice":
      return typeof v === "string" && (q.options ?? []).includes(v) ? null : "Elige una de las opciones.";
    case "text":
      return textError(v, { max: SURVEY_TEXT_MAX, label: "tu respuesta" });
  }
  return "Tipo de pregunta desconocido.";
}

/* ---------- Encuesta de repartidores (mismas reglas en el navegador y en el servidor) ---------- */

export const COURIER_RULES = {
  name: { min: 2, max: 80 },
  comment: { max: 2000 },
  issue: { min: 3, max: 1000 },
  maxIssues: 30,
} as const;

export const courierNameError = (v: unknown) => textError(v, { ...COURIER_RULES.name, required: true, label: "tu nombre" });
export const courierCommentError = (v: unknown) => textError(v, { ...COURIER_RULES.comment, label: "tu comentario" });
export const courierIssueError = (v: unknown) => textError(v, { ...COURIER_RULES.issue, required: true, label: "qué pasó" });
/** Carita 1–5; con `allowNa`, también «no aplica» (COURIER_NA). */
export const courierAnswerError = (v: unknown, allowNa = false): string | null =>
  allowNa && v === COURIER_NA ? null : intError(v, 1, 5) ? "Toca una carita." : null;

/* ---------- Utilidades ---------- */

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Primer mensaje (para `error`) o un resumen si hay varios. */
export function summarize(errors: FieldErrors): string {
  const msgs = Array.from(new Set(Object.values(errors)));
  if (msgs.length === 0) return "Datos inválidos";
  if (msgs.length === 1) return msgs[0];
  return `Revisa ${msgs.length} datos: ${msgs.slice(0, 3).join(" ")}${msgs.length > 3 ? " …" : ""}`;
}

/** Junta errores en un objeto, ignorando los null. */
export function collect(entries: [string, string | null][]): FieldErrors {
  const out: FieldErrors = {};
  for (const [k, e] of entries) if (e) out[k] = e;
  return out;
}
