import { getDb, now } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { err, json, readJsonObject, str } from "@/lib/http";
import { BUG_TYPES, SEVERITIES, TRIAGE } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Revisión de una falla por Mesa de control: cambia la gravedad y/o el estado de revisión.
 * Cuerpo: { severity?: critico|alto|medio|bajo, triage?: pendiente|confirmada|no_es_falla|externa|tester|duplicada|corregida,
 *   bugType?: diseno|funcional|datos|rendimiento|compatibilidad|contenido|"", note?: string }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  const { id } = await params;
  const { body, res } = await readJsonObject(req, 16 * 1024);
  if (res) return res;
  const db = getDb();
  const row = db.prepare("SELECT id FROM issues WHERE id = ? AND kind = 'issue'").get(id);
  if (!row) return err("Reporte no encontrado", 404);
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (body.severity !== undefined) {
    if (typeof body.severity !== "string" || !(body.severity in SEVERITIES)) return err("Gravedad inválida");
    // «blocking» (la actividad quedó en pausa) es lo que vivió el tester; la severidad la decide Mesa de control.
    sets.push("severity = ?");
    vals.push(body.severity);
  }
  if (body.triage !== undefined) {
    if (typeof body.triage !== "string" || !(body.triage in TRIAGE)) return err("Estado inválido");
    sets.push("triage = ?");
    vals.push(body.triage);
  }
  if (body.bugType !== undefined) {
    if (typeof body.bugType !== "string" || (body.bugType !== "" && !(body.bugType in BUG_TYPES))) return err("Tipo de bug inválido");
    sets.push("bug_type = ?");
    vals.push(body.bugType);
  }
  if (body.note !== undefined) {
    sets.push("triage_note = ?");
    vals.push(str(body.note, 1000));
  }
  if (!sets.length) return err("Nada que cambiar");
  sets.push("triage_at = ?");
  vals.push(now());
  db.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return json({ ok: true });
}
