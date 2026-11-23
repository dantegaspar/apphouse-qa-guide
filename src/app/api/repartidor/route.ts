import fs from "node:fs/promises";
import path from "node:path";
import { getDb, now, UPLOAD_DIR } from "@/lib/db";
import { sha256 } from "@/lib/auth";
import { checkCourierToken } from "@/lib/courier-data";
import { COURIER_QUESTIONS, type CourierAnswer } from "@/lib/courier";
import { cleanRecord, err, hasErrors, invalid, json, readJsonObject } from "@/lib/http";
import {
  collect,
  COURIER_RULES,
  courierAnswerError,
  courierCommentError,
  courierIssueError,
  courierNameError,
  idError,
  isPlainObject,
  objectError,
  phoneError,
  text,
  type FieldErrors,
} from "@/lib/validate";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * Guarda la encuesta de un repartidor. El navegador genera el id y el token (guarda el token y aquí
 * solo se guarda su sha256), así que reenviar la misma encuesta (p. ej. tras perder la conexión)
 * la actualiza en lugar de duplicarla. Los problemas se sincronizan con la lista enviada.
 *
 * Reglas: id (8–64, letras/números/-/_) y token (20–200) del navegador; nombre 2–80; teléfono
 * opcional (números, espacios, + o -, 8–20); answers: cada pregunta conocida con un entero 1–5
 * (o "na" = «No me tocó» en las preguntas que dependen de un pedido) y sin llaves desconocidas; comment ≤2000; issues ≤30, cada uno con id válido (sin repetir) y
 * descripción 3–1000; device objeto plano ≤30 datos, ≤8 KB.
 */
export async function POST(req: Request) {
  const { body, res } = await readJsonObject(req, 256 * 1024);
  if (res) return res;
  const errors: FieldErrors = collect([
    ["id", idError(body.id, { label: "la encuesta" })],
    ["token", typeof body.token === "string" && TOKEN_RE.test(body.token) ? null : "La clave de la encuesta no es válida."],
    ["name", courierNameError(body.name)],
    ["phone", phoneError(body.phone)],
    ["comment", courierCommentError(body.comment)],
    ["device", objectError(body.device, { maxKeys: 30, maxString: 500, maxBytes: 8 * 1024, label: "los datos del celular" })],
  ]);

  const answers: Record<string, CourierAnswer> = {};
  if (!isPlainObject(body.answers)) errors.answers = "Faltan las respuestas.";
  else {
    const known = new Set(COURIER_QUESTIONS.map((q) => q.id));
    for (const k of Object.keys(body.answers)) if (!known.has(k)) errors[`answers.${k.slice(0, 64)}`] = "Esta pregunta no existe.";
    for (const q of COURIER_QUESTIONS) {
      const v = body.answers[q.id];
      if (courierAnswerError(v, q.na)) errors[`answers.${q.id}`] = `Toca una carita en «${q.label}».`;
      else answers[q.id] = v as CourierAnswer;
    }
  }

  const issues: { id: string; description: string }[] = [];
  if (body.issues !== undefined && !Array.isArray(body.issues)) errors.issues = "Los problemas no tienen el formato correcto.";
  const rawIssues: unknown[] = Array.isArray(body.issues) ? body.issues : [];
  if (rawIssues.length > COURIER_RULES.maxIssues) errors.issues = `Máximo ${COURIER_RULES.maxIssues} problemas.`;
  else {
    const seen = new Set<string>();
    rawIssues.forEach((it, i) => {
      const r = isPlainObject(it) ? it : {};
      const idErr = idError(r.id, { label: "el problema" }) || (seen.has(r.id as string) ? "Problema repetido." : null);
      const descErr = courierIssueError(r.description);
      if (idErr) errors[`issues.${i}.id`] = idErr;
      if (descErr) errors[`issues.${i}.description`] = `Problema ${i + 1}: ${descErr.charAt(0).toLowerCase()}${descErr.slice(1)}`;
      if (!idErr && !descErr) issues.push({ id: r.id as string, description: text(r.description) });
      if (typeof r.id === "string") seen.add(r.id);
    });
  }
  if (hasErrors(errors)) return invalid(errors);
  const id = body.id as string;
  const token = body.token as string;
  const name = text(body.name);
  const phone = text(body.phone);
  const comment = text(body.comment);

  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM courier_feedback WHERE id = ?").get(id);
  if (exists && !checkCourierToken(id, token)) return err("Esta encuesta ya existe", 409);

  const ts = now();
  const removedFiles: string[] = [];
  const device = { ...cleanRecord(body.device, 30, 500), ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "" };
  try {
    db.transaction(() => {
      if (exists) {
        db.prepare("UPDATE courier_feedback SET name=?, phone=?, device=?, answers=?, comment=?, updated_at=? WHERE id=?").run(
          name, phone, JSON.stringify(device), JSON.stringify(answers), comment, ts, id
        );
      } else {
        db.prepare(
          `INSERT INTO courier_feedback (id, token_hash, name, phone, device, answers, comment, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(id, sha256(token), name, phone, JSON.stringify(device), JSON.stringify(answers), comment, ts, ts);
      }
      const keep = new Set(issues.map((i) => i.id));
      const current = db.prepare("SELECT id FROM courier_issues WHERE feedback_id = ?").all(id) as { id: string }[];
      for (const c of current) {
        if (keep.has(c.id)) continue;
        const files = db.prepare("SELECT path FROM courier_attachments WHERE issue_id = ?").all(c.id) as { path: string }[];
        removedFiles.push(...files.map((f) => f.path));
        db.prepare("DELETE FROM courier_issues WHERE id = ?").run(c.id);
      }
      const have = new Set(current.map((c) => c.id));
      for (const i of issues) {
        if (have.has(i.id)) db.prepare("UPDATE courier_issues SET description=? WHERE id=?").run(i.description, i.id);
        else db.prepare("INSERT INTO courier_issues (id, feedback_id, description, created_at) VALUES (?,?,?,?)").run(i.id, id, i.description, ts);
      }
    })();
  } catch {
    return err("No se pudo guardar. Inténtalo de nuevo.", 409);
  }
  // Fotos de problemas que el repartidor borró antes de reenviar
  for (const rel of removedFiles) await fs.rm(path.join(/* turbopackIgnore: true */ UPLOAD_DIR, rel), { force: true }).catch(() => {});
  return json({ id });
}
