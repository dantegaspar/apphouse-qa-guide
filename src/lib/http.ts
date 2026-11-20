import { NextResponse } from "next/server";
import { isPlainObject, summarize, type FieldErrors } from "./validate";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** Respuesta de validación: `{ error, fields: { campo: mensaje } }` (400 por omisión). */
export const invalid = (fields: FieldErrors, status = 400, error?: string) =>
  NextResponse.json({ error: error ?? summarize(fields), fields }, { status });

/** Hay errores de validación. */
export const hasErrors = (fields: FieldErrors) => Object.keys(fields).length > 0;

/**
 * Lee el cuerpo como un objeto JSON plano, con límite de tamaño. Devuelve el objeto o una
 * respuesta de error lista para regresar (413 si es muy grande, 400 si no es un objeto JSON).
 */
export async function readJsonObject(
  req: Request,
  maxBytes = 64 * 1024
): Promise<{ body: Record<string, unknown>; res?: undefined } | { body?: undefined; res: NextResponse }> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) return { res: err(`Los datos enviados pesan demasiado (máximo ${Math.round(maxBytes / 1024)} KB)`, 413) };
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { res: err("No se pudieron leer los datos enviados") };
  }
  if (Buffer.byteLength(raw) > maxBytes) return { res: err(`Los datos enviados pesan demasiado (máximo ${Math.round(maxBytes / 1024)} KB)`, 413) };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { res: err("JSON inválido") };
  }
  if (!isPlainObject(body)) return { res: err("JSON inválido: se esperaba un objeto") };
  return { body };
}

export const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Limita un objeto plano de strings/números/booleanos (para campos libres en JSON). */
export function cleanRecord(v: unknown, maxKeys = 50, maxLen = 1000): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v).slice(0, maxKeys)) {
    const key = k.slice(0, 64);
    if (typeof val === "string") out[key] = val.slice(0, maxLen);
    else if (typeof val === "number" && Number.isFinite(val)) out[key] = val;
    else if (typeof val === "boolean") out[key] = val;
  }
  return out;
}

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 15);
/** Tipos de archivo aceptados como evidencia (imágenes y videos cortos) y su extensión. */
export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
