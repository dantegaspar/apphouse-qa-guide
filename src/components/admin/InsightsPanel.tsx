import { groupInsights, SEVERITY_LABEL, type Insight, type InsightSeverity } from "@/lib/insights";
import { ExportButton } from "@/components/admin/ExportButton";

/** «Resumen automático»: frases calculadas con los datos, agrupadas por tema (componente de servidor). */

const CHIP: Record<InsightSeverity, string> = {
  critical: "bg-red-600 text-white",
  warning: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300",
  ok: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  info: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
};
const COUNT_LABEL: Record<InsightSeverity, [string, string]> = {
  critical: ["crítico", "críticos"],
  warning: ["de atención", "de atención"],
  ok: ["bien", "bien"],
  info: ["dato", "datos"],
};

export function SeverityChip({ severity, className = "" }: { severity: InsightSeverity; className?: string }) {
  return (
    <span className={`inline-flex w-[4.75rem] shrink-0 justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${CHIP[severity]} ${className}`}>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function InsightsPanel({
  insights,
  exportQs = "",
  title = "Resumen automático",
}: {
  insights: Insight[];
  /** "?guide=…" para el botón de descarga (vacío = todas las guías). */
  exportQs?: string;
  title?: string;
}) {
  const groups = groupInsights(insights);
  const counts = (["critical", "warning", "ok"] as const).map((s) => [s, insights.filter((i) => i.severity === s).length] as const).filter(([, c]) => c);

  return (
    <section aria-labelledby="resumen-automatico" data-testid="insights" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="resumen-automatico" className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">Frases calculadas con los datos actuales, sin IA. Se actualizan con cada carga.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.map(([s, c]) => (
            <span key={s} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[s]}`}>
              {c} {COUNT_LABEL[s][c === 1 ? 0 : 1]}
            </span>
          ))}
          <ExportButton
            href={`/api/admin/export/insights${exportQs}`}
            label="CSV del resumen"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-[#2F5DA8] hover:bg-slate-50"
          >
            Descargar CSV
          </ExportButton>
        </div>
      </div>

      <details open className="group mt-3">
        <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-700">
          <span className="group-open:hidden">Mostrar las {insights.length} frases</span>
          <span className="hidden group-open:inline">Ocultar frases</span>
        </summary>
      <div className="mt-3 gap-3 lg:columns-2">
        {groups.map((g) => (
          <div key={g.id} className="mb-3 min-w-0 break-inside-avoid rounded-xl bg-slate-50/70 p-3 ring-1 ring-slate-200/70">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</h3>
            <ul className="space-y-2">
              {g.items.map((i) => (
                <li key={i.id} className="flex items-start gap-2.5 text-sm leading-snug text-slate-800">
                  {/* Escritorio: chip en su propia columna; teléfono: chip al inicio del texto */}
                  <SeverityChip severity={i.severity} className="mt-px max-sm:hidden" />
                  <span className="min-w-0">
                    <SeverityChip severity={i.severity} className="mr-1.5 !w-auto align-[1px] sm:hidden" />
                    {i.guide && <span className="mr-1.5 rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{i.guide}</span>}
                    {i.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      </details>
    </section>
  );
}
