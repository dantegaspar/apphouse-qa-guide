import { getDb, now } from "@/lib/db";
import { checkCourierToken } from "@/lib/courier-data";
import { err, hasErrors, invalid, json, readJsonObject } from "@/lib/http";
import { collect, courierIssueError, idError, text } from "@/lib/validate";

/**
 * Agrega un problema a una encuesta ya enviada (solo quien la envió, con su token). Idempotente por id.
 * Reglas: id del navegador (8–64); descripción obligatoria 3–1000.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkCourierToken(id, req.headers.get("x-courier-token"))) return err("No autorizado", 401);
  const { body, res } = await readJsonObject(req, 16 * 1024);
  if (res) return res;
  const errors = collect([
    ["id", idError(body.id, { label: "el problema" })],
    ["description", courierIssueError(body.description)],
  ]);
  if (hasErrors(errors)) return invalid(errors);
  const issueId = body.id as string;
  const description = text(body.description);

  const db = getDb();
  const row = db.prepare("SELECT feedback_id FROM courier_issues WHERE id = ?").get(issueId) as { feedback_id: string } | undefined;
  if (row) return row.feedback_id === id ? json({ id: issueId }) : err("Datos inválidos", 409);
  const count = (db.prepare("SELECT COUNT(*) c FROM courier_issues WHERE feedback_id = ?").get(id) as { c: number }).c;
  if (count >= 50) return err("Ya no se pueden agregar más problemas a esta encuesta");
  const ts = now();
  db.transaction(() => {
    db.prepare("INSERT INTO courier_issues (id, feedback_id, description, created_at) VALUES (?,?,?,?)").run(issueId, id, description, ts);
    db.prepare("UPDATE courier_feedback SET updated_at = ? WHERE id = ?").run(ts, id);
  })();
  return json({ id: issueId });
}
