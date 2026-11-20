import type { FieldDef } from "@/lib/types";
import { daysError, folioTimeError, timeError, timeRangeError } from "@/lib/time-fields";

/** Errores por campo: id → mensaje en español simple. */
export type Errors = Record<string, string>;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Límites del texto libre (el servidor recorta en 4000; aquí avisamos antes). */
export const LIMITS = {
  name: 80,
  email: 120,
  field: 200,
  description: 2000,
  expected: 2000,
  orderNumber: 40,
  notes: 2000,
  reason: 1000,
  surveyText: 2000,
};

export function validateName(v: string): string | null {
  const t = v.trim();
  if (!t) return "Escribe tu nombre y apellido.";
  if (t.length < 2) return "Tu nombre es muy corto: escribe al menos 2 letras.";
  if (t.length > LIMITS.name) return `Tu nombre es muy largo (máximo ${LIMITS.name} caracteres).`;
  return null;
}

export function validateEmail(v: string, required = true): string | null {
  const t = v.trim();
  if (!t) return required ? "Escribe tu correo." : null;
  if (t.length > LIMITS.email) return "El correo es demasiado largo.";
  if (!EMAIL_RE.test(t)) return "Revisa el correo: debe verse como nombre@ejemplo.com.";
  return null;
}

/** Mensaje de obligatorio para los campos que se llenan con selectores. */
const REQUIRED_MSG: Record<string, string> = {
  time: "Elige la hora (o toca «Ahora»).",
  timeRange: "Elige la hora en que abre y la hora en que cierra.",
  folioTime: "Escribe el folio y elige la hora.",
  days: "Elige al menos un día.",
};

/**
 * Valida un campo definido en la guía (datos del tester o «Anota» al cerrar una actividad).
 * `requireFilled: false` omite la regla de obligatorio (p. ej. si la actividad «No me tocó»).
 */
export function validateField(f: FieldDef, raw: string | undefined, requireFilled = true): string | null {
  const v = (raw ?? "").trim();
  if (!v) return f.required && requireFilled ? (REQUIRED_MSG[f.type ?? ""] ?? "Este dato es obligatorio.") : null;
  const max = f.maxLength ?? (f.type === "email" ? LIMITS.email : LIMITS.field);
  if (v.length > max) return `Máximo ${max} caracteres (llevas ${v.length}).`;
  if (f.type === "number" && !/^-?\d+([.,]\d+)?$/.test(v)) return f.patternHint || "Escribe solo números, por ejemplo 12.";
  // Horas y días vienen de selectores (14:35, «14:00 a 17:00», «261120-0004 · 14:35», «Lun, Vie»);
  // también se aceptan los formatos escritos a mano en versiones anteriores (2:15 p.m.).
  const typeErr =
    f.type === "time" ? timeError(v) : f.type === "timeRange" ? timeRangeError(v) : f.type === "folioTime" ? folioTimeError(v) : f.type === "days" ? daysError(v) : null;
  if (typeErr) return typeErr;
  if (f.type === "email" && !EMAIL_RE.test(v)) return "Revisa el correo: debe verse como nombre@ejemplo.com.";
  if (f.pattern) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(f.pattern);
    } catch {
      re = null; // patrón mal escrito en la guía: no bloquea al tester
    }
    if (re && !re.test(v)) return f.patternHint || "El formato no es el esperado. Revisa el ejemplo.";
  }
  return null;
}

export function validateFields(defs: FieldDef[], values: Record<string, string>, requireFilled = true): Errors {
  const out: Errors = {};
  for (const f of defs) {
    const e = validateField(f, values[f.id], requireFilled);
    if (e) out[f.id] = e;
  }
  return out;
}

export function trimAll(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, (v ?? "").trim()]));
}

/** Tipos y tamaño de archivo aceptados (mismas reglas que el servidor). */
export function validateFile(file: File, allowedMime: string[], maxMb: number): string | null {
  const type = file.type || guessMime(file.name);
  if (allowedMime.length && !allowedMime.includes(type))
    return `«${file.name}» no se puede subir: solo se aceptan fotos (JPG, PNG, WebP, GIF, HEIC) o videos (MP4, MOV, WebM).`;
  if (file.size > maxMb * 1024 * 1024)
    return `«${file.name}» pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${maxMb} MB. Graba un video más corto o manda una captura.`;
  return null;
}

function guessMime(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
  };
  return map[ext] ?? "";
}

/**
 * Lleva la vista y el foco al primer campo con error dentro de `root` (o de la página).
 * Busca `[aria-invalid="true"]` o, si no hay campo enfocable, `[data-error]`.
 */
export function focusFirstError(root?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const scope: ParentNode = root ?? document;
    const el = scope.querySelector<HTMLElement>('[aria-invalid="true"], [data-error="true"]');
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    const focusable = el.matches("input, textarea, select, button")
      ? el
      : el.querySelector<HTMLElement>("input, textarea, select, button");
    focusable?.focus({ preventScroll: true });
  });
}
