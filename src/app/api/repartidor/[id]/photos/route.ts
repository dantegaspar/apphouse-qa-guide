import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb, now, UPLOAD_DIR } from "@/lib/db";
import { checkCourierToken } from "@/lib/courier-data";
import { ALLOWED_PHOTO_TYPES, guessPhotoMime } from "@/lib/courier";
import { ALLOWED_MIME, err, hasErrors, invalid, json, MAX_UPLOAD_MB, str } from "@/lib/http";
import { collect, idError } from "@/lib/validate";

const MAX_PER_ISSUE = 3;

/**
 * Sube la foto de pantalla de un problema. Solo imágenes. Idempotente si se manda photoId.
 * Reglas: issueId obligatorio y photoId opcional (ids del navegador); una imagen no vacía de
 * ALLOWED_PHOTO_TYPES de hasta MAX_UPLOAD_MB; máximo 3 fotos por problema.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkCourierToken(id, req.headers.get("x-courier-token"))) return err("No autorizado", 401);
  const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes + 64 * 1024) return err(`La foto pasa el límite de ${MAX_UPLOAD_MB} MB`, 413);

  const form = await req.formData().catch(() => null);
  if (!form) return invalid({ file: "Falta la foto." });
  const file = form.get("file");
  const rawIssue = form.get("issueId");
  const rawPhoto = form.get("photoId");
  const issueId = typeof rawIssue === "string" ? rawIssue : "";
  const photoId = typeof rawPhoto === "string" ? rawPhoto : "";
  const errors = collect([
    ["issueId", idError(issueId, { label: "el problema" })],
    ["photoId", idError(photoId, { required: false, label: "la foto" })],
    ["file", !(file instanceof File) ? "Falta la foto." : file.size === 0 ? "La foto está vacía." : null],
  ]);
  if (hasErrors(errors)) return invalid(errors);
  if (!(file instanceof File)) return invalid({ file: "Falta la foto." });
  if (file.size > maxBytes) return invalid({ file: `La foto pasa el límite de ${MAX_UPLOAD_MB} MB.` }, 413);
  // Algunos celulares mandan la foto sin tipo: se deduce por la extensión
  const mime = file.type || guessPhotoMime(file.name);
  const ext = ALLOWED_MIME[mime];
  if (!ext || !ALLOWED_PHOTO_TYPES.includes(mime)) return invalid({ file: "Solo se aceptan fotos (JPG, PNG, WebP, GIF, HEIC)." }, 415);

  const db = getDb();
  if (!db.prepare("SELECT 1 FROM courier_issues WHERE id=? AND feedback_id=?").get(issueId, id)) return err("Problema no encontrado", 404);
  if (photoId) {
    const prev = db.prepare("SELECT issue_id, size FROM courier_attachments WHERE id = ?").get(photoId) as { issue_id: string; size: number } | undefined;
    if (prev) return prev.issue_id === issueId ? json({ id: photoId, size: prev.size }) : err("Datos inválidos", 409);
  }
  const count = (db.prepare("SELECT COUNT(*) c FROM courier_attachments WHERE issue_id=?").get(issueId) as { c: number }).c;
  if (count >= MAX_PER_ISSUE) return invalid({ file: `Máximo ${MAX_PER_ISSUE} fotos por problema.` });

  const attId = photoId || crypto.randomUUID();
  const rel = path.join(/* turbopackIgnore: true */ "courier", id, `${attId}.${ext}`);
  const abs = path.join(/* turbopackIgnore: true */ UPLOAD_DIR, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()));
  db.prepare(
    "INSERT INTO courier_attachments (id, feedback_id, issue_id, original_name, mime, size, path, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(attId, id, issueId, str(file.name, 200) || `captura.${ext}`, mime, file.size, rel, now());
  return json({ id: attId, size: file.size });
}
