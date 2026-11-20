import { expectedText } from "./guide-utils";
import { getGuide, GUIDES } from "@/lib/guides";
import {
  checkValue, deviceSummary, flatten, guideTitle, HELP_STATUS, loadAll, parseRec, resultLabel, runStatusLabel,
} from "@/lib/admin-data";
import { COURIER_QUESTIONS, faceOf } from "@/lib/courier";
import { answerOf, loadCourier } from "@/lib/courier-data";
import { insightsExport } from "@/lib/insights";

export type Cell = string | number | null | undefined;
export type ExportKind = "insights" | "runs" | "steps" | "activities" | "issues" | "survey" | "help" | "courier" | "courier_issues";
export const EXPORT_KINDS: ExportKind[] = ["insights", "runs", "steps", "activities", "issues", "survey", "help", "courier", "courier_issues"];

/** Encabezados que contienen fechas ISO (para exportaciones que soportan fechas reales). */
export const DATE_HEADERS = new Set(["terminada por bloqueo", "creada", "actualizada", "terminada", "creado", "pedida", "cerrada"]);

/** Encuesta de repartidores (no depende del filtro de guía). Respuestas como número 1–5 y carita. */
function buildCourierExport(kind: "courier" | "courier_issues", origin: string): { headers: string[]; rows: Cell[][] } {
  const { feedback, issues, attachments } = loadCourier();
  const fileUrls = (pred: (a: (typeof attachments)[number]) => boolean) =>
    attachments.filter(pred).map((a) => `${origin}/api/admin/courier-files/${a.id}`).join("\n");
  if (kind === "courier") {
    const headers = [
      "encuesta", "nombre", "teléfono", "dispositivo", "ip",
      ...COURIER_QUESTIONS.flatMap((q) => [q.label, `${q.short} (carita)`]),
      "promedio", "comentario", "problemas", "fotos", "creado", "actualizada",
    ];
    const rows = feedback.map((f) => {
      const ans = parseRec(f.answers);
      const dev = parseRec(f.device);
      const vals = COURIER_QUESTIONS.map((q) => answerOf(ans, q.id));
      const nums = vals.filter((v): v is number => v !== null);
      return [
        f.id, f.name, f.phone, flatten({ ...dev, ip: "" }), String(dev.ip ?? ""),
        ...vals.flatMap((v) => [v, v ? `${faceOf(v)?.emoji} ${faceOf(v)?.label}` : ""]),
        nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null,
        f.comment, issues.filter((i) => i.feedback_id === f.id).length, fileUrls((a) => a.feedback_id === f.id),
        f.created_at, f.updated_at,
      ];
    });
    return { headers, rows };
  }
  const byId = new Map(feedback.map((f) => [f.id, f]));
  const headers = ["encuesta", "repartidor", "teléfono", "dispositivo", "qué pasó", "fotos", "creado"];
  const rows = issues.map((i) => {
    const f = byId.get(i.feedback_id);
    return [
      i.feedback_id, f?.name, f?.phone, f ? deviceSummary(parseRec(f.device)) : "", i.description,
      fileUrls((a) => a.issue_id === i.id), i.created_at,
    ];
  });
  return { headers, rows };
}

export function buildExport(kind: ExportKind, origin: string, guideId: string | null): { headers: string[]; rows: Cell[][] } {
  if (kind === "courier" || kind === "courier_issues") return buildCourierExport(kind, origin);
  if (kind === "insights") return insightsExport(guideId);
  const d = loadAll(guideId);
  const runById = new Map(d.runs.map((r) => [r.id, r]));
  const runLabel = (id: string) => `${id.slice(0, 8)}`;
  const actTitle = (guide: string, act: string) => getGuide(guide)?.activities.find((a) => a.id === act)?.title ?? "";

  let headers: string[] = [];
  let rows: Cell[][] = [];

  if (kind === "runs") {
    headers = ["run", "nombre", "correo", "rol", "guía", "versión", "campos del tester", "dispositivo", "ip", "preparación", "cierre", "estado", "motivo de término", "terminada por bloqueo", "creada", "actualizada", "terminada", "pasos ok", "pasos con falla", "reportes", "reportes bloqueantes", "solicitudes de ayuda"];
    rows = d.runs.map((r) => {
      const dev = parseRec(r.device);
      const steps = d.steps.filter((s) => s.run_id === r.id);
      const iss = d.issues.filter((i) => i.run_id === r.id);
      return [
        r.id, r.name, r.email, r.role, guideTitle(r.guide_id), r.guide_version,
        flatten(parseRec(r.tester_fields)), flatten({ ...dev, ip: "" }), String(dev.ip ?? ""),
        flatten(parseRec(r.prep)), flatten(parseRec(r.finish)), runStatusLabel(r.status), r.ended_reason, r.ended_at,
        r.created_at, r.updated_at, r.finished_at,
        steps.filter((s) => s.outcome === "ok").length, steps.filter((s) => s.outcome === "fail").length,
        iss.length, iss.filter((i) => i.blocking).length, d.help.filter((h) => h.run_id === r.id).length,
      ];
    });
  } else if (kind === "steps") {
    headers = ["run", "tester", "actividad", "paso", "texto del paso", "resultado"];
    rows = d.steps.map((s) => {
      const r = runById.get(s.run_id)!;
      const a = getGuide(r.guide_id)?.activities.find((x) => x.id === s.activity_id);
      return [runLabel(r.id), r.name, s.activity_id, s.step_id, a?.steps.find((x) => x.id === s.step_id)?.text, s.outcome === "ok" ? "ok" : "falla"];
    });
  } else if (kind === "activities") {
    headers = ["run", "tester", "actividad", "título", "resultado", "verificaciones", "campos", "notas"];
    rows = d.activities.map((a) => {
      const r = runById.get(a.run_id)!;
      const act = getGuide(r.guide_id)?.activities.find((x) => x.id === a.activity_id);
      const checks = parseRec(a.checks);
      const summary = (act?.expected ?? [])
        .map((item, i) => {
          const t = expectedText(item);
          const v = checkValue(checks, i, t);
          return `${v === undefined ? "?" : v === "na" ? "no aplica" : v ? "sí" : "no"}: ${t}`;
        })
        .join(" | ");
      const labels = new Map((act?.fields ?? []).map((f) => [f.id, f.label]));
      const fields = flatten(Object.fromEntries(Object.entries(parseRec(a.fields)).map(([k, v]) => [labels.get(k) ?? k, v])));
      return [runLabel(r.id), r.name, a.activity_id, act?.title, resultLabel(a.result), summary, fields, a.notes];
    });
  } else if (kind === "issues") {
    headers = ["run", "tester", "correo", "dispositivo", "actividad", "paso", "tipo", "descripción", "esperado", "bloqueante", "número de pedido", "archivos", "creado"];
    rows = d.issues.map((i) => {
      const r = runById.get(i.run_id)!;
      const files = d.attachments.filter((a) => a.issue_id === i.id).map((a) => `${origin}/api/admin/files/${a.id}`).join("\n");
      return [
        runLabel(r.id), r.name, r.email, deviceSummary(parseRec(r.device), parseRec(r.tester_fields)),
        `${i.activity_id} ${actTitle(r.guide_id, i.activity_id)}`.trim(), i.step_id, i.kind === "evidence" ? "evidencia" : "falla",
        i.description, i.expected, i.blocking ? "sí" : "no", i.order_number, files, i.created_at,
      ];
    });
  } else if (kind === "help") {
    headers = ["run", "tester", "correo", "guía", "actividad", "paso", "reporte", "motivo", "estado", "pedida", "cerrada", "resolución"];
    rows = d.help.map((h) => {
      const r = runById.get(h.run_id)!;
      return [
        runLabel(r.id), r.name, r.email, guideTitle(r.guide_id), `${h.activity_id} ${actTitle(r.guide_id, h.activity_id)}`.trim(),
        h.step_id, h.issue_id, h.reason, HELP_STATUS[h.status] ?? h.status, h.created_at, h.resolved_at, h.resolution,
      ];
    });
  } else {
    const guide = (guideId && getGuide(guideId)) || (d.runs.length ? getGuide(d.runs[0].guide_id) : GUIDES[0]);
    const qs = guide?.survey.questions ?? [];
    headers = ["run", "tester", "correo", "guía", ...qs.map((q) => q.label)];
    rows = d.surveys
      .filter((s) => runById.get(s.run_id)?.guide_id === guide?.id)
      .map((s) => {
        const r = runById.get(s.run_id)!;
        const ans = parseRec(s.answers);
        return [runLabel(r.id), r.name, r.email, guideTitle(r.guide_id), ...qs.map((q) => (q.id in ans ? String(ans[q.id]) : ""))];
      });
  }

  return { headers, rows };
}

export function requestOrigin(req: Request) {
  const url = new URL(req.url);
  return `${(req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")).split(",")[0]}://${
    req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host
  }`;
}
