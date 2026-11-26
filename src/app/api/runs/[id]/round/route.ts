import { getDb } from "@/lib/db";
import { checkRunToken } from "@/lib/auth";
import { activeRoundId } from "@/lib/rounds";
import { err, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Ronda (encuesta) a la que pertenece la prueba y la ronda activa. El navegador lo pregunta al
 * abrir una prueba guardada sin `roundId` (de antes de las rondas) y, con la página abierta, cada
 * 15 s y al volver a la pestaña: si el admin abrió una encuesta nueva, cierra la prueba anterior.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const row = getDb().prepare("SELECT round_id FROM runs WHERE id = ?").get(id) as { round_id: number } | undefined;
  if (!row) return err("No encontrada", 404);
  return json({ roundId: row.round_id, activeRoundId: activeRoundId() });
}
