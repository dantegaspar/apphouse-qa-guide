import { isAdmin } from "@/lib/auth";
import { err, json } from "@/lib/http";
import { runDictamen } from "@/lib/claude-dictamen";
import { parseRoundId, viewRoundId, withRound } from "@/lib/rounds";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

let running = false;

/**
 * Mesa de control pide el dictamen con Claude (clasifica errores y dictamina sobre los criterios fijos).
 * Cuerpo opcional { round }: la ronda que el admin tiene en pantalla (también ?round=). Si no viene o no
 * existe, se usa la ronda a la vista (viewRoundId).
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  if (running) return err("Ya hay un dictamen en curso; espera a que termine.", 409);
  running = true;
  try {
    const url = new URL(req.url);
    const reclasificar = url.searchParams.get("reclasificar") === "1";
    const body = (await req.json().catch(() => null)) as { round?: unknown } | null;
    const round = parseRoundId(body?.round ?? url.searchParams.get("round")) ?? viewRoundId();
    // withRound: cualquier cálculo interno que lea la ronda a la vista usa también esta
    const row = await withRound(round, () => runDictamen({ reclasificar, round }));
    return json({ ok: true, id: row.id, error: row.error });
  } catch (e) {
    return err(e instanceof Error ? e.message : "No se pudo hacer el dictamen", 500);
  } finally {
    running = false;
  }
}
