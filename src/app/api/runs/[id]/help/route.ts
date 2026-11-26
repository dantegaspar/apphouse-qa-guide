import crypto from "node:crypto";
import { getDb, now } from "@/lib/db";
import { getGuide } from "@/lib/guides";
import { checkRunToken } from "@/lib/auth";
import { runRounds } from "@/lib/rounds";
import { err, hasErrors, invalid, json, readJsonObject } from "@/lib/http";
import { collect, idError, text, textError } from "@/lib/validate";

export const dynamic = "force-dynamic";

type HelpRow = { id: string; activity_id: string; step_id: string | null; issue_id: string | null; reason: string; created_at: string };
type RunRow = { guide_id: string; status: string; ended_reason: string; ended_at: string | null };

const helpOut = (h: HelpRow) => ({
  id: h.id,
  activityId: h.activity_id,
  stepId: h.step_id ?? undefined,
  issueId: h.issue_id ?? undefined,
  reason: h.reason,
  createdAt: h.created_at,
});

/** Estado de bloqueo de la corrida: solicitud de ayuda abierta y si la prueba terminó por bloqueo. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const db = getDb();
  const run = db.prepare("SELECT guide_id, status, ended_reason, ended_at FROM runs WHERE id = ?").get(id) as RunRow;
  const open = db
    .prepare("SELECT * FROM help_requests WHERE run_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1")
    .get(id) as HelpRow | undefined;
  return json({ status: run.status, endedReason: run.ended_reason, endedAt: run.ended_at, open: open ? helpOut(open) : null, ...runRounds(id) });
}

/**
 * El tester pide ayuda al guía porque una falla le impide seguir.
 * Reglas: activityId de la guía; stepId opcional de esa actividad; issueId opcional (id del
 * navegador); reason obligatorio 3–4000.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const { body, res } = await readJsonObject(req, 32 * 1024);
  if (res) return res;
  const db = getDb();
  const run = db.prepare("SELECT guide_id, status FROM runs WHERE id = ?").get(id) as RunRow;
  if (run.status === "ended_blocked") return err("La prueba ya terminó", 409);
  // Prueba de una encuesta anterior: no se abre una solicitud que nadie podrá cerrar. La respuesta
  // trae la ronda y el navegador cierra la prueba y muestra el registro de la encuesta nueva.
  const rounds = runRounds(id);
  if (rounds.roundId !== undefined && rounds.roundId !== rounds.activeRoundId)
    return json({ error: "Se abrió una nueva encuesta. Regístrate de nuevo para seguir.", code: "round_closed", ...rounds }, 409);
  const guide = getGuide(run.guide_id);
  const act = guide?.activities.find((a) => a.id === body.activityId);
  if (!act) return invalid({ activityId: "La actividad no existe en esta guía." }, 400, "Actividad no encontrada");
  const errors = collect([
    ["reason", textError(body.reason, { min: 3, max: 4000, required: true, label: "por qué no puedes seguir con la prueba" })],
    ["stepId", idError(body.stepId, { known: act.steps.map((s) => s.id), required: false, label: "el paso" })],
    ["issueId", idError(body.issueId, { required: false, label: "el reporte" })],
  ]);
  if (hasErrors(errors)) return invalid(errors);
  const activityId = act.id;
  const reason = text(body.reason);
  const stepId = text(body.stepId) || null;
  const issueId = text(body.issueId) || null;
  const ts = now();

  // Una sola solicitud abierta por corrida: si ya existe, se actualiza (reintentos no duplican)
  const open = db.prepare("SELECT * FROM help_requests WHERE run_id = ? AND status = 'open'").get(id) as HelpRow | undefined;
  if (open) {
    db.prepare("UPDATE help_requests SET activity_id=?, step_id=?, issue_id=?, reason=? WHERE id=?").run(activityId, stepId, issueId, reason, open.id);
    return json({ id: open.id, createdAt: open.created_at, ...runRounds(id) });
  }
  const helpId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO help_requests (id, run_id, activity_id, step_id, issue_id, reason, status, created_at)
     VALUES (?,?,?,?,?,?, 'open', ?)`
  ).run(helpId, id, activityId, stepId, issueId, reason, ts);
  db.prepare("UPDATE runs SET updated_at=? WHERE id=?").run(ts, id);
  return json({ id: helpId, createdAt: ts, ...runRounds(id) });
}
