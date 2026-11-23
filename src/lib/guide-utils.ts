import type { ExpectedItem, Step } from "./types";

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
