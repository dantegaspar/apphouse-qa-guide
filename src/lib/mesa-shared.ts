/**
 * Constantes y formatos de la Mesa de control que también usa el navegador.
 * Sin acceso a la base: se puede importar desde componentes de cliente (admin-data.ts no).
 */

/** "hace 5 min" */
export function timeAgo(iso: string, nowMs = Date.now()) {
  const m = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (m < 1) return "hace menos de 1 min";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h ${m % 60} min`;
  return `hace ${Math.floor(h / 24)} día(s)`;
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "";

/** Minutos sin ninguna señal (evento) para considerar abandonada una corrida no terminada. */
export const ABANDON_MIN = 45;
/** Minutos sin guardar una actividad para marcar a un tester como «sin avance». */
export const STALL_MIN = 20;

/**
 * Minutos sin señal tras los cuales una prueba sin terminar de otra ronda ya no se avisa como activa.
 * Corto a propósito: al abrir una encuesta nueva, la página del tester cierra sola la prueba anterior
 * (en segundos), así que lo que sigue mandando datos después de esto es una pestaña rezagada.
 */
export const OTHER_ROUND_ACTIVE_MIN = 20;

export type MesaState = "help" | "stalled" | "abandoned" | "active" | "ended_blocked" | "finished";

export const MESA_STATE: Record<MesaState, { label: string; cls: string; rank: number }> = {
  help: { label: "Pide ayuda", cls: "bg-red-600 text-white", rank: 0 },
  stalled: { label: `Sin avance`, cls: "bg-amber-100 text-amber-900 ring-1 ring-amber-300", rank: 1 },
  abandoned: { label: "Abandonada", cls: "bg-slate-200 text-slate-700", rank: 3 },
  active: { label: "Avanzando", cls: "bg-sky-100 text-sky-800", rank: 4 },
  ended_blocked: { label: "Terminada por bloqueo", cls: "bg-red-100 text-red-800", rank: 5 },
  finished: { label: "Terminada", cls: "bg-emerald-100 text-emerald-800", rank: 6 },
};

// ---------------------------------------------------------------------------------------------
// Ritmo de consulta de la Mesa en vivo (MesaLive)

/** Intervalo normal de la Mesa. */
export const MESA_BASE_S = 5;
/** Sin cambios en los datos durante N consultas seguidas → consulta más espaciado (vuelve a 5 s al primer cambio). */
export const CALM_STEPS = [
  { after: 18, s: 15 }, // 18 consultas iguales (≈1.5 min) → cada 15 s
  { after: 6, s: 10 }, // 6 consultas iguales (30 s) → cada 10 s
];
/** Consultas fallidas seguidas → espera creciente: 5, 10, 20 y luego 30 s. */
export const ERROR_S = [5, 10, 20, 30];

/** Consultas seguidas sin cambios (calm) y fallidas seguidas (fails). */
export type MesaPollState = { calm: number; fails: number };

/** Segundos hasta la próxima consulta: espera creciente si falla; más espaciado si nada cambia. */
export function nextIntervalS(l: MesaPollState) {
  if (l.fails) return ERROR_S[Math.min(l.fails, ERROR_S.length) - 1];
  return CALM_STEPS.find((c) => l.calm >= c.after)?.s ?? MESA_BASE_S;
}
