import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb, now, UPLOAD_DIR } from "@/lib/db";
import { checkRunToken } from "@/lib/auth";
import { ALLOWED_MIME, err, invalid, json, MAX_UPLOAD_MB, str } from "@/lib/http";
import { idError } from "@/lib/validate";

const MAX_PER_ISSUE = 5;

/**
 * Sube una captura o video corto ligado a un reporte (issue) de la corrida.
 * Reglas: issueId (id del navegador) de un reporte de esta corrida; un archivo no vacío de
 * ALLOWED_MIME (imágenes y videos) de hasta MAX_UPLOAD_MB; máximo 5 archivos por reporte.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes + 64 * 1024) return err(`El archivo pasa el límite de ${MAX_UPLOAD_MB} MB`, 413);

  const form = await req.formData().catch(() => null);
  if (!form) return invalid({ file: "Falta el archivo." });
  const file = form.get("file");
  const rawIssue = form.get("issueId");
  const issueErr = idError(typeof rawIssue === "string" ? rawIssue : undefined, { label: "el reporte" });
  if (issueErr) return invalid({ issueId: issueErr });
  const issueId = rawIssue as string;
  if (!(file instanceof File)) return invalid({ file: "Falta el archivo." });
  if (file.size === 0) return invalid({ file: "El archivo está vacío." });
  if (file.size > maxBytes) return invalid({ file: `El archivo pasa el límite de ${MAX_UPLOAD_MB} MB.` }, 413);
  const ext = ALLOWED_MIME[file.type];
  if (!ext) return invalid({ file: "Solo se aceptan imágenes (JPG, PNG, WebP, GIF, HEIC) o videos (MP4, MOV, WebM)." }, 415);

  const db = getDb();
  const owns = db.prepare("SELECT 1 FROM issues WHERE id=? AND run_id=?").get(issueId, id);
  if (!owns) return err("Reporte no encontrado; guarda el reporte antes de subir archivos", 404);
  const count = (db.prepare("SELECT COUNT(*) c FROM attachments WHERE issue_id=?").get(issueId) as { c: number }).c;
  if (count >= MAX_PER_ISSUE) return invalid({ file: `Máximo ${MAX_PER_ISSUE} archivos por reporte.` });

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
