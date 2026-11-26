import { activeRoundId, roundCond, viewRoundId } from "./rounds";
import crypto from "node:crypto";
import { getDb } from "./db";
import { sha256 } from "./auth";
import { parseRec } from "./admin-data";
import { COURIER_NA, COURIER_QUESTIONS, type CourierQuestion } from "./courier";
export { ROUND_CLOSED, ROUND_CLOSED_MESSAGE } from "./courier";

export type CourierFeedbackRow = {
  id: string;
  name: string;
  phone: string;
  device: string;
  answers: string;
  comment: string;
  created_at: string;
  updated_at: string;
  verdict_scope?: string;
  verdict_scope_note?: string;
};
export type CourierIssueRow = { id: string; feedback_id: string; description: string; created_at: string };
export type CourierAttachmentRow = { id: string; feedback_id: string; issue_id: string; original_name: string; mime: string; size: number };

/**
 * La encuesta existe y es de una ronda anterior a la activa: ya no se edita ni se le agregan
 * problemas o fotos (lo que llega después de abrir una ronda nueva es de la ronda nueva).
 */
export function courierRoundClosed(feedbackId: string): boolean {
  const row = getDb().prepare("SELECT round_id FROM courier_feedback WHERE id = ?").get(feedbackId) as { round_id: number } | undefined;
  return !!row && row.round_id !== activeRoundId();
}

/** Valida el token de la encuesta (cabecera x-courier-token). */
export function checkCourierToken(feedbackId: string, token: string | null) {
  if (!token) return false;
  const row = getDb().prepare("SELECT token_hash FROM courier_feedback WHERE id = ?").get(feedbackId) as { token_hash: string } | undefined;
  if (!row) return false;
  const a = Buffer.from(row.token_hash);
  const b = Buffer.from(sha256(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Respuesta 1–5 de una pregunta, o null (sin respuesta o «no aplica», que no cuenta en promedios). */
export function answerOf(answers: Record<string, unknown>, id: string): number | null {
  const v = Number(answers[id]);
  return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
}

/** El repartidor eligió «No me tocó / No llegué a esta parte». */
export const isCourierNa = (answers: Record<string, unknown>, id: string) => answers[id] === COURIER_NA;

/** Encuestas de repartidores de una ronda (por omisión, la que está a la vista en el panel). */
export function loadCourier(round = viewRoundId()) {
  const db = getDb();
  const feedback = db
    .prepare(`SELECT id, name, phone, device, answers, comment, created_at, updated_at, verdict_scope, verdict_scope_note FROM courier_feedback WHERE ${roundCond("round_id", round)} ORDER BY created_at DESC`)
    .all() as CourierFeedbackRow[];
  const inRound = `feedback_id IN (SELECT id FROM courier_feedback WHERE ${roundCond("round_id", round)})`;
  const issues = db.prepare(`SELECT * FROM courier_issues WHERE ${inRound} ORDER BY created_at`).all() as CourierIssueRow[];
  const attachments = db
    .prepare(`SELECT id, feedback_id, issue_id, original_name, mime, size FROM courier_attachments WHERE ${inRound} ORDER BY created_at`)
    .all() as CourierAttachmentRow[];
  return { feedback, issues, attachments };
}

/** `n` y `avg` solo cuentan caritas 1–5; `naCount` = cuántos eligieron «No me tocó». */
export type CourierQuestionStats = CourierQuestion & { counts: number[]; n: number; naCount: number; avg: number | null };

/** Distribución (1–5) y promedio por pregunta; «no aplica» queda fuera del promedio. */
export function courierStats(feedback: CourierFeedbackRow[]) {
  const answers = feedback.map((f) => parseRec(f.answers));
  const questions: CourierQuestionStats[] = COURIER_QUESTIONS.map((q) => {
    const vals = answers.map((a) => answerOf(a, q.id)).filter((v): v is number => v !== null);
    const counts = [1, 2, 3, 4, 5].map((v) => vals.filter((x) => x === v).length);
    const naCount = answers.filter((a) => isCourierNa(a, q.id)).length;
    return { ...q, counts, n: vals.length, naCount, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
  const all = questions.flatMap((q) => q.counts.flatMap((c, i) => Array<number>(c).fill(i + 1)));
  return { responses: feedback.length, questions, avg: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null };
}
