import { getDb, now } from "@/lib/db";
import { checkRunToken } from "@/lib/auth";
import { runRounds } from "@/lib/rounds";
import { endCause } from "@/lib/end-causes";
import { err, hasErrors, invalid, json, readJsonObject } from "@/lib/http";
import { collect, text, textError } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * El tester termina la prueba porque ya no puede seguir (sin contraseña del guía). Elige un motivo
 * (END_CAUSES) y después todavía contesta la encuesta final.
 * Reglas: cause obligatorio (id de END_CAUSES); reason opcional ≤4000 (obligatorio si cause = «otro»).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const { body, res } = await readJsonObject(req, 32 * 1024);
  if (res) return res;
  const cause = endCause(typeof body.cause === "string" ? body.cause : "");
  const errors = collect([
    ["cause", cause ? null : "Elige por qué ya no puedes seguir."],
    ["reason", textError(body.reason, { max: 4000, min: cause?.id === "otro" ? 5 : 0, label: "el motivo" })],
  ]);
  if (hasErrors(errors)) return invalid(errors);

  const db = getDb();
  const detail = text(body.reason);
  const reason = detail ? `${cause!.label}. ${detail}` : cause!.label;
  const ts = now();
  const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(id) as { status: string } | undefined;
  if (!run) return err("Prueba no encontrada", 404);
  if (run.status === "finished") return err("La prueba ya terminó", 409);
  db.transaction(() => {
    db.prepare(
      `UPDATE runs SET status='ended_blocked', ended_reason=?, ended_cause=?, ended_at=COALESCE(ended_at, ?), updated_at=? WHERE id=?`
    ).run(reason, cause!.id, ts, ts, id);
    db.prepare(
      "UPDATE help_requests SET status='ended', resolved_at=?, resolution=? WHERE run_id=? AND status='open'"
    ).run(ts, `El tester terminó la prueba: ${reason}`, id);
  })();
  return json({ ok: true, endedAt: ts, reason, ...runRounds(id) });
}
