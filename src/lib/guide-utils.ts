import type { ExpectedItem } from "./types";

/** Texto de un resultado esperado (puede venir como string o como objeto). */
export const expectedText = (e: ExpectedItem): string => (typeof e === "string" ? e : e.text);

/** true si el resultado esperado admite «No aplica». */
export const expectedConditional = (e: ExpectedItem): boolean => typeof e !== "string" && !!e.conditional;

/** Valor guardado para un resultado esperado marcado «No aplica» (checks[i] = "na"). */
export const NOT_APPLICABLE = "na" as const;
