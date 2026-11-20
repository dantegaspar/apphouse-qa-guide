import { getDb, now } from "@/lib/db";
import { checkRunToken } from "@/lib/auth";
import { verifyGuidePassword } from "@/lib/guide-auth";
import { err, json, str } from "@/lib/http";

export const dynamic = "force-dynamic";

/** El guía confirma (con su contraseña) que el bloqueo se resolvió; el tester puede continuar. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const body = await req.json().catch(() => null);
  if (!body) return err("JSON inválido");
  const denied = await verifyGuidePassword(req, body.password);
  if (denied) return denied;

  const db = getDb();
  const helpId = str(body.helpId, 64);
  const help = db.prepare("SELECT status FROM help_requests WHERE id = ? AND run_id = ?").get(helpId, id) as { status: string } | undefined;
  if (!help) return err("Solicitud de ayuda no encontrada", 404);
  if (help.status === "ended") return err("La prueba ya terminó", 409);
  const ts = now();
  if (help.status === "open") {
    db.prepare("UPDATE help_requests SET status='resolved', resolved_at=?, resolution=? WHERE id=?").run(
      ts,
      str(body.resolution, 2000) || "Resuelto con el guía; el tester continuó",
      helpId
    );
    db.prepare("UPDATE runs SET updated_at=? WHERE id=?").run(ts, id);
  }
  return json({ ok: true });
}
