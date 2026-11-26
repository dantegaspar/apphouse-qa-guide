import { getDb, now } from "@/lib/db";
import { checkRunToken } from "@/lib/auth";
import { runRounds } from "@/lib/rounds";
import { verifyGuidePassword } from "@/lib/guide-auth";
import { err, hasErrors, invalid, json, readJsonObject } from "@/lib/http";
import { collect, text, textError } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * El guía termina la prueba (con su contraseña) porque el bloqueo no se pudo resolver.
 * Reglas: password obligatoria (1–200); reason opcional ≤4000.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const { body, res } = await readJsonObject(req, 32 * 1024);
  if (res) return res;
  const errors = collect([
    ["password", textError(body.password, { min: 1, max: 200, label: "la contraseña del guía" })],
    ["reason", textError(body.reason, { max: 4000, label: "el motivo" })],
  ]);
  if (hasErrors(errors)) return invalid(errors);
  const denied = await verifyGuidePassword(req, body.password);
  if (denied) return denied;

  const db = getDb();
  const reason = text(body.reason) || "Bloqueo sin resolver";
  const ts = now();
  db.transaction(() => {
    db.prepare(
      `UPDATE runs SET status='ended_blocked', ended_reason=?, ended_at=COALESCE(ended_at, ?), updated_at=? WHERE id=?`
    ).run(reason, ts, ts, id);
    db.prepare(
      "UPDATE help_requests SET status='ended', resolved_at=?, resolution=? WHERE run_id=? AND status='open'"
    ).run(ts, `Prueba terminada por el guía: ${reason}`, id);
  })();
  return json({ ok: true, endedAt: ts, ...runRounds(id) });
}
