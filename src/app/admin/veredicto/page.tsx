import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { fmtDate } from "@/lib/admin-data";
import { PRIORITIES, SEVERITIES, SEVERITY_CLASS as SEV_CLASS, TRIAGE, type Severity } from "@/lib/types";
import { computeVerdict, DICTAMEN_LABEL, THRESHOLDS, type Criterion } from "@/lib/verdict";
import CriterionEditor from "@/components/admin/CriterionEditor";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { AutoRefresh } from "@/components/admin/AutoRefresh";

export const dynamic = "force-dynamic";

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const DICT_CLASS = {
  aprobado: { box: "bg-emerald-50 ring-emerald-200", text: "text-emerald-700" },
  observaciones: { box: "bg-amber-50 ring-amber-200", text: "text-amber-700" },
  no_aprobado: { box: "bg-red-50 ring-red-200", text: "text-red-700" },
} as const;
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
  const dc = DICT_CLASS[v.dictamen];
  const sevOpen = (s: Severity) => v.defectTotals[s].open;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <AutoRefresh seconds={30} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-[#2F5DA8] hover:underline">← Volver al panel</Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">¿Lista para publicar?</h1>
          <p className="text-sm text-slate-500">
            Dictamen con los criterios de finalización del Plan de pruebas (sección 7.5) · formato del Informe de resultados · {fmtDate(v.generatedAt)}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section data-testid="verdict" className={`rounded-2xl p-6 ring-1 ${dc.box}`}>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`text-4xl font-bold ${dc.text}`}>{DICTAMEN_LABEL[v.dictamen]}</span>
          {v.provisional && <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300">Provisional: faltan criterios por capturar</span>}
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white/70 p-3 ring-1 ring-slate-200">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Calificación final</dt>
            <dd className="text-2xl font-semibold text-slate-900" data-testid="score">{v.score} %</dd>
            <dd className="text-xs text-slate-500">mínimo {THRESHOLDS.scorePass} % (con observaciones: {THRESHOLDS.scoreObs}–{THRESHOLDS.scorePass - 1} %)</dd>
          </div>
          <div className="rounded-xl bg-white/70 p-3 ring-1 ring-slate-200">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Criterios críticos cumplidos</dt>
            <dd className="text-2xl font-semibold text-slate-900">{v.criticalMet} de {v.plan.filter((c) => c.critical).length}</dd>
            <dd className="text-xs text-slate-500">1, 2 y 13; todos son obligatorios</dd>
          </div>
          <div className="rounded-xl bg-white/70 p-3 ring-1 ring-slate-200">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Hallazgos críticos abiertos</dt>
            <dd className="text-2xl font-semibold text-slate-900">{v.openCritical}</dd>
            <dd className="text-xs text-slate-500">debe ser 0</dd>
          </div>
        </dl>
        <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide text-slate-600">Por qué</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
          {v.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Evaluación de los criterios de finalización</h2>
        <p className="mb-3 text-sm text-slate-500">
          Cada criterio cumplido suma su peso completo; uno no cumplido o sin dato suma cero. El 1 se calcula con la Hoja de pedidos de los
          establecimientos; los demás salen de los bots, el servidor y las pruebas de seguridad, y se capturan aquí.
        </p>
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm" data-testid="plan-criteria">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>Criterio</th>
                <th className={TH}>Meta</th>
                <th className={`${TH} text-right`}>Peso</th>
                <th className={TH}>Preliminar (bots, 20/11)</th>
                <th className={TH}>Medido (24/11)</th>
                <th className={TH}>Resultado</th>
                <th className={`${TH} text-right`}>Puntos</th>
              </tr>
            </thead>
            <tbody>
              {v.plan.map((c) => (
                <tr key={c.n} className="border-t border-slate-100 align-top">
                  <td className={`${TH} font-medium`}>{c.n}</td>
                  <td className={TH}>
                    <span className="font-medium text-slate-900">{c.label}</span>
                    {c.critical && <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-800">Crítico</span>}
                  </td>
                  <td className={`${TH} whitespace-nowrap text-slate-600`}>{c.goal}</td>
                  <td className={`${TH} text-right`}>{c.weight}</td>
                  <td className={`${TH} text-xs text-slate-500`}>{c.prelim}</td>
                  <td className={`${TH} text-slate-700`}>
                    {c.measured || <span className="text-slate-400">—</span>}
                    {c.hint && <p className="mt-1 text-xs text-slate-500">{c.hint}</p>}
                    <div className="mt-1"><CriterionEditor n={c.n} measured={c.measured} met={c.met} auto={c.n === 1 && c.source !== "mesa"} /></div>
                  </td>
                  <td className={TH}>
                    <Met met={c.met} />
                    {c.source !== "pendiente" && <p className="mt-1 text-[11px] text-slate-500">{c.source === "manuales" ? "de los manuales" : "capturado"}</p>}
                  </td>
                  <td className={`${TH} text-right font-medium`}>{c.met ? c.weight : 0}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className={TH} colSpan={3}>Calificación final</td>
                <td className={`${TH} text-right`}>100</td>
                <td className={TH} colSpan={3} />
                <td className={`${TH} text-right`}>{v.score}</td>
              </tr>
            </tbody>
          </table>
        </div>
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
        <p className="mt-2 text-xs text-slate-500">Los tiempos de respuesta de la API (p95 y p99) salen de los bots: captúralos en los criterios 3 y 4.</p>
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

      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Indicadores complementarios de usabilidad</h2>
        <p className="mb-3 text-sm text-slate-500">No cambian el dictamen: ayudan a explicar por qué una actividad falló.</p>
        <CriteriaTable rows={[...v.guides.flatMap((g) => g.criteria), ...(v.courier.criterion ? [v.courier.criterion] : [])]} />
      </section>

      <section className="rounded-xl bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Metodología</h2>
        <p>
          Proceso y documentación según <strong>ISO/IEC/IEEE 29119-1:2022</strong> (conceptos y pruebas basadas en riesgo),{" "}
          <strong>29119-2:2021</strong> (procesos), <strong>29119-3:2021</strong> (este dictamen sigue el reporte de finalización de pruebas) y{" "}
          <strong>29119-4:2021</strong> (técnicas de los manuales: escenarios, valores límite, partición de equivalencia y transición de estados).
          Seguridad: <strong>OWASP WSTG 4.2</strong> (Web y API) y <strong>OWASP MASVS 2.1.0</strong> (apps móviles), criterio 13.
        </p>
        <p className="mt-2">
          Los 13 criterios, sus pesos y los críticos son los de la sección 7.5 del Plan, fijados antes de la prueba. Lista para publicar: puntaje
          ≥ {THRESHOLDS.scorePass} %, los 3 críticos cumplidos y ningún hallazgo crítico abierto. Con observaciones: {THRESHOLDS.scoreObs}–
          {THRESHOLDS.scorePass - 1} % con lo demás igual (se corrige y se repite solo lo fallido). Si no, no está lista (se corrige y se repite todo).
        </p>
        <p className="mt-2">
          Cada actividad de los manuales es un caso de prueba con prioridad por riesgo. Los hallazgos usan la severidad del Plan (crítico, alto,
          medio y bajo) y Mesa de control revisa cada uno; los no revisados cuentan como abiertos.
        </p>
        <p className="mt-2">
          Complementario: usabilidad con ISO 9241-11:2018 (efectividad, eficiencia en minutos y satisfacción con UMUX-Lite convertido a escala SUS,
          68 = promedio). Las tasas llevan intervalo de confianza del 95 % con Wald ajustado.
        </p>
      </section>
    </main>
  );
}
