import { getDb, now } from "@/lib/db";
import { checkRunToken } from "@/lib/auth";
import { verifyGuidePassword } from "@/lib/guide-auth";
import { err, json, str } from "@/lib/http";

export const dynamic = "force-dynamic";

/** El guía termina la prueba (con su contraseña) porque el bloqueo no se pudo resolver. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const body = await req.json().catch(() => null);
  if (!body) return err("JSON inválido");
  const denied = await verifyGuidePassword(req, body.password);
  if (denied) return denied;

  const db = getDb();
  const reason = str(body.reason, 4000) || "Bloqueo sin resolver";
  const ts = now();
  db.transaction(() => {
    db.prepare(
      `UPDATE runs SET status='ended_blocked', ended_reason=?, ended_at=COALESCE(ended_at, ?), updated_at=? WHERE id=?`
    ).run(reason, ts, ts, id);
    db.prepare(
      "UPDATE help_requests SET status='ended', resolved_at=?, resolution=? WHERE run_id=? AND status='open'"
    ).run(ts, `Prueba terminada por el guía: ${reason}`, id);
  })();
  return json({ ok: true, endedAt: ts });
}
