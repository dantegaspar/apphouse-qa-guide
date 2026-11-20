import { getDb } from "./db";
import { getGuide } from "./guides";
import { ACTIVITY_RESULTS } from "./types";

export type RunRow = {
  id: string;
  guide_id: string;
  guide_version: string;
  name: string;
  email: string;
  role: string;
  tester_fields: string;
  device: string;
  prep: string;
  finish: string;
  status: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  ended_reason: string;
  ended_at: string | null;
};
export type StepRow = { run_id: string; activity_id: string; step_id: string; outcome: "ok" | "fail" };
export type ActivityRow = { run_id: string; activity_id: string; result: string | null; checks: string; fields: string; notes: string };
export type IssueRow = {
  id: string;
  run_id: string;
  activity_id: string;
  step_id: string | null;
  kind: "issue" | "evidence";
  description: string;
  expected: string;
  blocking: number;
  order_number: string;
  created_at: string;
};
export type HelpRow = {
  id: string;
  run_id: string;
  activity_id: string;
  step_id: string | null;
  issue_id: string | null;
  reason: string;
  status: "open" | "resolved" | "ended";
  created_at: string;
  resolved_at: string | null;
  resolution: string;
};
export const HELP_STATUS: Record<HelpRow["status"], string> = { open: "Abierta", resolved: "Resuelta", ended: "Prueba terminada" };

export const RUN_STATUS: Record<string, string> = {
  in_progress: "En curso",
  finished: "Terminada",
  ended_blocked: "Terminada por bloqueo",
};
export const runStatusLabel = (s: string) => RUN_STATUS[s] ?? s;
export const runStatusClass = (s: string) =>
  s === "finished" ? "bg-emerald-100 text-emerald-800" : s === "ended_blocked" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";

/** "hace 5 min" */
export function timeAgo(iso: string, nowMs = Date.now()) {
  const m = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (m < 1) return "hace menos de 1 min";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h ${m % 60} min`;
  return `hace ${Math.floor(h / 24)} día(s)`;
}

/** Solicitudes de ayuda abiertas de todas las guías (las más antiguas primero). */
export function loadOpenHelp() {
  const rows = getDb()
    .prepare(
      `SELECT h.*, r.name AS tester, r.guide_id AS guide_id FROM help_requests h JOIN runs r ON r.id = h.run_id
       WHERE h.status = 'open' ORDER BY h.created_at`
    )
    .all() as (HelpRow & { tester: string; guide_id: string })[];
  return { rows, at: Date.now() };
}

export type AttachmentRow = { id: string; run_id: string; issue_id: string; original_name: string; mime: string; size: number };

export type Rec = Record<string, string | number | boolean>;

export function parseRec(s: string | null | undefined): Rec {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const flatten = (r: Rec, sep = "; ") =>
  Object.entries(r)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "boolean" ? (v ? "sí" : "no") : v}`)
    .join(sep);

/** Resumen corto del dispositivo (sin IP). */
export function deviceSummary(device: Rec, fields?: Rec): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim() && !parts.includes(v.trim())) parts.push(v.trim());
  };
  push(fields?.device);
  for (const [k, v] of Object.entries(device)) {
    if (k === "ip" || k === "userAgent" || k === "ua") continue;
    push(v);
  }
  return parts.slice(0, 3).join(" · ");
}

export const guideTitle = (id: string) => getGuide(id)?.title ?? id;

export const resultLabel = (r: string | null | undefined) =>
  r && r in ACTIVITY_RESULTS ? ACTIVITY_RESULTS[r as keyof typeof ACTIVITY_RESULTS] : "Pendiente";

export function loadRuns(guideId?: string | null): RunRow[] {
  const db = getDb();
  return (guideId
    ? db.prepare("SELECT * FROM runs WHERE guide_id = ? ORDER BY created_at DESC").all(guideId)
    : db.prepare("SELECT * FROM runs ORDER BY created_at DESC").all()) as RunRow[];
}

export function loadAll(guideId?: string | null) {
  const db = getDb();
  const runs = loadRuns(guideId);
  const ids = new Set(runs.map((r) => r.id));
  const keep = <T extends { run_id: string }>(rows: T[]) => rows.filter((r) => ids.has(r.run_id));
  return {
    runs,
    steps: keep(db.prepare("SELECT run_id, activity_id, step_id, outcome FROM step_results").all() as StepRow[]),
    activities: keep(db.prepare("SELECT * FROM activity_results").all() as ActivityRow[]),
    issues: keep(db.prepare("SELECT * FROM issues ORDER BY created_at DESC").all() as IssueRow[]),
    attachments: keep(db.prepare("SELECT id, run_id, issue_id, original_name, mime, size FROM attachments ORDER BY created_at").all() as AttachmentRow[]),
    help: keep(db.prepare("SELECT * FROM help_requests ORDER BY created_at DESC").all() as HelpRow[]),
    surveys: keep(db.prepare("SELECT run_id, answers FROM survey_responses").all() as { run_id: string; answers: string }[]),
  };
}

export const isImage = (mime: string) => mime.startsWith("image/") && !/hei[cf]/.test(mime);
export const isVideo = (mime: string) => mime.startsWith("video/");

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "";

/** Estado de una verificación "qué debería pasar"; la clave puede ser el índice o el texto. */
export function checkValue(checks: Rec, index: number, text: string): boolean | undefined {
  for (const k of [String(index), `e${index}`, `${index}`, text]) {
    if (k in checks) return Boolean(checks[k]);
  }
  return undefined;
}
