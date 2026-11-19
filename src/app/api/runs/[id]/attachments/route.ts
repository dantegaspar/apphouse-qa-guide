import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb, now, UPLOAD_DIR } from "@/lib/db";
import { checkRunToken } from "@/lib/auth";
import { ALLOWED_MIME, err, json, MAX_UPLOAD_MB, str } from "@/lib/http";

/** Sube una captura o video corto ligado a un reporte (issue) de la corrida. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes + 64 * 1024) return err(`El archivo pasa el límite de ${MAX_UPLOAD_MB} MB`, 413);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const issueId = str(form?.get("issueId"), 64);
  if (!(file instanceof File) || !issueId) return err("Falta el archivo");
  if (file.size > maxBytes) return err(`El archivo pasa el límite de ${MAX_UPLOAD_MB} MB`, 413);
  const ext = ALLOWED_MIME[file.type];
  if (!ext) return err("Solo se aceptan imágenes (JPG, PNG, WebP, HEIC) o videos (MP4, MOV, WebM)", 415);

  const db = getDb();
  const owns = db.prepare("SELECT 1 FROM issues WHERE id=? AND run_id=?").get(issueId, id);
  if (!owns) return err("Reporte no encontrado; guarda el reporte antes de subir archivos", 404);
  const count = (db.prepare("SELECT COUNT(*) c FROM attachments WHERE issue_id=?").get(issueId) as { c: number }).c;
  if (count >= 5) return err("Máximo 5 archivos por reporte", 400);

  const attId = crypto.randomUUID();
  const rel = path.join(/* turbopackIgnore: true */ id, `${attId}.${ext}`);
  const abs = path.join(/* turbopackIgnore: true */ UPLOAD_DIR, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()));
  db.prepare(
    "INSERT INTO attachments (id, run_id, issue_id, original_name, mime, size, path, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(attId, id, issueId, str(file.name, 200) || `captura.${ext}`, file.type, file.size, rel, now());
  return json({ id: attId, size: file.size });
}
