import { isAdmin } from "@/lib/auth";
import { err, json, readJsonObject, str } from "@/lib/http";
import { createRound, listRounds, renameRound, ROUND_NAME_MAX, setViewRound, viewRoundId } from "@/lib/rounds";

export const dynamic = "force-dynamic";

/** Rondas de encuestas y cuál está a la vista. */
export async function GET() {
  if (!(await isAdmin())) return err("No autorizado", 401);
  return json({ rounds: listRounds(), view: viewRoundId() });
}

/**
 * Cuerpo:
 * - { action: "view", id } → el panel muestra esa ronda.
 * - { action: "new", name? } → abre una ronda nueva (queda activa y a la vista). No borra nada.
 * - { action: "rename", id, name } → cambia el nombre de una ronda.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  const { body, res } = await readJsonObject(req, 4 * 1024);
  if (res) return res;
  const id = Number(body.id);
  switch (body.action) {
    case "view":
      if (!Number.isInteger(id) || !setViewRound(id)) return err("Encuesta no encontrada", 404);
      return json({ ok: true, view: id });
    case "new": {
      const round = createRound(str(body.name, ROUND_NAME_MAX));
      return json({ ok: true, round });
    }
    case "rename": {
      const name = str(body.name, ROUND_NAME_MAX);
      if (!name) return err("Escribe un nombre");
      if (!Number.isInteger(id) || !renameRound(id, name)) return err("Encuesta no encontrada", 404);
      return json({ ok: true });
    }
    default:
      return err("Acción inválida");
  }
}
