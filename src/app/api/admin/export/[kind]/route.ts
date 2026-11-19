import { isAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { err } from "@/lib/http";
import { getGuide, GUIDES } from "@/lib/guides";
import {
  checkValue, deviceSummary, flatten, guideTitle, loadAll, parseRec, resultLabel,
} from "@/lib/admin-data";

export const dynamic = "force-dynamic";

type Cell = string | number | null | undefined;
const KINDS = ["runs", "steps", "activities", "issues", "survey"];

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  const { kind } = await params;
  if (!KINDS.includes(kind)) return err("Tipo de exportación desconocido", 404);

  const url = new URL(req.url);
  const guideId = url.searchParams.get("guide");
  const origin = `${(req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")).split(",")[0]}://${
    req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host
  }`;
  const d = loadAll(guideId);
  const runById = new Map(d.runs.map((r) => [r.id, r]));
  const runLabel = (id: string) => `${id.slice(0, 8)}`;
  const actTitle = (guide: string, act: string) => getGuide(guide)?.activities.find((a) => a.id === act)?.title ?? "";

  let headers: string[] = [];
  let rows: Cell[][] = [];

  if (kind === "runs") {
    headers = ["run", "nombre", "correo", "rol", "guía", "versión", "campos del tester", "dispositivo", "ip", "preparación", "cierre", "estado", "creada", "actualizada", "terminada", "pasos ok", "pasos con falla", "reportes", "reportes bloqueantes"];
    rows = d.runs.map((r) => {
      const dev = parseRec(r.device);
      const steps = d.steps.filter((s) => s.run_id === r.id);
      const iss = d.issues.filter((i) => i.run_id === r.id);
      return [
        r.id, r.name, r.email, r.role, guideTitle(r.guide_id), r.guide_version,
        flatten(parseRec(r.tester_fields)), flatten({ ...dev, ip: "" }), String(dev.ip ?? ""),
        flatten(parseRec(r.prep)), flatten(parseRec(r.finish)), r.status, r.created_at, r.updated_at, r.finished_at,
        steps.filter((s) => s.outcome === "ok").length, steps.filter((s) => s.outcome === "fail").length,
        iss.length, iss.filter((i) => i.blocking).length,
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
        .map((t, i) => {
          const v = checkValue(checks, i, t);
          return `${v === undefined ? "?" : v ? "sí" : "no"}: ${t}`;
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

  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="apphouse-qa-${kind}-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
