import crypto from "node:crypto";
import { getDb, now } from "@/lib/db";
import { getGuide } from "@/lib/guides";
import { checkRunToken } from "@/lib/auth";
import { err, json, str } from "@/lib/http";

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
  return json({ status: run.status, endedReason: run.ended_reason, endedAt: run.ended_at, open: open ? helpOut(open) : null });
}

/** El tester pide ayuda al guía porque una falla le impide seguir. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const body = await req.json().catch(() => null);
  if (!body) return err("JSON inválido");
  const db = getDb();
  const run = db.prepare("SELECT guide_id, status FROM runs WHERE id = ?").get(id) as RunRow;
  if (run.status === "ended_blocked") return err("La prueba ya terminó", 409);
  const guide = getGuide(run.guide_id);
  const activityId = str(body.activityId, 32);
  if (!guide?.activities.some((a) => a.id === activityId)) return err("Actividad no encontrada", 404);
  const reason = str(body.reason, 4000);
  if (reason.length < 3) return err("Escribe por qué no puedes seguir con la prueba");
  const stepId = str(body.stepId, 32) || null;
  const issueId = str(body.issueId, 64) || null;
  const ts = now();

  // Una sola solicitud abierta por corrida: si ya existe, se actualiza (reintentos no duplican)
  const open = db.prepare("SELECT * FROM help_requests WHERE run_id = ? AND status = 'open'").get(id) as HelpRow | undefined;
  if (open) {
    db.prepare("UPDATE help_requests SET activity_id=?, step_id=?, issue_id=?, reason=? WHERE id=?").run(activityId, stepId, issueId, reason, open.id);
    return json({ id: open.id, createdAt: open.created_at });
  }
  const helpId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO help_requests (id, run_id, activity_id, step_id, issue_id, reason, status, created_at)
     VALUES (?,?,?,?,?,?, 'open', ?)`
  ).run(helpId, id, activityId, stepId, issueId, reason, ts);
  db.prepare("UPDATE runs SET updated_at=? WHERE id=?").run(ts, id);
  return json({ id: helpId, createdAt: ts });
}
