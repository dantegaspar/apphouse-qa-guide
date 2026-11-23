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
  /**
   * Pantalla a la que pertenece el paso (los pasos seguidos con el mismo valor se muestran juntos).
   * Opcional: sin este campo los pasos se agrupan solos (ver screensOf en guide-utils).
   */
  screen?: string;
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
  /**
   * Caso de prueba (metodología: pruebas de aceptación basadas en riesgo, ISO/IEC/IEEE 29119-2:2021).
   * critica = flujos de pedido y dinero; alta = lo que ve el cliente; media; baja = consulta.
   * Decide los criterios de salida del veredicto (src/lib/verdict.ts).
   */
  priority?: Priority;
  /** Característica de calidad ISO/IEC 25010:2023 que evalúa principalmente el caso. */
  quality?: string;
  /** Minutos estimados para hacer el caso (eficiencia: se compara con la mediana real). */
  estMin?: number;
  /** Con quién se hace en pareja (p. ej. «Cliente: C06»). */
  pairWith?: string;
};

export const PRIORITIES = {
  critica: "Crítica",
  alta: "Alta",
  media: "Media",
  baja: "Baja",
} as const;
export type Priority = keyof typeof PRIORITIES;

/**
 * Severidad de un hallazgo, con la escala del Plan de pruebas y el Informe de resultados
 * (crítico / alto / medio / bajo):
 * critico = pedidos o cobros perdidos o duplicados, datos expuestos o una vulnerabilidad grave; bloquea la
 *   publicación (solo lo asigna Mesa de control); alto = no se puede seguir con el flujo («No puedo seguir»);
 * medio = el flujo sigue pero el resultado está mal; bajo = texto, apariencia o detalle.
 */
export const SEVERITIES = {
  critico: "Crítico",
  alto: "Alto",
  medio: "Medio",
  bajo: "Bajo",
} as const;
export type Severity = keyof typeof SEVERITIES;
/** Colores de cada severidad (Tailwind). */
export const SEVERITY_CLASS: Record<Severity, string> = {
  critico: "bg-red-200 text-red-900",
  alto: "bg-red-100 text-red-800",
  medio: "bg-amber-100 text-amber-900",
  bajo: "bg-slate-100 text-slate-700",
};
/** Gravedades de la versión anterior (bloqueante / mayor / menor) → escala del Plan. */
export const LEGACY_SEVERITY: Record<string, Severity> = { bloqueante: "alto", mayor: "medio", menor: "bajo" };

/** Revisión de Mesa de control sobre una falla reportada. */
export const TRIAGE = {
  pendiente: "Sin revisar",
  confirmada: "Confirmada",
  no_es_falla: "No es falla",
  duplicada: "Duplicada",
  corregida: "Corregida",
} as const;
export type Triage = keyof typeof TRIAGE;

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
    /**
     * `activities`: actividades en las que se muestra la tabla («E04» o «E04:B» para una parte).
     * `rowActivities`: lo mismo por renglón (mismo orden que `rows`; vacío = en todas las de la tabla).
     * Sin etiquetas, la tabla sale en todas las actividades.
     */
    tables: { title: string; columns: string[]; rows: string[][]; note?: string; activities?: string[]; rowActivities?: string[][] }[];
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
