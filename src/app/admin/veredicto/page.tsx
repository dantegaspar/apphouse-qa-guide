import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { fmtDate } from "@/lib/admin-data";
import { PRIORITIES, SEVERITIES, SEVERITY_CLASS as SEV_CLASS, TRIAGE, type Severity } from "@/lib/types";
import { computeVerdict, EXCLUSION_LABEL, THRESHOLDS, type Criterion } from "@/lib/verdict";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { AutoRefresh } from "@/components/admin/AutoRefresh";

export const dynamic = "force-dynamic";

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const Met = ({ met }: { met: boolean | null }) => (
  <span
    className={`rounded px-2 py-0.5 text-xs font-semibold ${
      met === null ? "bg-slate-100 text-slate-600" : met ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
    }`}
  >
    {met === null ? "Pendiente" : met ? "Cumple" : "No cumple"}
  </span>
);
const TH = "px-3 py-2";

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
  const sevOpen = (s: Severity) => v.defectTotals[s].open;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <AutoRefresh seconds={30} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-[#2F5DA8] hover:underline">← Volver al panel</Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">¿Listo para producción?</h1>
          <p className="text-sm text-slate-500">Calculado con los criterios de salida fijos de los participantes · {fmtDate(v.generatedAt)}</p>
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
      </section>

      <section data-testid="population" className="rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-slate-900">Base del cálculo</h2>
        <p className="mt-1 text-slate-700">
          Cuentan <strong>{v.population.valid}</strong> de {v.population.total} pruebas: solo las completas (terminaron y enviaron la encuesta final).
          No cuentan {v.population.counts.sin_terminar} sin terminar o abandonadas, {v.population.counts.logistica} con problema de logística (sin
          repartidor asignado, sin comunicación con él, o el repartidor dejó de contestar o apareció sin conexión)
          {v.population.counts.mesa ? ` y ${v.population.counts.mesa} excluidas por Mesa de control` : ""}. Los hallazgos críticos cuentan de todas.
        </p>
        <p className="mt-1 text-slate-700">
          Solo se califica el desarrollo. Los reportes marcados «Ajena al desarrollo» (servidor, correo que no llega, red o logística, como un repartidor que deja de contestar o aparece sin conexión) no cuentan como falla
          {v.population.externalActs ? `, y ${v.population.externalActs} actividades donde pasó eso quedaron fuera del cálculo` : ""}.
        </p>
        {v.population.excluded.some((e) => e.reason !== "sin_terminar") && (
          <ul className="mt-2 space-y-1">
            {v.population.excluded
              .filter((e) => e.reason !== "sin_terminar")
              .map((e) => (
                <li key={e.runId} className="text-slate-600">
                  <Link href={`/admin/runs/${e.runId}`} className="font-medium text-[#2F5DA8] hover:underline">{e.name}</Link> · {EXCLUSION_LABEL[e.reason]}
                  {e.detail ? `: ${e.detail}` : ""}
                </li>
              ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Para incluir o excluir a alguien a mano, abre su prueba y usa «¿Cuenta para el veredicto?».</p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Criterios de salida</h2>
        <CriteriaTable rows={[...v.criteria, ...v.guides.filter((g) => !g.guide.hidden).flatMap((g) => g.criteria), ...(v.courier.criterion ? [v.courier.criterion] : [])]} />
        <p className="mt-2 text-xs text-slate-500">
          El veredicto es «Sí» solo si se cumplen todos. Solo cuentan los manuales, los reportes y las encuestas de clientes, establecimientos y
          repartidores. Los hallazgos sin revisar cuentan como abiertos.
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Resultados por actividad de los manuales</h2>
        <p className="mb-3 text-sm text-slate-500">
          Una actividad cumple si al menos {Math.round(THRESHOLDS.activityOk * 100)} % de quienes la hicieron marcaron «Todo salió bien» y no tiene
          hallazgos críticos abiertos. «La hicieron» no incluye «No me tocó»; «No pude hacerla» cuenta como no aprobada. El establecimiento junta
          panel web y app.
        </p>
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm" data-testid="activity-results">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className={TH}>Actividad</th>
                <th className={TH}>Prioridad</th>
                <th className={`${TH} text-right`}>La hicieron</th>
                <th className={`${TH} text-right`}>Todo salió bien</th>
                <th className={TH}>IC 95 %</th>
                <th className={`${TH} text-right`}>Con falla</th>
                <th className={`${TH} text-right`}>No pudo</th>
                <th className={`${TH} text-right`}>Críticos</th>
                <th className={TH}>Resultado</th>
                <th className={`${TH} text-right`}>Min (real / est.)</th>
              </tr>
            </thead>
            <tbody>
              {v.activities.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className={TH}><span className="font-medium">{a.id}</span> {a.title}</td>
                  <td className={TH}>{PRIORITIES[a.priority]}</td>
                  <td className={`${TH} text-right`}>{a.executed}</td>
                  <td className={`${TH} text-right font-medium`}>{pct(a.okRate)}</td>
                  <td className={`${TH} text-xs text-slate-500`}>{a.ci && a.executed ? `${pct(a.ci[0])}–${pct(a.ci[1])}` : "—"}</td>
                  <td className={`${TH} text-right`}>{a.failed}</td>
                  <td className={`${TH} text-right`}>{a.blocked}</td>
                  <td className={`${TH} text-right ${a.openCritical ? "font-semibold text-red-700" : ""}`}>{a.openCritical}</td>
                  <td className={TH}><Met met={a.meets} /></td>
                  <td className={`${TH} text-right ${a.slow ? "font-semibold text-amber-700" : ""}`}>
                    {a.medianMin === null ? "—" : Math.max(1, Math.round(a.medianMin))} / {a.estMin ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Medidas de la prueba combinada</h2>
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-slate-100"><td className={`${TH} text-slate-600`}>Participantes que operaron (clientes / establecimientos)</td><td className={`${TH} font-medium`}>{v.participants.clientes} / {v.participants.establecimientos}</td></tr>
              <tr className="border-b border-slate-100"><td className={`${TH} text-slate-600`}>Pedidos en la Hoja de pedidos (sin contar rechazos y cancelaciones a propósito)</td><td className={`${TH} font-medium`}>{v.orders.total} (+{v.orders.intentional} rechazados o cancelados)</td></tr>
              <tr className="border-b border-slate-100"><td className={`${TH} text-slate-600`}>Pedidos completados de punta a punta</td><td className={`${TH} font-medium`}>{pct(v.orders.rate)}</td></tr>
              <tr><td className={`${TH} text-slate-600`}>Hallazgos abiertos (críticos / altos / medios / bajos)</td><td className={`${TH} font-medium`}>{sevOpen("critico")} / {sevOpen("alto")} / {sevOpen("medio")} / {sevOpen("bajo")}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Hallazgos abiertos ({v.defects.length})</h2>
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          {(Object.keys(SEVERITIES) as Severity[]).map((s) => (
            <span key={s} className={`rounded-lg px-3 py-1 ${SEV_CLASS[s]}`}>
              {SEVERITIES[s]}: {v.defectTotals[s].open} abiertos · {v.defectTotals[s].closed} cerrados
            </span>
          ))}
        </div>
        {v.defects.length === 0 ? (
          <p className="text-sm text-slate-500">Sin hallazgos abiertos.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={TH}>Severidad</th>
                  <th className={TH}>Actividad</th>
                  <th className={TH}>Prioridad</th>
                  <th className={TH}>Qué pasó</th>
                  <th className={TH}>Revisión</th>
                  <th className={TH}>Participante</th>
                </tr>
              </thead>
              <tbody>
                {v.defects.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 align-top">
                    <td className={TH}><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEV_CLASS[d.severity]}`}>{SEVERITIES[d.severity]}</span></td>
                    <td className={`${TH} whitespace-nowrap`}>{d.activityId} {d.activityTitle}</td>
                    <td className={TH}>{PRIORITIES[d.priority]}</td>
                    <td className={`${TH} text-slate-700`}>{d.description}</td>
                    <td className={`${TH} text-xs`}>{TRIAGE[d.triage as keyof typeof TRIAGE] ?? d.triage}</td>
                    <td className={TH}><Link className="text-[#2F5DA8] hover:underline" href={`/admin/runs/${d.runId}`}>{d.tester}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Cambia la severidad o la revisión en la página del participante o en «Reportes recientes». «Crítico» lo asigna Mesa de control: pedidos o
          cobros perdidos o duplicados, datos expuestos o una vulnerabilidad grave.
        </p>
      </section>

      <section className="rounded-xl bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Metodología</h2>
        <p>
          <strong>Pruebas de aceptación de usuario basadas en riesgo</strong> (ISO/IEC/IEEE 29119-2:2021 y 29119-3:2021). Cada actividad de los manuales es un caso de prueba con prioridad según el riesgo para el negocio:{" "}
          <em>Crítica</em> (pedidos y dinero), <em>Alta</em> (lo que ve el cliente), <em>Media</em> y <em>Baja</em>.
        </p>
        <p className="mt-2">
          Del Plan de pruebas y el Informe de resultados se toman los criterios que miden los participantes: pedidos completados de punta a punta
          (≥ {Math.round(THRESHOLDS.endToEnd * 100)} %), ningún hallazgo crítico abierto y, por actividad, al menos{" "}
          {Math.round(THRESHOLDS.activityOk * 100)} % de «Todo salió bien». Los hallazgos usan su severidad: <strong>crítico</strong> (pedidos o
          cobros perdidos o duplicados, datos expuestos; lo asigna Mesa de control), <strong>alto</strong> (no se puede seguir),{" "}
          <strong>medio</strong> (el flujo sigue pero el resultado está mal) y <strong>bajo</strong> (texto o apariencia).
        </p>
        <p className="mt-2">
          Las encuestas miden la satisfacción con ISO 9241-11:2018: clientes y establecimientos con UMUX-Lite (2 preguntas de 1 a 7, convertido a
          escala SUS, donde 68 es el promedio de referencia) y repartidores con caritas de 1 a 5 llevadas a 0–100. Las tasas llevan intervalo de
          confianza del 95 % con Wald ajustado.
        </p>
        <p className="mt-2">
          Todos los porcentajes se calculan solo con las pruebas completas: no cuentan quienes abandonaron o no terminaron, ni quienes tuvieron un
          problema de logística (no les asignaron repartidor, no pudieron comunicarse con él, o dejó de contestar y apareció sin conexión), según su encuesta o la decisión de Mesa de control.
          La prueba califica únicamente el desarrollo: las fallas de servidor, de correo, de red o de logística ajenas al equipo de desarrollo se marcan «Ajena al desarrollo» y no cuentan ni
          como falla ni como actividad ejecutada; lo mismo con las encuestas de repartidores que no pudieron entrar por esas causas.
        </p>
        <p className="mt-2">Los criterios de salida se fijaron antes de la prueba y no se ajustan después: el veredicto es «Sí» solo si se cumplen todos.</p>
      </section>
    </main>
  );
}
