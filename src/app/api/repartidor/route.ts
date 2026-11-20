import fs from "node:fs/promises";
import path from "node:path";
import { getDb, now, UPLOAD_DIR } from "@/lib/db";
import { sha256 } from "@/lib/auth";
import { checkCourierToken } from "@/lib/courier-data";
import { COURIER_ID_RE, COURIER_QUESTIONS } from "@/lib/courier";
import { cleanRecord, err, json, str } from "@/lib/http";

const MAX_ISSUES = 30;

/**
 * Guarda la encuesta de un repartidor. El navegador genera el id y el token (guarda el token y aquí
 * solo se guarda su sha256), así que reenviar la misma encuesta (p. ej. tras perder la conexión)
 * la actualiza en lugar de duplicarla. Los problemas se sincronizan con la lista enviada.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return err("Datos inválidos");
  const id = str(body.id, 64);
  const token = str(body.token, 200);
  if (!COURIER_ID_RE.test(id) || token.length < 20) return err("Datos inválidos");
  const name = str(body.name, 120);
  if (!name) return err("Escribe tu nombre");
  const phone = str(body.phone, 40);

  const rawAnswers = body.answers && typeof body.answers === "object" ? (body.answers as Record<string, unknown>) : {};
  const answers: Record<string, number> = {};
  for (const q of COURIER_QUESTIONS) {
    const v = Number(rawAnswers[q.id]);
    if (!Number.isInteger(v) || v < 1 || v > 5) return err(`Falta contestar: «${q.label}»`);
    answers[q.id] = v;
  }
  const comment = str(body.comment, 4000);

  const rawIssues: unknown[] = Array.isArray(body.issues) ? body.issues : [];
  if (rawIssues.length > MAX_ISSUES) return err(`Máximo ${MAX_ISSUES} problemas`);
  const issues: { id: string; description: string }[] = [];
  for (const it of rawIssues) {
    const r = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const issueId = str(r.id, 64);
    const description = str(r.description, 2000);
    if (!COURIER_ID_RE.test(issueId)) return err("Datos inválidos");
    if (!description) return err("Falta escribir qué pasó en un problema");
    issues.push({ id: issueId, description });
  }

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
