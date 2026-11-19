import { NextResponse } from "next/server";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

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
