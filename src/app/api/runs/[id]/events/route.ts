import { getDb, now } from "@/lib/db";
import { getGuide } from "@/lib/guides";
import { checkRunToken } from "@/lib/auth";
import { err, hasErrors, invalid, json, readJsonObject } from "@/lib/http";
import { ACTIVITY_RESULTS, LEGACY_SEVERITY, SEVERITIES, type Activity, type Guide } from "@/lib/types";
import { expectedConditional } from "@/lib/guide-utils";
import {
  boolError,
  boolRecordErrors,
  collect,
  enumError,
  fieldsCheck,
  idError,
  isoDateError,
  isPlainObject,
  summarize,
  surveyAnswerError,
  text,
  textError,
  type FieldErrors,
} from "@/lib/validate";

export const dynamic = "force-dynamic";

const MAX_EVENTS = 200;
const MAX_BODY = 1024 * 1024;
const EVENT_TYPES = ["step", "activity", "issue", "deleteIssue", "run", "survey", "surveyDraft"] as const;
const RESULTS = Object.keys(ACTIVITY_RESULTS);
const STEP_OUTCOMES = ["ok", "fail", "na"];
/** Resultados con los que la actividad se hizo: ahí se esperan los campos obligatorios. */
const DONE_RESULTS = ["ok", "issue"];

type Db = ReturnType<typeof getDb>;
type Ctx = { db: Db; runId: string; guide: Guide; ts: string };
/** Resultado de validar un evento: errores (se rechaza) o la operación a aplicar (+ avisos). */
type Checked = { errors: FieldErrors } | { apply: () => void; warnings?: FieldErrors };
type Report = { index: number; type: string; error: string; fields: FieldErrors };

/**
 * Recibe los cambios del tester (cola del navegador). Todas las operaciones son idempotentes
 * (upserts), así que reenviar un evento no duplica datos.
 *
 * Validación: el cuerpo debe ser `{ events: [...] }` con ≤200 eventos (si no, 400). Cada evento se
 * valida por separado; un evento inválido NO se guarda y se informa en `rejected` (con errores por
 * campo), pero el lote responde 200 para que la cola del navegador no se atore con un evento que
 * nunca será válido. Los demás eventos del lote sí se aplican.
 *
 * Regla de campos de actividad («Anota»): el navegador manda el evento `activity` solo al guardar
 * (cerrar) la actividad, con su resultado. Los valores no vacíos mal formados (pattern de la guía,
 * maxLength, tipo, campo desconocido) rechazan el evento. Los campos `required` solo se exigen si
 * el resultado es «ok» o «issue»; con «blocked», «skipped» o sin resultado pueden ir vacíos.
 * (Es la misma regla que aplica la pantalla de la actividad antes de guardar.)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!checkRunToken(id, req.headers.get("x-run-token"))) return err("No autorizado", 401);
  const { body, res } = await readJsonObject(req, MAX_BODY);
  if (res) return res;
  if (!Array.isArray(body.events)) return invalid({ events: "Faltan los eventos." });
  if (body.events.length > MAX_EVENTS) return invalid({ events: `Máximo ${MAX_EVENTS} eventos por envío.` });

  const db = getDb();
  const run = db.prepare("SELECT guide_id FROM runs WHERE id = ?").get(id) as { guide_id: string };
  const guide = getGuide(run.guide_id);
  if (!guide) return err("Guía no encontrada", 404);
  const ctx: Ctx = { db, runId: id, guide, ts: now() };

  const rejected: Report[] = [];
  const warnings: Report[] = [];
  const ops: (() => void)[] = [];
  (body.events as unknown[]).forEach((ev, index) => {
    const type = isPlainObject(ev) && typeof ev.type === "string" ? ev.type.slice(0, 32) : "";
    const c = checkEvent(ctx, ev);
    if ("errors" in c) rejected.push({ index, type, error: summarize(c.errors), fields: c.errors });
    else {
      ops.push(c.apply);
      if (c.warnings && hasErrors(c.warnings)) warnings.push({ index, type, error: summarize(c.warnings), fields: c.warnings });
    }
  });

  db.transaction(() => {
    for (const op of ops) op();
    db.prepare("UPDATE runs SET updated_at=? WHERE id=?").run(ctx.ts, id);
  })();
  if (rejected.length) console.warn(`[events] corrida ${id}: ${rejected.length} evento(s) rechazado(s)`, JSON.stringify(rejected).slice(0, 2000));
  return json({ ok: true, applied: ops.length, rejected, warnings });
}

function checkEvent(ctx: Ctx, ev: unknown): Checked {
  if (!isPlainObject(ev)) return { errors: { event: "Evento inválido." } };
  const typeErr = enumError(ev.type, EVENT_TYPES, { label: "un tipo de evento" });
  if (typeErr) return { errors: { type: "Tipo de evento desconocido." } };
  if (!isPlainObject(ev.payload)) return { errors: { payload: "Faltan los datos del evento." } };
  const p = ev.payload;
  switch (ev.type as (typeof EVENT_TYPES)[number]) {
    case "step":
      return stepEvent(ctx, p);
    case "activity":
      return activityEvent(ctx, p);
    case "issue":
      return issueEvent(ctx, p);
    case "deleteIssue":
      return deleteIssueEvent(ctx, p);
    case "run":
      return runEvent(ctx, p);
    case "survey":
      return surveyEvent(ctx, p, { draft: false });
    case "surveyDraft":
      return surveyEvent(ctx, p, { draft: true });
  }
}

const findActivity = (g: Guide, id: unknown): Activity | undefined => (typeof id === "string" ? g.activities.find((a) => a.id === id) : undefined);

function activityAndStep(ctx: Ctx, p: Record<string, unknown>, { stepRequired }: { stepRequired: boolean }) {
  const act = findActivity(ctx.guide, p.activityId);
  const errors: FieldErrors = {};
  if (!act) errors.activityId = p.activityId === undefined ? "Falta la actividad." : "La actividad no existe en esta guía.";
  else {
    const e = idError(p.stepId, { known: act.steps.map((s) => s.id), required: stepRequired, label: "el paso" });
    if (e) errors.stepId = e;
  }
  return { act, errors };
}

/**
 * Paso: activityId y stepId de la guía; outcome "ok" | "fail" | "na" | null (null borra la marca).
 * `checkpoint` (o `checks`) opcional: casillas de un paso de confirmación (Step.checkpoint), con
 * llaves "0".."n-1" y valores sí/no. Se guarda en step_results.checkpoint junto con el resultado.
 */
function stepEvent(ctx: Ctx, p: Record<string, unknown>): Checked {
  const { act, errors } = activityAndStep(ctx, p, { stepRequired: true });
  // "na" = «No me apareció» (pasos condicionales). Se acepta en cualquier paso para no trabar al tester.
  if (!("outcome" in p) || (p.outcome !== null && !STEP_OUTCOMES.includes(p.outcome as string)))
    errors.outcome = "Marca el paso como «ok», «fail», «na» o sin marcar.";
  const rawTicks = p.checkpoint ?? p.checks;
  const step = act?.steps.find((s) => s.id === p.stepId);
  if (rawTicks !== undefined && rawTicks !== null && step) {
    const items = step.checkpoint?.items ?? [];
    if (!items.length && isPlainObject(rawTicks) && Object.keys(rawTicks).length)
      errors.checkpoint = "Este paso no tiene casillas de confirmación.";
    else Object.assign(errors, boolRecordErrors(rawTicks, items.map((_, i) => String(i)), "checkpoint", { label: "las casillas de confirmación" }));
  }
  if (hasErrors(errors)) return { errors };
  const { db, runId, ts } = ctx;
  const activityId = act!.id;
  const stepId = p.stepId as string;
  const ticks = isPlainObject(rawTicks) ? JSON.stringify(rawTicks) : null;
  return {
    apply: () => {
      if (p.outcome === null) {
        db.prepare("DELETE FROM step_results WHERE run_id=? AND activity_id=? AND step_id=?").run(runId, activityId, stepId);
      } else {
        // Sin casillas en el evento se conservan las que ya estaban guardadas
        db.prepare(
          `INSERT INTO step_results (run_id, activity_id, step_id, outcome, checkpoint, updated_at) VALUES (?,?,?,?,COALESCE(?, '{}'),?)
           ON CONFLICT(run_id, activity_id, step_id) DO UPDATE SET outcome=excluded.outcome,
             checkpoint=COALESCE(?, step_results.checkpoint), updated_at=excluded.updated_at`
        ).run(runId, activityId, stepId, p.outcome as string, ticks, ts, ticks);
      }
    },
  };
}

/**
 * Cierre de actividad: activityId de la guía; result de ACTIVITY_RESULTS (o null); checks = marcas
 * del resultado esperado (ver expectedChecksErrors); notes ≤4000; fields según FieldDef (ver la
 * regla de campos arriba; las hojas de pedidos "orders" se validan como arreglo de OrderRow).
 */
function activityEvent(ctx: Ctx, p: Record<string, unknown>): Checked {
  const act = findActivity(ctx.guide, p.activityId);
  if (!act) return { errors: { activityId: p.activityId === undefined ? "Falta la actividad." : "La actividad no existe en esta guía." } };
  const errors: FieldErrors = {
    ...collect([
      ["result", enumError(p.result, RESULTS, { required: false, label: "cómo te fue" })],
      ["notes", textError(p.notes, { max: 4000, label: "el comentario" })],
    ]),
    ...expectedChecksErrors(act, p.checks),
  };
  if (p.fields !== undefined && p.fields !== null && !isPlainObject(p.fields)) errors.fields = "Los datos anotados no tienen el formato correcto.";
  if (hasErrors(errors)) return { errors };

  const result = typeof p.result === "string" ? p.result : null;
  const f = fieldsCheck(p.fields, act.fields ?? [], "fields", { enforceRequired: !!result && DONE_RESULTS.includes(result) });
  if (hasErrors(f.errors)) return { errors: f.errors };
  const checks = (p.checks ?? {}) as Record<string, boolean | "na">;
  const { db, runId, ts } = ctx;
  return {
    apply: () =>
      db
        .prepare(
          `INSERT INTO activity_results (run_id, activity_id, result, checks, fields, notes, updated_at) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(run_id, activity_id) DO UPDATE SET result=excluded.result, checks=excluded.checks,
             fields=excluded.fields, notes=excluded.notes, updated_at=excluded.updated_at`
        )
        .run(runId, act.id, result, JSON.stringify(checks), JSON.stringify(f.values), text(p.notes), ts),
  };
}

/**
 * Marcas del resultado esperado: llaves "0".."n-1"; valor sí/no, o "na" (no aplica) solo en los
 * puntos condicionales ({ text, conditional: true }).
 */
function expectedChecksErrors(act: Activity, v: unknown): FieldErrors {
  if (v === undefined || v === null) return {};
  if (!isPlainObject(v)) return { checks: "Las marcas del resultado esperado no tienen el formato correcto." };
  const errors: FieldErrors = {};
  for (const [k, val] of Object.entries(v)) {
    const item = /^\d+$/.test(k) ? act.expected[Number(k)] : undefined;
    const conditional = item !== undefined && expectedConditional(item);
    if (item === undefined) errors[`checks.${k.slice(0, 64)}`] = "Este punto no existe en el resultado esperado.";
    else if (!(typeof val === "boolean" || (conditional && val === "na")))
      errors[`checks.${k}`] = conditional ? "Marca sí, no o no aplica." : "Marca sí o no.";
  }
  return errors;
}

/**
 * Reporte: id del navegador; activityId/stepId de la guía; kind "issue" | "evidence";
 * descripción obligatoria (3–4000) en fallas y opcional (≤4000) en evidencias; expected ≤4000;
 * blocking sí/no; severity alto|medio|bajo (también critico, o los viejos bloqueante|mayor|menor; sin ella sale de blocking); orderNumber ≤64; createdAt ISO opcional.
 */
function issueEvent(ctx: Ctx, p: Record<string, unknown>): Checked {
  const { act, errors } = activityAndStep(ctx, p, { stepRequired: false });
  const isIssue = p.kind === "issue";
  Object.assign(
    errors,
    collect([
      ["id", idError(p.id, { label: "el reporte" })],
      ["kind", enumError(p.kind, ["issue", "evidence"], { label: "el tipo de reporte" })],
      ["description", textError(p.description, isIssue ? { min: 3, max: 4000, required: true, label: "qué pasó" } : { max: 4000, label: "la descripción" })],
      ["expected", textError(p.expected, { max: 4000, label: "qué esperabas" })],
      ["blocking", boolError(p.blocking, { label: "si la falla te impide seguir" })],
      ["severity", p.severity === undefined || p.severity === "" ? null : enumError(p.severity, [...Object.keys(SEVERITIES), ...Object.keys(LEGACY_SEVERITY)], { label: "la gravedad" })],
      ["orderNumber", textError(p.orderNumber, { max: 64, label: "el número de pedido" })],
      ["createdAt", isoDateError(p.createdAt)],
    ])
  );
  if (hasErrors(errors)) return { errors };
  const { db, runId, ts } = ctx;
  // Clientes con la versión anterior mandan bloqueante / mayor / menor: se traducen a la escala del Plan.
  const blocking = p.blocking === true || p.severity === "bloqueante";
  const sevIn = typeof p.severity === "string" && p.severity ? (LEGACY_SEVERITY[p.severity] ?? p.severity) : "";
  const severity = !isIssue ? "" : sevIn || (blocking ? "alto" : "medio");
  return {
    apply: () =>
      db
        .prepare(
          `INSERT INTO issues (id, run_id, activity_id, step_id, kind, description, expected, blocking, severity, order_number, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET description=excluded.description, expected=excluded.expected,
             blocking=excluded.blocking, severity=excluded.severity, order_number=excluded.order_number
           WHERE issues.run_id = excluded.run_id`
        )
        .run(
          p.id as string, runId, act!.id, text(p.stepId) || null, p.kind as string,
          text(p.description), text(p.expected), blocking ? 1 : 0, severity, text(p.orderNumber), ts
        ),
  };
}

function deleteIssueEvent(ctx: Ctx, p: Record<string, unknown>): Checked {
  const e = idError(p.id, { label: "el reporte" });
  if (e) return { errors: { id: e } };
  return { apply: () => void ctx.db.prepare("DELETE FROM issues WHERE id=? AND run_id=?").run(p.id as string, ctx.runId) };
}

/** Preparación / cierre: marcas sí/no con llaves de los checklists de la guía. */
function runEvent(ctx: Ctx, p: Record<string, unknown>): Checked {
  const { guide, db, runId } = ctx;
  if (p.prep === undefined && p.finish === undefined) return { errors: { payload: "Faltan las marcas de preparación o de cierre." } };
  const errors = {
    ...boolRecordErrors(p.prep, guide.prep.checklist.map((c) => c.id), "prep", { label: "las marcas de preparación" }),
    ...boolRecordErrors(p.finish, guide.finish.checklist.map((c) => c.id), "finish", { label: "las marcas de cierre" }),
  };
  if (hasErrors(errors)) return { errors };
  return {
    apply: () => {
      if (p.prep !== undefined && p.prep !== null) db.prepare("UPDATE runs SET prep=? WHERE id=?").run(JSON.stringify(p.prep), runId);
      if (p.finish !== undefined && p.finish !== null) db.prepare("UPDATE runs SET finish=? WHERE id=?").run(JSON.stringify(p.finish), runId);
    },
  };
}

/**
 * Encuesta: solo preguntas de la guía; escala entera en [min, max] (1–5 por omisión), NPS entero
 * 0–10, opción exacta de la lista, texto ≤2000. Las respuestas vacías se descartan.
 *
 * - `survey` (envío final): las obligatorias deben contestarse; guarda con is_draft=0 y marca la
 *   corrida como terminada.
 * - `surveyDraft` (borrador mientras contesta): acepta respuestas parciales (sin obligatorias) pero
 *   rechaza valores mal formados; guarda con is_draft=1 sin cambiar el estado de la corrida y nunca
 *   sobrescribe un envío final (si ya existe, el borrador se ignora y se informa en `warnings`).
 */
function surveyEvent(ctx: Ctx, p: Record<string, unknown>, { draft }: { draft: boolean }): Checked {
  const { guide, db, runId, ts } = ctx;
  if (!isPlainObject(p.answers)) return { errors: { answers: "Faltan las respuestas de la encuesta." } };
  const raw = p.answers;
  const errors: FieldErrors = {};
  const answers: Record<string, string | number> = {};
  const byId = new Map(guide.survey.questions.map((q) => [q.id, q]));
  for (const k of Object.keys(raw)) if (!byId.has(k)) errors[`answers.${k.slice(0, 64)}`] = "Esta pregunta no existe en la encuesta.";
  for (const q of guide.survey.questions) {
    const v = raw[q.id];
    const e = surveyAnswerError(q, v, { partial: draft });
    if (e) errors[`answers.${q.id}`] = e;
    else if (v !== undefined && v !== null && v !== "") answers[q.id] = typeof v === "string" ? v.trim() : (v as number);
  }
  if (hasErrors(errors)) return { errors };

  if (draft) {
    const final = db
      .prepare("SELECT 1 FROM survey_responses s JOIN runs r ON r.id = s.run_id WHERE s.run_id = ? AND (s.is_draft = 0 OR r.status = 'finished')")
      .get(runId);
    if (final) return { apply: () => {}, warnings: { answers: "La encuesta ya se envió; el borrador no se guardó." } };
    return {
      // El WHERE protege también contra un envío final que llegue antes en el mismo lote
      apply: () =>
        void db
          .prepare(
            `INSERT INTO survey_responses (run_id, answers, is_draft, created_at, updated_at) VALUES (?,?,1,?,?)
             ON CONFLICT(run_id) DO UPDATE SET answers=excluded.answers, updated_at=excluded.updated_at
             WHERE survey_responses.is_draft = 1`
          )
          .run(runId, JSON.stringify(answers), ts, ts),
    };
  }
  return {
    apply: () => {
      db.prepare(
        `INSERT INTO survey_responses (run_id, answers, is_draft, created_at, updated_at) VALUES (?,?,0,?,?)
         ON CONFLICT(run_id) DO UPDATE SET answers=excluded.answers, is_draft=0, updated_at=excluded.updated_at`
      ).run(runId, JSON.stringify(answers), ts, ts);
      // Una prueba terminada por bloqueo conserva ese estado aunque conteste la encuesta
      db.prepare(
        "UPDATE runs SET status=CASE WHEN status='ended_blocked' THEN status ELSE 'finished' END, finished_at=COALESCE(finished_at, ?) WHERE id=?"
      ).run(ts, runId);
    },
  };
}
