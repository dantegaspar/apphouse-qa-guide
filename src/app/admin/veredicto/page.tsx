import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { fmtDate } from "@/lib/admin-data";
import { PRIORITIES, SEVERITIES, TRIAGE, type Severity } from "@/lib/types";
import { computeVerdict, THRESHOLDS, type Criterion } from "@/lib/verdict";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { AutoRefresh } from "@/components/admin/AutoRefresh";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);
const SEV_CLASS: Record<Severity, string> = {
  bloqueante: "bg-red-100 text-red-800",
  mayor: "bg-amber-100 text-amber-900",
  menor: "bg-slate-100 text-slate-700",
};

function CriteriaTable({ rows }: { rows: Criterion[] }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Criterio</th>
            <th className="px-3 py-2">Medición</th>
            <th className="px-3 py-2">Umbral</th>
            <th className="px-3 py-2">Cumple</th>
            <th className="px-3 py-2">Fundamento</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.label} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2 font-medium text-slate-900">{c.label}</td>
              <td className="px-3 py-2 text-slate-700">{c.measured}</td>
              <td className="px-3 py-2 text-slate-600">{c.threshold}</td>
              <td className="px-3 py-2">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${c.pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                  {c.pass ? "Sí" : "No"}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">{c.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function VerdictPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const v = computeVerdict();

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <AutoRefresh seconds={30} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-[#2F5DA8] hover:underline">← Volver al panel</Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">¿Listo para producción?</h1>
          <p className="text-sm text-slate-500">Calculado con los criterios de salida fijos · {fmtDate(v.generatedAt)}</p>
        </div>
        <LogoutButton />
      </header>

      <section
        data-testid="verdict"
        className={`rounded-2xl p-6 ring-1 ${v.ready ? "bg-emerald-50 ring-emerald-200" : "bg-red-50 ring-red-200"}`}
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`text-5xl font-bold ${v.ready ? "text-emerald-700" : "text-red-700"}`}>{v.ready ? "Sí" : "No"}</span>
          <span className="text-lg font-medium text-slate-800">
            {v.ready ? "El sistema cumple los criterios para pasar a producción." : "El sistema todavía no cumple los criterios para pasar a producción."}
          </span>
        </div>
        <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide text-slate-600">Por qué</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
          {v.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        {!v.ready && v.defects.some((d) => d.severity !== "menor") && (
          <p className="mt-3 text-sm text-slate-700">
            Para llegar al «Sí»: corregir las fallas bloqueantes y mayores de la lista de abajo, volver a probar esos casos y revisar
            cada falla (Confirmada, No es falla, Duplicada o Corregida).
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Criterios de salida</h2>
        <CriteriaTable rows={[...v.guides.flatMap((g) => g.criteria), ...(v.courier.criterion ? [v.courier.criterion] : [])]} />
        <p className="mt-2 text-xs text-slate-500">
          El veredicto es «Sí» solo si se cumplen todos. Las fallas sin revisar cuentan como vigentes. Una ejecución «bloqueada» cuenta como no
          aprobada porque no se demostró que el caso funciona.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Fallas vigentes ({v.defects.length})</h2>
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          {(Object.keys(SEVERITIES) as Severity[]).map((s) => (
            <span key={s} className={`rounded-lg px-3 py-1 ${SEV_CLASS[s]}`}>
              {SEVERITIES[s]}: {v.defectTotals[s].open} vigentes · {v.defectTotals[s].closed} cerradas
            </span>
          ))}
        </div>
        {v.defects.length === 0 ? (
          <p className="text-sm text-slate-500">Sin fallas vigentes.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Gravedad</th>
                  <th className="px-3 py-2">Caso</th>
                  <th className="px-3 py-2">Prioridad</th>
                  <th className="px-3 py-2">Qué pasó</th>
                  <th className="px-3 py-2">Revisión</th>
                  <th className="px-3 py-2">Tester</th>
                </tr>
              </thead>
              <tbody>
                {v.defects.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEV_CLASS[d.severity]}`}>{SEVERITIES[d.severity]}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap">{d.activityId} {d.activityTitle}</td>
                    <td className="px-3 py-2">{PRIORITIES[d.priority]}</td>
                    <td className="px-3 py-2 text-slate-700">{d.description}</td>
                    <td className="px-3 py-2 text-xs">{TRIAGE[d.triage as keyof typeof TRIAGE] ?? d.triage}</td>
                    <td className="px-3 py-2"><Link className="text-[#2F5DA8] hover:underline" href={`/admin/runs/${d.runId}`}>{d.tester}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">Cambia la gravedad o la revisión de cada falla en la página del tester o en «Reportes recientes».</p>
      </section>

      {v.guides.map((g) => (
        <section key={g.guide.id}>
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Casos de prueba · {g.guide.title}</h2>
          <p className="mb-3 text-sm text-slate-500">
            {g.testers} testers · {g.finished} terminaron · encuesta: {g.survey.n} respuestas
            {g.survey.sus !== null ? `, SUS equivalente ${Math.round(g.survey.sus)} (UMUX-Lite ${Math.round(g.survey.umux!)})` : ""}
          </p>
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Caso</th>
                  <th className="px-3 py-2">Prioridad</th>
                  <th className="px-3 py-2">Calidad (ISO/IEC 25010:2023)</th>
                  <th className="px-3 py-2 text-right">Ejec.</th>
                  <th className="px-3 py-2 text-right">Pasa</th>
                  <th className="px-3 py-2 text-right">Falla</th>
                  <th className="px-3 py-2 text-right">Bloq.</th>
                  <th className="px-3 py-2 text-right">Aprobación</th>
                  <th className="px-3 py-2">IC 95 %</th>
                  <th className="px-3 py-2 text-right">Min (real / est.)</th>
                </tr>
              </thead>
              <tbody>
                {g.cases.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2"><span className="font-medium">{c.id}</span> {c.title}</td>
                    <td className="px-3 py-2">{PRIORITIES[c.priority]}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{c.quality}</td>
                    <td className="px-3 py-2 text-right">{c.executed}</td>
                    <td className="px-3 py-2 text-right">{c.passed}{c.passedWithNotes ? <span className="text-xs text-slate-500"> ({c.passedWithNotes} con obs.)</span> : null}</td>
                    <td className="px-3 py-2 text-right">{c.failed}</td>
                    <td className="px-3 py-2 text-right">{c.blocked}</td>
                    <td className={`px-3 py-2 text-right font-medium ${c.passRate === null ? "text-slate-400" : c.passRate >= THRESHOLDS.overallPassRate ? "text-emerald-700" : "text-red-700"}`}>{pct(c.passRate)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{c.ci ? `${pct(c.ci[0])}–${pct(c.ci[1])}` : "—"}</td>
                    <td className={`px-3 py-2 text-right ${c.slow ? "font-semibold text-amber-700" : ""}`}>
                      {c.medianMin === null ? "—" : Math.max(1, Math.round(c.medianMin))} / {c.estMin ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="rounded-xl bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Metodología</h2>
        <p>
          <strong>Pruebas de aceptación de usuario basadas en riesgo</strong> (ISO/IEC/IEEE 29119-2:2021 y 29119-3:2021; vocabulario del Glosario ISTQB v4 y el programa CTFL v4.0). Cada actividad de la
          guía es un caso de prueba con prioridad según el riesgo para el negocio: <em>Crítica</em> (pedidos y dinero), <em>Alta</em> (lo que ve el
          cliente), <em>Media</em> y <em>Baja</em> (consulta). Cada ejecución termina en un veredicto: pasa, falla, bloqueada o no ejecutada.
        </p>
        <p className="mt-2">
          Las fallas se clasifican por gravedad según IEEE 1044-2009: <strong>bloqueante</strong> (no se puede seguir), <strong>mayor</strong> (el flujo
          sigue pero el resultado está mal) y <strong>menor</strong> (texto o apariencia). Mesa de control revisa cada una; una ejecución con solo
          fallas menores pasa «con observaciones».
        </p>
        <p className="mt-2">
          La usabilidad se mide con ISO 9241-11:2018: <strong>efectividad</strong> (aprobación), <strong>eficiencia</strong> (minutos reales contra el
          estimado; informativo) y <strong>satisfacción</strong> (UMUX-Lite, 2 preguntas de 1 a 7, convertido a escala SUS, donde 68 es el promedio
          de referencia). Las tasas llevan intervalo de confianza del 95 % con Wald ajustado, adecuado para muestras pequeñas.
        </p>
        <p className="mt-2">
          Los criterios de salida se fijaron antes de la prueba y no se ajustan después: el veredicto es «Sí» solo si se cumplen todos.
        </p>
      </section>
    </main>
  );
}
