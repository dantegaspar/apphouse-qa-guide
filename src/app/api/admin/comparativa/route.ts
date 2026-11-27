import { isAdmin } from "@/lib/auth";
import { err, json } from "@/lib/http";
import { runComparativa } from "@/lib/comparativa";
import { parseRoundId } from "@/lib/rounds";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

let running = false;

/**
 * Mesa de control pide la comparativa entre dos encuestas con Claude (empareja bugs parecidos y redacta;
 * los números los calcula el sistema). Cuerpo { base, current }: ids de las dos rondas, distintas.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  if (running) return err("Ya hay una comparativa en curso; espera a que termine.", 409);
  running = true;
  try {
    const body = (await req.json().catch(() => null)) as { base?: unknown; current?: unknown } | null;
    const base = parseRoundId(body?.base);
    const current = parseRoundId(body?.current);
    if (base === null || current === null) return err("Elige las dos encuestas que quieres comparar.", 400);
    if (base === current) return err("Elige dos encuestas distintas.", 400);
    const row = await runComparativa(base, current);
    return json({ ok: true, id: row.id, error: row.error });
  } catch (e) {
    return err(e instanceof Error ? e.message : "No se pudo hacer la comparativa", 500);
  } finally {
    running = false;
  }
}
