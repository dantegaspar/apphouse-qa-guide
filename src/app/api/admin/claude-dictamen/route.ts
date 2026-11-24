import { isAdmin } from "@/lib/auth";
import { err, json } from "@/lib/http";
import { runDictamen } from "@/lib/claude-dictamen";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

let running = false;

/** Mesa de control pide el dictamen con Claude (clasifica errores y dictamina sobre los criterios fijos). */
export async function POST() {
  if (!(await isAdmin())) return err("No autorizado", 401);
  if (running) return err("Ya hay un dictamen en curso; espera a que termine.", 409);
  running = true;
  try {
    const row = await runDictamen();
    return json({ ok: true, id: row.id, error: row.error });
  } catch (e) {
    return err(e instanceof Error ? e.message : "No se pudo hacer el dictamen", 500);
  } finally {
    running = false;
  }
}
