import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { err, json, readJsonObject, str } from "@/lib/http";

export const dynamic = "force-dynamic";

const SCOPES = new Set(["", "excluir", "incluir"]);

/**
 * Mesa de control decide si una prueba cuenta para el veredicto.
 * Cuerpo: { scope: "" (automático) | "excluir" | "incluir", note?: string }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  const { id } = await params;
  const { body, res } = await readJsonObject(req, 8 * 1024);
  if (res) return res;
  if (typeof body.scope !== "string" || !SCOPES.has(body.scope)) return err("Opción inválida");
  const db = getDb();
  const r = db
    .prepare("UPDATE runs SET verdict_scope = ?, verdict_scope_note = ? WHERE id = ?")
    .run(body.scope, str(body.note, 500), id);
  if (!r.changes) return err("Prueba no encontrada", 404);
  return json({ ok: true });
}
