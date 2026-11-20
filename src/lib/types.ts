export type FieldDef = {
  id: string;
  label: string;
  /**
   * Tipo de entrada (por omisión "text"). Las horas y días se eligen con selectores, no se escriben:
   * - "time": selector de hora con botón «Ahora»; se guarda "14:35" (24 h). Se aceptan valores
   *   viejos como «2:15 p.m.».
   * - "timeRange": dos selectores «De … a …»; se guarda "14:00 a 17:00" (cierre después de apertura).
   * - "folioTime": folio del pedido + selector de hora; se guarda "261120-0004 · 14:35".
   * - "days": botones Lun … Dom; se guarda "Lun, Mar, Vie" (de lunes a domingo).
   * - "orders": tabla de pedidos (Hoja de pedidos, E07) con botón «Agregar pedido»; el valor se
   *   guarda como JSON (OrderRow[]), con las horas como "14:35".
   */
  type?: "text" | "number" | "time" | "timeRange" | "folioTime" | "days" | "email" | "orders";
  placeholder?: string;
  required?: boolean;
  /** Regex (sin delimitadores) que debe cumplir el valor, p. ej. un folio "^\\d{6}-\\d{4}$". */
  pattern?: string;
  /** Mensaje en lenguaje simple si no cumple el pattern. */
  patternHint?: string;
  maxLength?: number;
};

export type Step = {
  id: string;
  text: string;
  image?: string;
  caption?: string;
  /** El manual pide una captura como evidencia en este paso. */
  evidence?: boolean;
  /** Muestra en el paso un botón con pulso que abre "Datos para tu sucursal" (hoja de referencia). */
  dataButton?: boolean;
  /**
   * Paso de confirmación: el tester debe marcar todas las casillas antes de poder avanzar
   * (p. ej. al cerrar cada Parte A–E de E04).
   */
  checkpoint?: { title: string; items: string[] };
  /** Paso que depende de algo («Si te pide…»): muestra un tercer botón «No me apareció» (terminado, sin falla). */
  conditional?: boolean;
  /** Aviso en amarillo dentro de este paso (p. ej. «No toques Cerrar ahora»). */
  warning?: string;
};

/** Resultado esperado: texto simple, o con conditional=true para ofrecer Sí · No · No aplica. */
export type ExpectedItem = string | { text: string; conditional?: boolean };

/** Renglón de la Hoja de pedidos (FieldDef type "orders"). */
export type OrderRow = {
  folio: string;
  /** Horas "14:35" (24 h); hojas guardadas antes pueden traer «3:14 p.m.». */
  arrived: string;
  confirmed: string;
  ready: string;
  rider: string;
  status: "Entregado" | "Rechazado" | "Cancelado" | "Otro" | "";
  notes: string;
};

export type Activity = {
  id: string;
  title: string;
  when: string;
  where: string;
  warnings?: string[];
  notes?: string;
  steps: Step[];
  expected: ExpectedItem[];
  fields?: FieldDef[];
};

export type SurveyQuestion = {
  id: string;
  type: "scale" | "nps" | "choice" | "text";
  label: string;
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  options?: string[];
  required?: boolean;
};

export type Guide = {
  id: string;
  version: string;
  role: string;
  title: string;
  subtitle: string;
  summary: string;
  source?: string;
  notice?: string;
  glossary?: string;
  /**
   * Id de otra guía para celular (p. ej. la app nativa). En teléfonos se abre esa guía en lugar
   * de esta; el tester puede cambiar de guía antes de identificarse.
   */
  mobileGuideId?: string;
  /** No aparece en la lista de guías de la portada (p. ej. la variante para celular). */
  hidden?: boolean;
  /**
   * Diseño de la interfaz del tester. "desktop": en pantallas de computadora (≥1024 px) usa barra
   * lateral, pasos en dos columnas y capturas grandes. Por omisión "mobile" (una columna angosta).
   */
  layout?: "desktop" | "mobile";
  /**
   * Las actividades hasta esta (incluida) van en orden. Al guardarla se abren todas las demás a la vez,
   * y cualquier actividad guardada se puede reabrir y editar hasta que el tester toque «Terminar».
   * Sin este campo, todas van en orden estricto.
   */
  sequentialUntil?: string;
  tester: { fields: FieldDef[] };
  prep: {
    title: string;
    sections: { title: string; items: string[] }[];
    checklist: { id: string; label: string }[];
    rules: string[];
    tour?: { title: string; image?: string; caption?: string; items: string[] };
  };
  reference: {
    title: string;
    intro?: string;
    tables: { title: string; columns: string[]; rows: string[][]; note?: string }[];
  };
  troubleshooting: [string, string][];
  activities: Activity[];
  /** Texto que va arriba de la lista de cierre (p. ej. «Cuando Mesa de control dé por terminada la prueba…»). */
  finish: { text?: string; checklist: { id: string; label: string }[] };
  /** Ejemplo para el campo de descripción del formulario «Reportar una falla». */
  reportExample?: string;
  /** Ejemplo de número de pedido con la fecha de la prueba (p. ej. «Ej. 261120-0004»). */
  orderExample?: string;
  survey: { title: string; intro?: string; questions: SurveyQuestion[] };
};

export const ACTIVITY_RESULTS = {
  ok: "Todo salió bien",
  issue: "Tuvo alguna falla",
  blocked: "No pude hacerla por otro problema",
  skipped: "No me tocó",
} as const;
export type ActivityResult = keyof typeof ACTIVITY_RESULTS;

export const TESTER_ROLES = ["Cliente final", "Establecimiento", "Repartidor", "Coordinación / QA", "Otro"];

export type GuideVariant = "desktop" | "mobile";
