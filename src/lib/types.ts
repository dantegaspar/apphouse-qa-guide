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
