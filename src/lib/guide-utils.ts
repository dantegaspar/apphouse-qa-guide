import type { Activity, ExpectedItem, FieldDef, Guide, Step } from "./types";

/** Texto de un resultado esperado (puede venir como string o como objeto). */
export const expectedText = (e: ExpectedItem): string => (typeof e === "string" ? e : e.text);

/** true si el resultado esperado admite «No aplica». */
export const expectedConditional = (e: ExpectedItem): boolean => typeof e !== "string" && !!e.conditional;

/** Valor guardado para un resultado esperado marcado «No aplica» (checks[i] = "na"). */
export const NOT_APPLICABLE = "na" as const;

/** Una pantalla de la actividad: varios pasos seguidos que se muestran juntos. */
export type Screen = { steps: Step[]; start: number };

const MAX_STEPS = 4;
const MAX_IMAGES = 3;
const MAX_CHARS = 650;

/**
 * Agrupa los pasos de una actividad en pantallas (instrucciones + capturas + formulario breve).
 * - Si algún paso trae `screen`, los pasos seguidos con el mismo valor van juntos.
 * - Si no, se agrupan solos: hasta 4 pasos, 3 capturas y ~650 caracteres por pantalla; una
 *   parte nueva (A, B, C…) empieza pantalla y un paso de confirmación (checkpoint) la cierra.
 */
export function screensOf(steps: Step[]): Screen[] {
  const screens: Screen[] = [];
  const explicit = steps.some((s) => s.screen);
  const letter = (id: string) => id.match(/^([A-Z])(?:\d|-)/)?.[1];
  let cur: Screen | null = null;
  let chars = 0;
  steps.forEach((s, i) => {
    let split = !cur;
    if (cur) {
      const prev = cur.steps[cur.steps.length - 1];
      if (explicit) split = (s.screen ?? prev.screen) !== prev.screen || (!s.screen && !!prev.checkpoint);
      else {
        const imgs = cur.steps.filter((x) => x.image).length;
        split =
          !!prev.checkpoint ||
          letter(s.id) !== letter(prev.id) ||
          cur.steps.length >= MAX_STEPS ||
          (!!s.image && imgs >= MAX_IMAGES) ||
          (!s.checkpoint && chars + s.text.length > MAX_CHARS);
      }
    }
    if (split) {
      cur = { steps: [], start: i };
      screens.push(cur);
      chars = 0;
    }
    cur!.steps.push(s);
    chars += s.checkpoint ? 0 : s.text.length;
  });
  return screens;
}

/** Una captura de una pantalla de la guía (la primera vez que la usa un paso, con su leyenda). */
export type ScreenImage = { src: string; caption?: string; stepId: string };

/**
 * Capturas distintas de los pasos de una pantalla, en orden. Si varios pasos usan la misma captura,
 * se muestra una sola vez (antes se repetía en cada paso).
 */
export function screenImages(steps: Step[]): ScreenImage[] {
  const seen = new Set<string>();
  const out: ScreenImage[] = [];
  for (const s of steps) {
    if (!s.image || seen.has(s.image)) continue;
    seen.add(s.image);
    out.push({ src: s.image, caption: s.caption, stepId: s.id });
  }
  return out;
}

/**
 * Pregunta de facilidad al cerrar cada actividad: Single Ease Question (SEQ, Sauro y Dumas, 2009), escala
 * de 1 a 7. Se guarda en el campo `seq` de la actividad (`guide.seq`).
 */
export const SEQ = {
  field: "seq",
  label: "¿Qué tan fácil o difícil fue hacer esta actividad?",
  min: 1,
  max: 7,
  minLabel: "Muy difícil",
  maxLabel: "Muy fácil",
} as const;

/** Definición del campo SEQ para validar en el servidor y mostrar su nombre en Admin y en las exportaciones. */
export const SEQ_FIELD: FieldDef = {
  id: SEQ.field,
  label: "Facilidad de la actividad (1 = muy difícil, 7 = muy fácil)",
  type: "number",
  pattern: `^[${SEQ.min}-${SEQ.max}]$`,
  patternHint: `Elige del ${SEQ.min} al ${SEQ.max} qué tan fácil fue.`,
};

/** Campos que acepta una actividad: los suyos y, si la guía pregunta la facilidad (`guide.seq`), el SEQ. */
export const activityFieldDefs = (guide: Pick<Guide, "seq"> | null | undefined, act: Pick<Activity, "fields"> | null | undefined): FieldDef[] =>
  guide?.seq ? [...(act?.fields ?? []), SEQ_FIELD] : (act?.fields ?? []);
