import { viewRound } from "@/lib/rounds";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { fmtDate } from "@/lib/admin-data";
import { BUG_TYPE_HINT, BUG_TYPES, PRIORITIES, SEVERITIES, SEVERITY_CLASS as SEV_CLASS, TRIAGE, type Severity } from "@/lib/types";
import { computeVerdict, EXCLUSION_LABEL, loadCriticalFindings, THRESHOLDS, type Criterion } from "@/lib/verdict";
import { CriticalReview } from "@/components/admin/CriticalReview";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import ClaudeDictamenButton from "@/components/admin/ClaudeDictamenButton";
import { PlainSummaryView } from "@/components/admin/PlainSummary";
import { loadPlainSummary } from "@/lib/plain-summary";
import type { ActivityRow, Verdict } from "@/lib/verdict";
import { dictamenGate, latestDictamen, NORMAS, umbralesAprobacion } from "@/lib/claude-dictamen";

const ORIGIN_LABEL: Record<string, string> = { desarrollo: "Desarrollo", servidor: "Servidor", logistica: "Logística", tester: "Tester" };

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
                {c.informative ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Informativo</span>
                ) : (
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${c.pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                    {c.pass ? "Sí" : "No"}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">{c.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTable({ rows, testId }: { rows: ActivityRow[]; testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full text-sm" data-testid={testId}>
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
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-slate-100">
              <td className={TH}><span className="font-mono text-xs text-slate-500">{a.id}</span> {a.title}</td>
              <td className={TH}>{PRIORITIES[a.priority]}</td>
              <td className={`${TH} text-right tabular-nums`}>{a.executed}</td>
              <td className={`${TH} text-right font-medium tabular-nums`}>{pct(a.okRate)}</td>
              <td className={`${TH} text-xs text-slate-500`}>{a.ci && a.executed ? `${pct(a.ci[0])}–${pct(a.ci[1])}` : "—"}</td>
              <td className={`${TH} text-right tabular-nums`}>{a.failed}</td>
              <td className={`${TH} text-right tabular-nums`}>{a.blocked}</td>
              <td className={`${TH} text-right tabular-nums ${a.openCritical ? "font-semibold text-red-700" : ""}`}>{a.openCritical}</td>
              <td className={TH}><Met met={a.meets} /></td>
              <td className={`${TH} text-right tabular-nums ${a.slow ? "font-semibold text-amber-700" : ""}`}>
                {a.medianMin === null ? "—" : Math.max(1, Math.round(a.medianMin))} / {a.estMin ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Encabezado de sección de «Para Sistemas», con ancla para el índice. */
function Sec({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {note && <p className="text-sm text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const SYS_NAV = [
  ["sys-revision", "Revisión previa"],
  ["sys-criterios", "Criterios de salida"],
  ["sys-dictamen", "Dictamen 29119"],
  ["sys-actividades", "Actividades"],
  ["sys-pedidos", "Pedidos"],
  ["sys-hallazgos", "Hallazgos"],
  ["sys-tipos", "Tipos de bug"],
  ["sys-base", "Base del cálculo"],
  ["sys-metodologia", "Metodología"],
] as const;

export default async function VerdictPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { vista } = await searchParams;
  const sistemas = vista === "sistemas";
  const v = computeVerdict();
  const cd = latestDictamen();
  const gate = dictamenGate();
  const critical = loadCriticalFindings();
  const undecided = critical.filter((f) => !f.decision).length;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <AutoRefresh seconds={30} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-[#2F5DA8] hover:underline">← Volver al panel</Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Resultados de la prueba</h1>
          <p className="text-sm text-slate-500">{viewRound().name} · Actualizado {fmtDate(v.generatedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!gate.needed && (
            <Link href="/admin/veredicto/reporte" className="rounded-lg bg-[#2F5DA8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264d8c]">
              Descargar informe
            </Link>
          )}
          <LogoutButton />
        </div>
      </header>

      <nav aria-label="Vista" className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["", "Resumen", "Para todo el personal"],
            ["sistemas", "Para Sistemas", "Detalle técnico"],
          ] as const
        ).map(([id, label, hint]) => {
          const on = (id === "sistemas") === sistemas;
          return (
            <Link
              key={id}
              href={id ? `/admin/veredicto?vista=${id}` : "/admin/veredicto"}
              aria-current={on ? "page" : undefined}
              className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm ${
                on ? "border-[#2F5DA8] font-semibold text-[#2F5DA8]" : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {label} <span className="hidden text-xs font-normal text-slate-400 sm:inline">· {hint}</span>
            </Link>
          );
        })}
      </nav>

      {!sistemas ? (
        gate.needed ? (
          <section data-testid="summary-pending" className="rounded-2xl bg-slate-50 p-6 text-slate-700 ring-1 ring-slate-200">
            <h2 className="text-xl font-semibold text-slate-900">El resultado todavía se está revisando</h2>
            <p className="mt-2 text-sm">
              Antes de mostrar el resultado, el área de Sistemas revisa los reportes para separar las fallas de la app de las que no lo son (servidor, red,
              logística). Cuando termine, aquí aparece el resumen.
            </p>
            <Link href="/admin/veredicto?vista=sistemas" className="mt-3 inline-block text-sm font-medium text-[#2F5DA8] hover:underline">
              Ir a «Para Sistemas» para revisarlos →
            </Link>
          </section>
        ) : (
          <>
            {undecided > 0 && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                Hay {undecided} {undecided === 1 ? "problema grave" : "problemas graves"} por confirmar. El resultado puede cambiar cuando Sistemas los revise{" "}
                (<Link href="/admin/veredicto?vista=sistemas#sys-revision" className="font-medium underline">revisar</Link>).
              </p>
            )}
            <PlainSummaryView s={loadPlainSummary(v)} sistemasHref="/admin/veredicto?vista=sistemas#sys-actividades" />
          </>
        )
      ) : (
        <SystemsView v={v} cd={cd} gate={gate} critical={critical} />
      )}
    </main>
  );
}

function SystemsView({
  v,
  cd,
  gate,
  critical,
}: {
  v: Verdict;
  cd: ReturnType<typeof latestDictamen>;
  gate: ReturnType<typeof dictamenGate>;
  critical: ReturnType<typeof loadCriticalFindings>;
}) {
  const sevOpen = (s: Severity) => v.defectTotals[s].open;
  const originCount = (o: string) => cd?.classification?.reportes.filter((r) => r.origen === o).length ?? 0;
  const allCriteria = [...v.criteria, ...v.guides.filter((g) => !g.guide.hidden).flatMap((g) => g.criteria), ...(v.courier.criterion ? [v.courier.criterion] : [])];
  const cli = v.activities.filter((a) => a.id.startsWith("C"));
  const est = v.activities.filter((a) => a.id.startsWith("E"));

  return (
    <div className="space-y-10">
      {!gate.keyOk && <p className="text-xs text-amber-800">Sin ANTHROPIC_API_KEY en el .env del servidor: se muestra el veredicto sin procesar los reportes con Claude.</p>}

      {!gate.needed && (
        <nav aria-label="Secciones" className="flex flex-wrap gap-2 text-sm">
          {SYS_NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full bg-white px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              {label}
            </a>
          ))}
        </nav>
      )}

      <div id="sys-revision" className="scroll-mt-4 space-y-4">
        <CriticalReview findings={critical} />

        {gate.needed && (
          <section data-testid="claude-gate" className="rounded-2xl bg-white p-6 text-sm shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-semibold text-slate-900">Primero: procesar los reportes con Claude</h2>
            <p className="mt-2 text-slate-700">
              Antes de ver el veredicto, Claude ayuda a procesar los reportes y los clasifica: <strong>desarrollo, servidor, logística o tester</strong>.
              Lo que no es del desarrollo se cierra y sale del cálculo. Con los resultados ya limpios se revisan los criterios fijos (ISO/IEC/IEEE 29119-2 y
              29119-3:2021) y aparece el dictamen según la especificación ISO/IEC/IEEE 29119.
            </p>
            <p className="mt-3 text-slate-800">
              Por procesar: <strong>{gate.pendingReports}</strong> reportes sin revisar · <strong>{gate.untypedBugs}</strong> bugs confirmados sin tipo · <strong>{gate.newOrders}</strong> pruebas con pedidos
              fallados nuevos · <strong>{gate.newCourier}</strong> problemas de repartidores nuevos
            </p>
            <div className="mt-4">
              <ClaudeDictamenButton />
            </div>
            {cd?.error && <p className="mt-3 text-red-700">El último intento no se completó: {cd.error}</p>}
            <p className="mt-3 text-xs text-slate-500">
              Tarda de 1 a 3 minutos. A Claude no se le mandan nombres, correos ni teléfonos. Lo que Mesa ya revisó no se toca.
            </p>
          </section>
        )}
      </div>

      {!gate.needed && (
        <>
          <Sec id="sys-criterios" title="Criterios de salida" note="Fijados antes de la prueba (ISO/IEC/IEEE 29119-2:2021). El veredicto es «Sí» solo si se cumplen todos los que deciden.">
            <div
              data-testid="verdict-tech"
              className={`rounded-xl p-4 text-sm ring-1 ${v.ready ? "bg-emerald-50 ring-emerald-200" : "bg-red-50 ring-red-200"}`}
            >
              <p className="font-semibold text-slate-900">
                Cálculo fijo: <span className={v.ready ? "text-emerald-700" : "text-red-700"}>{v.ready ? "Sí" : "No"}</span>
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-800">
                {v.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
            <CriteriaTable rows={allCriteria} />
            <p className="text-xs text-slate-500">
              La satisfacción de repartidores es solo informativa: al ser una medida de percepción, ambigua para medir el desarrollo, no pesa en el
              veredicto. Los hallazgos sin revisar cuentan como abiertos.
            </p>
          </Sec>

          <Sec id="sys-dictamen" title="Dictamen según la especificación: ISO/IEC/IEEE 29119">
            {cd?.dictamen ? (
              <div data-testid="claude-result" className="space-y-3 rounded-xl bg-white p-4 text-sm text-slate-800 shadow-sm ring-1 ring-slate-200">
                <p>
                  <strong>{cd.dictamen.veredicto}.</strong> {cd.dictamen.resumen}
                </p>
                {(cd.dictamen.veredicto === "Sí") !== v.ready && (
                  <p className="rounded-lg bg-amber-50 p-2 text-amber-900 ring-1 ring-amber-200">
                    El dictamen no coincide con el cálculo fijo. Manda el cálculo fijo; vuelve a procesar con Claude para actualizar el dictamen.
                  </p>
                )}
                {(cd.dictamen.veredicto === "Sí") !== v.ready && gate.keyOk && (
                  <div className="py-1">
                    <ClaudeDictamenButton />
                  </div>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-1 font-semibold text-slate-900">Criterios</h3>
                    <ul className="space-y-1">
                      {cd.dictamen.criterios.map((c) => (
                        <li key={c.criterio}>
                          <span className={c.cumple ? "text-emerald-700" : "text-red-700"}>{c.cumple ? "✓" : "✗"}</span> <strong>{c.criterio}:</strong> {c.comentario}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <h3 className="mb-1 font-semibold text-slate-900">Errores por origen</h3>
                      <p className="text-xs text-slate-500">
                        Reportes: {["desarrollo", "servidor", "logistica", "tester"].map((o) => `${ORIGIN_LABEL[o]} ${originCount(o)}`).join(" · ")}
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {Object.entries(cd.dictamen.erroresPorOrigen).map(([k, t]) => (
                          <li key={k}>
                            <strong>{ORIGIN_LABEL[k] ?? k}:</strong> {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-1 font-semibold text-slate-900">Recomendaciones</h3>
                      <ol className="list-decimal space-y-0.5 pl-5">
                        {cd.dictamen.recomendaciones.map((r) => <li key={r}>{r}</li>)}
                      </ol>
                    </div>
                  </div>
                </div>
                <p>{cd.dictamen.justificacion29119}</p>
                <details data-testid="claude-bases" className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  <summary className="cursor-pointer font-semibold">Bases del dictamen</summary>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Porcentajes y umbrales de aprobación</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                    {umbralesAprobacion().map((u) => (
                      <li key={u.criterio}>
                        {u.criterio}: <strong>{u.umbral}</strong>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Normas y versiones</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                    {NORMAS.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </details>
                <p className="text-xs text-slate-500">
                  Dictaminado {fmtDate(cd.created_at)} con {cd.model} · {cd.applied?.reportes ?? 0} reportes clasificados ·{" "}
                  {cd.applied?.pedidosAjenos ?? 0} pedidos fallados ajenos{cd.costUsd != null ? ` · costo ≈ USD ${cd.costUsd.toFixed(2)}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Todavía no hay dictamen procesado con Claude.</p>
            )}
            {gate.keyOk && (
              <div data-testid="reclasificar" className="rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
                <h3 className="text-base font-semibold text-slate-900">Reclasificar con las reglas de las especificaciones</h3>
                <p className="mt-1 text-slate-700">
                  Claude vuelve a revisar los reportes que clasificó antes y los confirmados sin nota, con las reglas de los requerimientos
                  (cancelación, menú de la marca, datos capturados por la sucursal, invitado, código de entrega). Lo que no es falla del
                  desarrollo deja de contar en su actividad. Lo que Mesa decidió con una nota no se toca.
                </p>
                <div className="mt-3">
                  <ClaudeDictamenButton reclasificar label="Reclasificar con Claude" />
                </div>
              </div>
            )}
          </Sec>

          <Sec
            id="sys-actividades"
            title="Resultados por actividad de los manuales"
            note={`Una actividad cumple si al menos ${Math.round(THRESHOLDS.activityOk * 100)} % de quienes la hicieron marcaron «Todo salió bien» y no tiene hallazgos críticos abiertos. «La hicieron» no incluye «No me tocó»; «No pude hacerla» cuenta como no aprobada. El establecimiento junta panel web y app.`}
          >
            <div data-testid="activity-results" className="space-y-4">
              {cli.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Clientes · {cli.filter((a) => a.meets).length} de {cli.filter((a) => a.meets !== null).length} cumplen</h3>
                  <ActivityTable rows={cli} />
                </div>
              )}
              {est.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Establecimientos · {est.filter((a) => a.meets).length} de {est.filter((a) => a.meets !== null).length} cumplen</h3>
                  <ActivityTable rows={est} />
                </div>
              )}
            </div>
          </Sec>

          <Sec id="sys-pedidos" title="Medidas de la prueba combinada">
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-slate-100"><td className={`${TH} text-slate-600`}>Participantes que operaron (clientes / establecimientos)</td><td className={`${TH} font-medium`}>{v.participants.clientes} / {v.participants.establecimientos}</td></tr>
                  <tr className="border-b border-slate-100"><td className={`${TH} text-slate-600`}>Pedidos anotados en E07 (sin contar rechazos y cancelaciones a propósito)</td><td className={`${TH} font-medium`}>{v.orders.total} (+{v.orders.intentional} rechazados o cancelados)</td></tr>
                  <tr className="border-b border-slate-100"><td className={`${TH} text-slate-600`}>Pedidos completados de punta a punta</td><td className={`${TH} font-medium`}>{pct(v.orders.rate)}</td></tr>
                  {v.orders.failures.length > 0 && (
                    <tr className="border-b border-slate-100 align-top">
                      <td className={`${TH} text-slate-600`}>Pedidos que fallaron y por qué</td>
                      <td className={`${TH}`}>
                        <ul className="space-y-1">
                          {v.orders.failures.map((f) => (
                            <li key={f.runId}>
                              <Link href={`/admin/runs/${f.runId}`} className="font-medium text-[#2F5DA8] hover:underline">{f.tester}</Link> · {f.count}:{" "}
                              <span className="whitespace-pre-wrap text-slate-700">{f.why || "sin motivo"}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                  <tr><td className={`${TH} text-slate-600`}>Hallazgos abiertos (críticos / altos / medios / bajos)</td><td className={`${TH} font-medium`}>{sevOpen("critico")} / {sevOpen("alto")} / {sevOpen("medio")} / {sevOpen("bajo")}</td></tr>
                </tbody>
              </table>
            </div>
          </Sec>

          <Sec
            id="sys-hallazgos"
            title={`Hallazgos abiertos (${v.defects.length})`}
            note="Cambia la severidad o la revisión en la página del participante o en «Reportes recientes». «Crítico» lo asigna Mesa de control: pedidos o cobros perdidos o duplicados, datos expuestos o una vulnerabilidad grave."
          >
            <div className="flex flex-wrap gap-2 text-sm">
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
                      <th className={TH}>Tipo</th>
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
                        <td className={`${TH} text-xs`}>{d.bugType ? BUG_TYPES[d.bugType] : "—"}</td>
                        <td className={`${TH} whitespace-nowrap`}><span className="font-mono text-xs text-slate-500">{d.activityId}</span> {d.activityTitle}</td>
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
          </Sec>

          <Sec
            id="sys-tipos"
            title="Tipos de bugs encontrados"
            note="Solo bugs del desarrollo (sin revisar, confirmados o corregidos). Clasificación por característica de calidad de ISO/IEC 25010:2023 y clase de defecto de IEEE 1044-2009."
          >
            <div data-testid="bug-types">
              {v.bugTypes.length === 0 ? (
                <p className="text-sm text-slate-500">Todavía no hay bugs del desarrollo.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className={TH}>Tipo</th>
                        <th className={TH}>Bugs</th>
                        <th className={TH}>Abiertos</th>
                        <th className={TH}>Por severidad</th>
                        <th className={TH}>Ejemplos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.bugTypes.map((b) => (
                        <tr key={b.type || "none"} className="border-t border-slate-100 align-top">
                          <td className={TH}>
                            <div className="font-medium text-slate-900">{b.label}</div>
                            <div className="text-xs text-slate-500">{b.type ? BUG_TYPE_HINT[b.type] : "Mesa los confirmó; se clasifican al procesar con Claude."}</div>
                          </td>
                          <td className={`${TH} font-semibold`}>{b.total}</td>
                          <td className={TH}>{b.open}</td>
                          <td className={TH}>
                            <div className="flex flex-wrap gap-1">
                              {(Object.keys(SEVERITIES) as Severity[]).filter((s) => b.bySeverity[s] > 0).map((s) => (
                                <span key={s} className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEV_CLASS[s]}`}>
                                  {SEVERITIES[s]}: {b.bySeverity[s]}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className={`${TH} text-xs text-slate-700`}>
                            <ul className="space-y-1">
                              {b.examples.slice(0, 3).map((e) => (
                                <li key={e.id}>
                                  <Link className="font-medium text-[#2F5DA8] hover:underline" href={`/admin/runs/${e.runId}`}>{e.activityId}</Link>{" "}
                                  {e.description.length > 120 ? e.description.slice(0, 118) + "…" : e.description}
                                </li>
                              ))}
                              {b.examples.length > 3 && <li className="text-slate-500">y {b.examples.length - 3} más</li>}
                            </ul>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Sec>

          <Sec id="sys-base" title="Base del cálculo">
            <div data-testid="population" className="rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
              <p className="text-slate-700">
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
            </div>
          </Sec>

          <section id="sys-metodologia" className="scroll-mt-4">
            <details className="rounded-xl bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-200">
              <summary className="cursor-pointer text-lg font-semibold text-slate-900">Metodología</summary>
              <p className="mt-2">
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
                escala SUS, donde 68 es el promedio de referencia) y repartidores con caritas de 1 a 5 llevadas a 0–100 (solo informativa, sin peso en el veredicto). Las tasas llevan intervalo de
                confianza del 95 % con Wald ajustado.
              </p>
              <p className="mt-2">
                La muestra es la real: si se registran 10 establecimientos y solo 7 completan la prueba, esos 7 son el 100 %. Todos los porcentajes se calculan solo con las pruebas completas: no cuentan quienes abandonaron o no terminaron, ni quienes tuvieron un
                problema de logística (no les asignaron repartidor, no pudieron comunicarse con él, o dejó de contestar y apareció sin conexión), según su encuesta o la decisión de Mesa de control.
                La prueba califica únicamente el desarrollo: las fallas de servidor, de correo, de red o de logística ajenas al equipo de desarrollo se marcan «Ajena al desarrollo» y no cuentan ni
                como falla ni como actividad ejecutada; lo mismo con las encuestas de repartidores que no pudieron entrar por esas causas.
              </p>
              <p className="mt-2">Los criterios de salida se fijaron antes de la prueba y no se ajustan después: el veredicto es «Sí» solo si se cumplen todos.</p>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
