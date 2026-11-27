import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { getGuide } from "@/lib/guides";
import { activeRoundId } from "@/lib/rounds";

/**
 * Datos de prueba para el veredicto. Una prueba «completa» marca todas las actividades de su guía como
 * «Todo salió bien», termina (status finished) y envía la encuesta final con logística sin problema.
 */

export function resetDb() {
  const db = getDb();
  for (const t of ["claude_comparativa", "courier_issues", "courier_attachments", "courier_feedback", "claude_dictamen", "help_requests", "attachments", "issues", "survey_responses", "activity_results", "step_results", "runs"])
    db.prepare(`DELETE FROM ${t}`).run();
  return activeRoundId();
}

const iso = (minAgo = 0) => new Date(Date.now() - minAgo * 60_000).toISOString();

type RunOpts = {
  guideId?: string;
  name?: string;
  status?: "finished" | "in_progress" | "ended_blocked";
  /** Motivo elegido al terminar por bloqueo (END_CAUSES). */
  endedCause?: string;
  scope?: "" | "incluir" | "excluir";
  /** Respuesta a «logistica» (por omisión, la primera opción: sin problema). */
  logistica?: string;
  umux?: [number, number];
  /** Otras respuestas de la encuesta final (rapidez, satisfaccion, adopcion…). */
  answers?: Record<string, unknown>;
  /** Actividades a marcar «Todo salió bien» (por omisión, todas las de la guía). */
  okActivities?: string[];
};

export function addRun(o: RunOpts = {}) {
  const db = getDb();
  const guideId = o.guideId ?? "cliente";
  const guide = getGuide(guideId)!;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO runs (id, token_hash, guide_id, guide_version, name, email, role, status, created_at, updated_at, finished_at, verdict_scope, round_id)
     VALUES (?, 'x', ?, ?, ?, 't@example.com', 'tester', ?, ?, ?, ?, ?, ?)`,
  ).run(id, guideId, guide.version, o.name ?? `Tester ${id.slice(0, 4)}`, o.status ?? "finished", iso(60), iso(1), o.status === "in_progress" ? null : iso(1), o.scope ?? "", activeRoundId());
  if (o.endedCause) db.prepare("UPDATE runs SET ended_cause = ? WHERE id = ?").run(o.endedCause, id);
  for (const a of o.okActivities ?? guide.activities.map((x) => x.id)) setActivity(id, a, "ok");
  const logQ = guide.survey.questions.find((q) => q.id === "logistica");
  const [u1, u2] = o.umux ?? [7, 7];
  db.prepare("INSERT INTO survey_responses (run_id, answers, created_at, updated_at, is_draft) VALUES (?, ?, ?, ?, 0)").run(
    id,
    JSON.stringify({ umux1: u1, umux2: u2, logistica: o.logistica ?? logQ?.options?.[0] ?? "", ...o.answers }),
    iso(),
    iso(),
  );
  return id;
}

export function setActivity(runId: string, activityId: string, result: "ok" | "fail" | "blocked" | "skipped", fields: Record<string, unknown> = {}) {
  getDb()
    .prepare(
      `INSERT INTO activity_results (run_id, activity_id, result, fields, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (run_id, activity_id) DO UPDATE SET result = excluded.result, fields = excluded.fields`,
    )
    .run(runId, activityId, result, JSON.stringify(fields), iso());
}

export function addIssue(runId: string, activityId: string, o: { severity?: "critico" | "alto" | "medio" | "bajo"; triage?: string; blocking?: boolean } = {}) {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO issues (id, run_id, activity_id, kind, description, blocking, severity, triage, created_at)
       VALUES (?, ?, ?, 'issue', 'Falla de prueba', ?, ?, ?, ?)`,
    )
    .run(id, runId, activityId, o.blocking ? 1 : 0, o.severity ?? "medio", o.triage ?? "pendiente", iso());
  return id;
}

/** Conteo de pedidos del establecimiento (E07): entregados y no entregados por falla. */
export const setOrders = (runId: string, delivered: number, failed: number) =>
  setActivity(runId, "E07", "ok", { ordersDelivered: String(delivered), ordersFailed: String(failed) });

/** Escenario base que cumple todos los criterios: 1 cliente y 1 establecimiento completos, 10/10 pedidos. */
export function readyScenario() {
  const round = resetDb();
  const cliente = addRun({ guideId: "cliente", name: "Cliente OK" });
  const est = addRun({ guideId: "establecimiento", name: "Establecimiento OK" });
  setOrders(est, 10, 0);
  return { round, cliente, est };
}
