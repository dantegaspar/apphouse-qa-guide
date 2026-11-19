import { getDb, now } from "@/lib/db";
import { getGuide } from "@/lib/guides";
import { checkRunToken } from "@/lib/auth";
import { cleanRecord, err, json, str } from "@/lib/http";
import { ACTIVITY_RESULTS } from "@/lib/types";

type Event = { type: string; payload: Record<string, unknown> };

/**
 * Recibe los cambios del tester (cola del navegador). Todas las operaciones son idempotentes
 * (upserts), así que reenviar un evento no duplica datos.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const body = await req.json().catch(() => null);
  const events: Event[] = Array.isArray(body?.events) ? body.events.slice(0, 200) : [];
  const db = getDb();
  const run = db.prepare("SELECT guide_id FROM runs WHERE id = ?").get(id) as { guide_id: string };
  const guide = getGuide(run.guide_id);
  if (!guide) return err("Guía no encontrada", 404);
  const activityIds = new Set(guide.activities.map((a) => a.id));
  const ts = now();

  const apply = db.transaction(() => {
    for (const ev of events) {
      const p = ev?.payload ?? {};
      switch (ev?.type) {
        case "step": {
          const activityId = str(p.activityId, 32);
          const outcome = p.outcome;
          if (!activityIds.has(activityId)) break;
          if (outcome === null) {
            db.prepare("DELETE FROM step_results WHERE run_id=? AND activity_id=? AND step_id=?").run(id, activityId, str(p.stepId, 32));
          } else if (outcome === "ok" || outcome === "fail") {
            db.prepare(
              `INSERT INTO step_results (run_id, activity_id, step_id, outcome, updated_at) VALUES (?,?,?,?,?)
               ON CONFLICT(run_id, activity_id, step_id) DO UPDATE SET outcome=excluded.outcome, updated_at=excluded.updated_at`
            ).run(id, activityId, str(p.stepId, 32), outcome, ts);
          }
          break;
        }
        case "activity": {
          const activityId = str(p.activityId, 32);
          if (!activityIds.has(activityId)) break;
          const result = typeof p.result === "string" && p.result in ACTIVITY_RESULTS ? p.result : null;
          db.prepare(
            `INSERT INTO activity_results (run_id, activity_id, result, checks, fields, notes, updated_at) VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(run_id, activity_id) DO UPDATE SET result=excluded.result, checks=excluded.checks,
               fields=excluded.fields, notes=excluded.notes, updated_at=excluded.updated_at`
          ).run(id, activityId, result, JSON.stringify(cleanRecord(p.checks)), JSON.stringify(cleanRecord(p.fields)), str(p.notes, 4000), ts);
          break;
        }
        case "issue": {
          const issueId = str(p.id, 64);
          const activityId = str(p.activityId, 32);
          if (!issueId || !activityIds.has(activityId)) break;
          db.prepare(
            `INSERT INTO issues (id, run_id, activity_id, step_id, kind, description, expected, blocking, order_number, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET description=excluded.description, expected=excluded.expected,
               blocking=excluded.blocking, order_number=excluded.order_number
             WHERE issues.run_id = excluded.run_id`
          ).run(
            issueId, id, activityId, str(p.stepId, 32) || null, p.kind === "evidence" ? "evidence" : "issue",
            str(p.description, 4000), str(p.expected, 4000), p.blocking ? 1 : 0, str(p.orderNumber, 64), ts
          );
          break;
        }
        case "deleteIssue": {
          db.prepare("DELETE FROM issues WHERE id=? AND run_id=?").run(str(p.id, 64), id);
          break;
        }
        case "run": {
          if (p.prep !== undefined) db.prepare("UPDATE runs SET prep=? WHERE id=?").run(JSON.stringify(cleanRecord(p.prep)), id);
          if (p.finish !== undefined) db.prepare("UPDATE runs SET finish=? WHERE id=?").run(JSON.stringify(cleanRecord(p.finish)), id);
          break;
        }
        case "survey": {
          const answers = cleanRecord(p.answers, 100, 4000);
          db.prepare(
            `INSERT INTO survey_responses (run_id, answers, created_at, updated_at) VALUES (?,?,?,?)
             ON CONFLICT(run_id) DO UPDATE SET answers=excluded.answers, updated_at=excluded.updated_at`
          ).run(id, JSON.stringify(answers), ts, ts);
          db.prepare("UPDATE runs SET status='finished', finished_at=COALESCE(finished_at, ?) WHERE id=?").run(ts, id);
          break;
        }
      }
    }
    db.prepare("UPDATE runs SET updated_at=? WHERE id=?").run(ts, id);
  });
  apply();
  return json({ ok: true, applied: events.length });
}
