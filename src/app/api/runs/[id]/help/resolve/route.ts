import { getDb, now } from "@/lib/db";
import { checkRunToken } from "@/lib/auth";
import { runRounds } from "@/lib/rounds";
import { err, hasErrors, invalid, json, readJsonObject } from "@/lib/http";
import { collect, idError, text, textError } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * El bloqueo se resolvió y el tester continúa (ya no se pide la contraseña del guía).
 * Reglas: helpId (uuid del servidor) obligatorio; resolution ≤2000.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const { body, res } = await readJsonObject(req, 32 * 1024);
  if (res) return res;
  const errors = collect([
    ["helpId", idError(body.helpId, { kind: "uuid", label: "la solicitud de ayuda" })],
    ["resolution", textError(body.resolution, { max: 2000, label: "la resolución" })],
  ]);
  if (hasErrors(errors)) return invalid(errors);

  const db = getDb();
  const helpId = body.helpId as string;
  const help = db.prepare("SELECT status FROM help_requests WHERE id = ? AND run_id = ?").get(helpId, id) as { status: string } | undefined;
  if (!help) return err("Solicitud de ayuda no encontrada", 404);
  if (help.status === "ended") return err("La prueba ya terminó", 409);
  const ts = now();
  if (help.status === "open") {
    db.prepare("UPDATE help_requests SET status='resolved', resolved_at=?, resolution=? WHERE id=?").run(
      ts,
      text(body.resolution) || "Resuelto; el tester continuó",
      helpId
    );
    db.prepare("UPDATE runs SET updated_at=? WHERE id=?").run(ts, id);
  }
  return json({ ok: true, ...runRounds(id) });
}
