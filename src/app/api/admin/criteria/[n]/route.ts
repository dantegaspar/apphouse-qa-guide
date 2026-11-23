import { getDb, now } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { err, json, readJsonObject, str } from "@/lib/http";
import { PLAN_CRITERIA } from "@/lib/verdict";

export const dynamic = "force-dynamic";

/**
 * Captura de un criterio de finalización del Plan (sección 7.5) por Mesa de control.
 * Cuerpo: { measured?: string, met?: true | false | null, note?: string }. met = null deja el criterio
 * pendiente (en el 1, vuelve al cálculo automático con la Hoja de pedidos).
 */
export async function POST(req: Request, { params }: { params: Promise<{ n: string }> }) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  const n = Number((await params).n);
  if (!PLAN_CRITERIA.some((c) => c.n === n)) return err("Criterio no encontrado", 404);
  const { body, res } = await readJsonObject(req, 8 * 1024);
  if (res) return res;
  if (body.met !== undefined && body.met !== null && typeof body.met !== "boolean") return err("«Cumple» inválido");
  const db = getDb();
  const cur = db.prepare("SELECT measured, met, note FROM exit_criteria WHERE id = ?").get(n) as
    | { measured: string; met: number | null; note: string }
    | undefined;
  const measured = body.measured !== undefined ? str(body.measured, 500) : (cur?.measured ?? "");
  const met = body.met !== undefined ? (body.met === null ? null : body.met ? 1 : 0) : (cur?.met ?? null);
  const note = body.note !== undefined ? str(body.note, 1000) : (cur?.note ?? "");
  db.prepare(
    `INSERT INTO exit_criteria (id, measured, met, note, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET measured=excluded.measured, met=excluded.met, note=excluded.note, updated_at=excluded.updated_at`
  ).run(n, measured, met, note, now());
  return json({ ok: true });
}
