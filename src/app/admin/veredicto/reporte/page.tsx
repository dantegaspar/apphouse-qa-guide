import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fmtDate } from "@/lib/admin-data";
import { GUIDES } from "@/lib/guides";
import { BUG_TYPES, PRIORITIES, SEVERITIES, TRIAGE, type BugType, type Severity } from "@/lib/types";
import { computeVerdict, EXCLUSION_LABEL } from "@/lib/verdict";
import { latestDictamen, NORMAS, umbralesAprobacion } from "@/lib/claude-dictamen";
import { PrintButton } from "@/components/admin/PrintButton";
import { ExportButton } from "@/components/admin/ExportButton";

export const dynamic = "force-dynamic";

const ORIGIN_LABEL: Record<string, string> = { desarrollo: "Desarrollo", servidor: "Servidor", logistica: "Logística", tester: "Tester" };
const CLOSED = ["no_es_falla", "externa", "tester", "duplicada", "corregida"];
const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const TH = "border border-slate-300 px-2 py-1 text-left align-top";

type ClosedRow = {
  id: string;
  activity_id: string;
  severity: string;
  triage: string;
  triage_note: string;
  triage_at: string | null;
  bug_type: string;
  description: string;
  run_id: string;
  name: string;
  guide_id: string;
};

/** Hallazgos que Mesa o Claude cerraron (no cuentan como falla abierta), con su motivo. */
function closedFindings(): ClosedRow[] {
  try {
    return getDb()
      .prepare(
        `SELECT i.id, i.activity_id, i.severity, i.triage, i.triage_note, i.triage_at, i.bug_type, i.description, i.run_id, r.name, r.guide_id
         FROM issues i JOIN runs r ON r.id = i.run_id
         WHERE i.kind = 'issue' AND i.triage IN (${CLOSED.map(() => "?").join(",")})
         ORDER BY i.activity_id, i.created_at`
      )
      .all(...CLOSED) as ClosedRow[];
  } catch {
    return [];
  }
}

const titleOf = (guideId: string, actId: string) => GUIDES.find((g) => g.id === guideId)?.activities.find((a) => a.id === actId)?.title ?? "";

/** Informe del veredicto para imprimir o guardar como PDF. */
export default async function VerdictReportPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const v = computeVerdict();
  const cd = latestDictamen();
  const closed = closedFindings();
  const criteria = [...v.criteria, ...v.guides.filter((g) => !g.guide.hidden).flatMap((g) => g.criteria), ...(v.courier.criterion ? [v.courier.criterion] : [])];

  return (
    <main className="mx-auto max-w-5xl space-y-6 bg-white p-6 text-sm text-slate-900 print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 14mm; } @media print { table { page-break-inside: auto; } tr { page-break-inside: avoid; } h2 { page-break-after: avoid; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/veredicto" className="text-sm text-[#2F5DA8] hover:underline">← Volver al veredicto</Link>
        <div className="flex gap-2">
          <ExportButton href="/api/admin/export/xlsx" label="Excel" className="rounded-lg px-4 py-2 text-sm font-semibold text-[#2F5DA8] ring-1 ring-[#2F5DA8] hover:bg-blue-50">
            Descargar Excel
          </ExportButton>
          <PrintButton />
        </div>
      </div>
      <p className="text-xs text-slate-500 print:hidden">«Descargar PDF» abre la impresión del navegador: elige «Guardar como PDF».</p>

      <header className="border-b border-slate-300 pb-3">
        <h1 className="text-2xl font-semibold">Informe del veredicto · AppHouse QA</h1>
        <p className="text-slate-600">¿Listo para producción? · Generado {fmtDate(v.generatedAt)}</p>
      </header>

      <section>
        <h2 className="text-lg font-semibold">Veredicto: {v.ready ? "Sí" : "No"}</h2>
        <p>{v.ready ? "El sistema cumple los criterios para pasar a producción." : "El sistema todavía no cumple los criterios para pasar a producción."}</p>
        <ul className="mt-1 list-disc pl-5">
          {v.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      {cd?.dictamen && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Dictamen según la especificación: ISO/IEC/IEEE 29119</h2>
          <p><strong>{cd.dictamen.veredicto}.</strong> {cd.dictamen.resumen}</p>
          {(cd.dictamen.veredicto === "Sí") !== v.ready && <p className="font-semibold text-amber-800">El dictamen no coincide con el cálculo fijo. Manda el cálculo fijo.</p>}
          <ul className="space-y-0.5">
            {cd.dictamen.criterios.map((c) => (
              <li key={c.criterio}>{c.cumple ? "✓" : "✗"} <strong>{c.criterio}:</strong> {c.comentario}</li>
            ))}
          </ul>
          <p>{cd.dictamen.justificacion29119}</p>
          <div>
            <strong>Errores por origen</strong>
            <ul className="list-disc pl-5">
              {Object.entries(cd.dictamen.erroresPorOrigen).map(([k, t]) => <li key={k}><strong>{ORIGIN_LABEL[k] ?? k}:</strong> {t}</li>)}
            </ul>
          </div>
          <div>
            <strong>Recomendaciones</strong>
            <ol className="list-decimal pl-5">{cd.dictamen.recomendaciones.map((r) => <li key={r}>{r}</li>)}</ol>
          </div>
          <p className="text-xs text-slate-500">Dictaminado {fmtDate(cd.created_at)} con {cd.model}.</p>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold">Base del cálculo</h2>
        <p>
          Cuentan {v.population.valid} de {v.population.total} pruebas. No cuentan {v.population.counts.sin_terminar} sin terminar,{" "}
          {v.population.counts.logistica} con problema de logística y {v.population.counts.mesa} excluidas por Mesa de control.
          {v.population.externalActs ? ` ${v.population.externalActs} actividades quedaron fuera por fallas ajenas al desarrollo o del tester.` : ""}
        </p>
        {v.population.excluded.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {v.population.excluded.map((e) => <li key={e.runId}>{e.name} · {EXCLUSION_LABEL[e.reason]}{e.detail ? `: ${e.detail}` : ""}</li>)}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Criterios de salida</h2>
        <table className="w-full border-collapse text-xs">
          <thead><tr><th className={TH}>Criterio</th><th className={TH}>Medición</th><th className={TH}>Umbral</th><th className={TH}>Cumple</th></tr></thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.label}><td className={TH}>{c.label}</td><td className={TH}>{c.measured}</td><td className={TH}>{c.threshold}</td><td className={TH}>{c.informative ? "Informativo" : c.pass ? "Sí" : "No"}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Resultados por actividad</h2>
        <table className="w-full border-collapse text-xs">
          <thead><tr><th className={TH}>Actividad</th><th className={TH}>Prioridad</th><th className={TH}>La hicieron</th><th className={TH}>Todo salió bien</th><th className={TH}>Con falla</th><th className={TH}>No pudo</th><th className={TH}>Críticos</th><th className={TH}>Cumple</th></tr></thead>
          <tbody>
            {v.activities.map((a) => (
              <tr key={a.id}>
                <td className={TH}>{a.id} {a.title}</td><td className={TH}>{PRIORITIES[a.priority]}</td><td className={TH}>{a.executed}</td><td className={TH}>{pct(a.okRate)}</td>
                <td className={TH}>{a.failed}</td><td className={TH}>{a.blocked}</td><td className={TH}>{a.openCritical}</td><td className={TH}>{a.meets === null ? "—" : a.meets ? "Sí" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-slate-600">Pedidos completados de punta a punta: {v.orders.completed} de {v.orders.total} ({pct(v.orders.rate)}).</p>
      </section>

      <section data-testid="report-closed">
        <h2 className="mb-1 text-lg font-semibold">Hallazgos reclasificados o cerrados ({closed.length})</h2>
        <p className="mb-1 text-xs text-slate-600">No cuentan como falla abierta. Se muestra la revisión de Mesa de control o de Claude y su motivo.</p>
        {closed.length === 0 ? <p className="text-slate-500">Ninguno.</p> : (
          <table className="w-full border-collapse text-xs">
            <thead><tr><th className={TH}>Actividad</th><th className={TH}>Severidad</th><th className={TH}>Qué pasó</th><th className={TH}>Revisión</th><th className={TH}>Motivo</th><th className={TH}>Participante</th></tr></thead>
            <tbody>
              {closed.map((i) => (
                <tr key={i.id}>
                  <td className={TH}>{i.activity_id} {titleOf(i.guide_id, i.activity_id)}</td>
                  <td className={TH}>{SEVERITIES[i.severity as Severity] ?? i.severity}</td>
                  <td className={TH}>{i.description}</td>
                  <td className={TH}>{TRIAGE[i.triage as keyof typeof TRIAGE] ?? i.triage}{i.bug_type ? ` · ${BUG_TYPES[i.bug_type as BugType] ?? i.bug_type}` : ""}</td>
                  <td className={TH}>{i.triage_note || "—"}{i.triage_at ? <span className="block text-slate-500">{fmtDate(i.triage_at)}</span> : null}</td>
                  <td className={TH}>{i.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Hallazgos abiertos ({v.defects.length})</h2>
        {v.defects.length === 0 ? <p className="text-slate-500">Ninguno.</p> : (
          <table className="w-full border-collapse text-xs">
            <thead><tr><th className={TH}>Actividad</th><th className={TH}>Severidad</th><th className={TH}>Tipo</th><th className={TH}>Qué pasó</th><th className={TH}>Revisión</th><th className={TH}>Participante</th></tr></thead>
            <tbody>
              {v.defects.map((d) => (
                <tr key={d.id}>
                  <td className={TH}>{d.activityId} {d.activityTitle}</td><td className={TH}>{SEVERITIES[d.severity]}</td><td className={TH}>{d.bugType ? BUG_TYPES[d.bugType] : "—"}</td>
                  <td className={TH}>{d.description}</td><td className={TH}>{TRIAGE[d.triage as keyof typeof TRIAGE] ?? d.triage}</td><td className={TH}>{d.tester}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="text-xs text-slate-600">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Bases</h2>
        <ul className="list-disc pl-5">{umbralesAprobacion().map((u) => <li key={u.criterio}>{u.criterio}: {u.umbral}</li>)}</ul>
        <ul className="mt-1 list-disc pl-5">{NORMAS.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>
    </main>
  );
}
