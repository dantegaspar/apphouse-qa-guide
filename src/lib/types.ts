export type FieldDef = {
  id: string;
  label: string;
  type?: "text" | "number" | "time" | "email";
  placeholder?: string;
  required?: boolean;
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
};

export type Activity = {
  id: string;
  title: string;
  when: string;
  where: string;
  warnings?: string[];
  notes?: string;
  steps: Step[];
  expected: string[];
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
  finish: { checklist: { id: string; label: string }[] };
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
