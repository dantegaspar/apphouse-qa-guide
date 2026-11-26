import { AsyncLocalStorage } from "node:async_hooks";
import { getDb, now } from "./db";

/**
 * Rondas de encuestas. Cada prueba (runs), encuesta de repartidor (courier_feedback) y dictamen
 * con Claude (claude_dictamen) guarda su round_id. Las tablas hijas (pasos, actividades, fallas,
 * fotos, ayudas, encuestas) cuelgan de la prueba, así que heredan su ronda.
 *
 * - Ronda activa: la más reciente. Ahí entran las pruebas y encuestas nuevas.
 * - Ronda a la vista: la que eligió el admin en el panel (se guarda en el servidor, en
 *   app_settings.view_round). Todo el panel, el veredicto y las descargas usan esta.
 */
export type Round = { id: number; name: string; created_at: string };

const ORDINALS = ["Primera", "Segunda", "Tercera", "Cuarta", "Quinta", "Sexta", "Séptima", "Octava", "Novena", "Décima"];
export const defaultRoundName = (n: number) => (n >= 1 && n <= ORDINALS.length ? `${ORDINALS[n - 1]} encuesta` : `Encuesta ${n}`);

export const ROUND_NAME_MAX = 60;

/** Lista de rondas (la más antigua primero). Si no hay ninguna (p. ej. tras `npm run limpiar`), crea la primera. */
export function listRounds(): Round[] {
  const db = getDb();
  let rows = db.prepare("SELECT id, name, created_at FROM rounds ORDER BY id").all() as Round[];
  if (!rows.length) {
    db.prepare("INSERT INTO rounds (id, name, created_at) VALUES (1, ?, ?)").run(defaultRoundName(1), now());
    rows = db.prepare("SELECT id, name, created_at FROM rounds ORDER BY id").all() as Round[];
  }
  return rows;
}

/** Ronda donde entran las pruebas y encuestas nuevas (la más reciente). */
export function activeRoundId(): number {
  const rows = listRounds();
  return rows[rows.length - 1].id;
}

/**
 * Ronda fijada para una petición (p. ej. una descarga pide la ronda que el admin tiene en pantalla).
 * Mientras corre `withRound`, `viewRoundId()` devuelve esa ronda en lugar de la vista compartida.
 */
const roundOverride = new AsyncLocalStorage<number>();

/** Ejecuta `fn` como si la ronda a la vista fuera `id` (sin cambiar app_settings.view_round). */
export function withRound<T>(id: number | null | undefined, fn: () => T): T {
  return id ? roundOverride.run(id, fn) : fn();
}

/**
 * Lee la ronda que manda el cliente (?round= o body.round): la que el admin tiene en pantalla.
 * Devuelve null si no viene o no existe; quien llama usa entonces viewRoundId().
 */
export function parseRoundId(v: unknown): number | null {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1) return null;
  return listRounds().some((r) => r.id === id) ? id : null;
}

/**
 * Ronda de una prueba y la ronda activa. Va en las respuestas a la página del tester para que una
 * pestaña abierta note que el admin abrió una encuesta nueva (y deje de mandar a la anterior).
 */
export function runRounds(runId: string): { roundId?: number; activeRoundId: number } {
  const row = getDb().prepare("SELECT round_id FROM runs WHERE id = ?").get(runId) as { round_id: number } | undefined;
  return { roundId: row?.round_id, activeRoundId: activeRoundId() };
}

/** Ronda que el panel está mostrando. */
export function viewRoundId(): number {
  const rows = listRounds();
  const fixed = roundOverride.getStore();
  if (fixed && rows.some((r) => r.id === fixed)) return fixed;
  const v = getDb().prepare("SELECT value FROM app_settings WHERE key = 'view_round'").get() as { value: string } | undefined;
  const id = Number(v?.value);
  return rows.some((r) => r.id === id) ? id : rows[rows.length - 1].id;
}

export function viewRound(): Round {
  const id = viewRoundId();
  return listRounds().find((r) => r.id === id)!;
}

export function setViewRound(id: number): boolean {
  if (!listRounds().some((r) => r.id === id)) return false;
  getDb()
    .prepare("INSERT INTO app_settings (key, value) VALUES ('view_round', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(id));
  return true;
}

/** Abre una ronda nueva (queda activa y a la vista). No borra nada: lo anterior queda en su ronda. */
export function createRound(name?: string): Round {
  const db = getDb();
  const next = activeRoundId() + 1;
  const round: Round = { id: next, name: (name ?? "").trim().slice(0, ROUND_NAME_MAX) || defaultRoundName(next), created_at: now() };
  db.transaction(() => {
    db.prepare("INSERT INTO rounds (id, name, created_at) VALUES (?, ?, ?)").run(round.id, round.name, round.created_at);
    setViewRound(round.id);
  })();
  return round;
}

export function renameRound(id: number, name: string): boolean {
  const n = name.trim().slice(0, ROUND_NAME_MAX);
  if (!n) return false;
  return getDb().prepare("UPDATE rounds SET name = ? WHERE id = ?").run(n, id).changes > 0;
}

/** Condición SQL: la prueba (runs) es de la ronda a la vista. `col` es la columna round_id. */
export const roundCond = (col = "round_id", round = viewRoundId()) => `${col} = ${Math.trunc(round)}`;

/** Condición SQL para tablas hijas de runs: su run_id pertenece a la ronda a la vista. */
export const runInRound = (col = "run_id", round = viewRoundId()) => `${col} IN (SELECT id FROM runs WHERE round_id = ${Math.trunc(round)})`;

/** Cuántas pruebas y encuestas de repartidor tiene cada ronda. */
export function roundCounts(): Map<number, { runs: number; couriers: number; open: number }> {
  const db = getDb();
  const m = new Map<number, { runs: number; couriers: number; open: number }>();
  for (const r of listRounds()) m.set(r.id, { runs: 0, couriers: 0, open: 0 });
  for (const r of db.prepare("SELECT round_id, COUNT(*) n, SUM(status = 'in_progress') open FROM runs GROUP BY round_id").all() as { round_id: number; n: number; open: number }[]) {
    const e = m.get(r.round_id);
    if (e) [e.runs, e.open] = [r.n, r.open ?? 0];
  }
  for (const r of db.prepare("SELECT round_id, COUNT(*) n FROM courier_feedback GROUP BY round_id").all() as { round_id: number; n: number }[]) {
    const e = m.get(r.round_id);
    if (e) e.couriers = r.n;
  }
  return m;
}

/** Parte del nombre de archivo de las descargas: «primera-encuesta». */
export function roundSlug(r: Round = viewRound()): string {
  return (
    r.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `encuesta-${r.id}`
  );
}
