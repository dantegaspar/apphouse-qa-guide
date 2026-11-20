import { getDb, now } from "@/lib/db";
import { checkCourierToken } from "@/lib/courier-data";
import { COURIER_ID_RE } from "@/lib/courier";
import { err, json, str } from "@/lib/http";

/** Agrega un problema a una encuesta ya enviada (solo quien la envió, con su token). Idempotente por id. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkCourierToken(id, req.headers.get("x-courier-token"))) return err("No autorizado", 401);
  const body = await req.json().catch(() => null);
  const issueId = str(body?.id, 64);
  const description = str(body?.description, 2000);
  if (!COURIER_ID_RE.test(issueId)) return err("Datos inválidos");
  if (!description) return err("Escribe qué pasó");

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
