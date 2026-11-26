import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getGuide, GUIDES } from "@/lib/guides";
import { ACTIVITY_RESULTS } from "@/lib/types";
import { loadStats, RESULT_ORDER, type NpsDist } from "@/lib/admin-stats";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { InsightsPanel } from "@/components/admin/InsightsPanel";
import { computeInsights } from "@/lib/insights";
import { CourierChartsSection } from "@/components/admin/CourierSection";
import { loadPlainSummary, plainTask } from "@/lib/plain-summary";
import { Bars, ChartCard, COLORS, Columns, Empty, fmt, Kpi, SegmentedBar, StackedBars, type Series } from "@/components/admin/charts/Charts";

export const dynamic = "force-dynamic";

const RESULT_SERIES: Series[] = [
  { name: ACTIVITY_RESULTS.ok, color: COLORS.good },
  { name: ACTIVITY_RESULTS.issue, color: COLORS.warning },
  { name: "No pude", color: COLORS.critical },
  { name: ACTIVITY_RESULTS.skipped, color: COLORS.neutral },
];
const FAILURE_SERIES: Series[] = [
  { name: "Bloqueantes", color: COLORS.critical },
  { name: "No bloqueantes", color: COLORS.serious },
];
const npsColor = (v: number) => (v >= 9 ? COLORS.good : v >= 7 ? COLORS.neutral : COLORS.critical);
const shortDay = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
};

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-lg font-semibold text-slate-900">{children}</h2>;
}

function NpsCard({ q, guideTitle }: { q: NpsDist; guideTitle?: string }) {
  return (
    <ChartCard
      title={`Recomendación (NPS)${guideTitle ? ` · ${guideTitle}` : ""}`}
      subtitle={q.label}
      table={{ head: ["Calificación", "Respuestas"], rows: q.counts.map((c, i) => [i, c]) }}
    >
      {q.n === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
            <div>
              <div className="text-4xl font-semibold text-slate-900">{q.score! > 0 ? `+${q.score}` : q.score}</div>
              <div className="text-xs text-slate-500">NPS (−100 a +100)</div>
            </div>
            <div className="text-sm text-slate-600">
              Promedio {fmt(q.avg ?? 0, 1)} de 10 · {q.n} respuesta{q.n === 1 ? "" : "s"}
            </div>
          </div>
          <SegmentedBar
            aria="Promotores, pasivos y detractores"
            parts={[
              { name: "Detractores 0–6", value: q.detractors, color: COLORS.critical },
              { name: "Pasivos 7–8", value: q.passives, color: COLORS.neutral, ink: "#0b0b0b" },
              { name: "Promotores 9–10", value: q.promoters, color: COLORS.good },
            ]}
          />
          <Columns
            aria="Distribución de calificaciones de 0 a 10"
            height={120}
            cols={q.counts.map((c, i) => ({ key: String(i), label: String(i), value: c, color: npsColor(i), title: `${i}: ${c} respuesta(s)` }))}
          />
        </div>
      )}
    </ChartCard>
  );
}

export default async function ChartsPage({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { guide: guideParam } = await searchParams;
  const guideId = guideParam && getGuide(guideParam) ? guideParam : null;
  const s = loadStats(guideId);
  const k = s.kpis;
  const multi = s.perGuide.length > 1;
  const adminHref = guideId ? `/admin?guide=${encodeURIComponent(guideId)}` : "/admin";

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 h-1.5 w-16 rounded-full bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8]" />
          <h1 className="text-2xl font-bold text-slate-900">Gráficas</h1>
          <p className="text-sm text-slate-600">Resumen visual de las pruebas de AppHouse</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={adminHref} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ← Panel
          </Link>
          <Link href={guideId ? `/admin/mesa?guide=${encodeURIComponent(guideId)}` : "/admin/mesa"} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#2F5DA8] hover:bg-slate-50">
            Mesa de control
          </Link>
          <LogoutButton />
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filtrar por guía">
        {[{ id: "", title: "Todas las guías" }, ...GUIDES].map((g) => (
          <Link
            key={g.id}
            href={g.id ? `/admin/graficas?guide=${encodeURIComponent(g.id)}` : "/admin/graficas"}
            className={`rounded-full px-3 py-1.5 font-medium ring-1 ${
              (guideId ?? "") === g.id ? "bg-[#2F5DA8] text-white ring-[#2F5DA8]" : "bg-white text-slate-700 ring-slate-300"
            }`}
          >
            {g.title}
          </Link>
        ))}
      </nav>

      {(() => {
        const ps = loadPlainSummary();
        const tone = ps.ready === null ? "bg-slate-50 ring-slate-200" : ps.ready ? "bg-emerald-50 ring-emerald-200" : "bg-red-50 ring-red-200";
        return (
          <section data-testid="plain-banner" className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 ring-1 ${tone}`}>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Resultado de la prueba</p>
              <p className="text-lg font-bold text-slate-900">{ps.headline}</p>
              <p className="text-sm text-slate-700">{ps.why}</p>
            </div>
            <Link href="/admin/veredicto" className="rounded-lg bg-[#2F5DA8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264d8c]">
              Ver resumen completo
            </Link>
          </section>
        );
      })()}

      {/* 1. KPIs */}
      <section aria-label="Indicadores">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Testers" value={fmt(k.testers)} hint={`${fmt(k.runs)} corrida${k.runs === 1 ? "" : "s"}`} />
          <Kpi label="Terminadas" value={fmt(k.finished)} accent={COLORS.good} hint={k.runs ? `${Math.round((k.finished / k.runs) * 100)}% de las corridas` : undefined} />
          <Kpi label="En curso" value={fmt(k.inProgress)} accent={COLORS.warning} />
          <Kpi label="Terminadas por bloqueo" value={fmt(k.endedBlocked)} accent={COLORS.critical} />
          <Kpi label="Fallas reportadas" value={fmt(k.failures)} />
          <Kpi label="Fallas bloqueantes" value={fmt(k.blocking)} accent={COLORS.critical} hint={k.failures ? `${Math.round((k.blocking / k.failures) * 100)}% del total` : undefined} />
          {k.hasNps && (
            <Kpi
              label="NPS"
              value={k.nps === null ? "—" : k.nps > 0 ? `+${k.nps}` : k.nps}
              hint={k.npsN ? `Promedio ${fmt(k.npsAvg ?? 0, 1)}/10 · ${k.npsN} resp.` : "Sin respuestas"}
            />
          )}
          <Kpi
            label="SUS equivalente (UMUX-Lite, 0–100)"
            value={k.susAvg === null ? "—" : fmt(k.susAvg, 0)}
            hint={k.susN ? `Promedio de ${k.susN} encuesta${k.susN === 1 ? "" : "s"} · 68 = promedio de la industria` : "Sin respuestas"}
          />
        </div>
      </section>

      {/* 2. Resultados por actividad */}
      <section>
        <H2>Resultados por actividad</H2>
        {s.perGuide.length === 0 ? (
          <ChartCard title="Resultado de cada actividad" subtitle="Cuántos testers marcaron cada resultado">
            <Empty />
          </ChartCard>
        ) : (
          <div className={`grid gap-4 ${multi ? "lg:grid-cols-2" : ""}`}>
            {s.perGuide.map((g) => {
              const any = g.activities.some((a) => RESULT_ORDER.some((r) => a.counts[r] > 0));
              return (
                <ChartCard
                  key={g.guide.id}
                  title={`Resultado de cada tarea · ${g.guide.title}`}
                  subtitle={`Respuestas de ${g.runs} corrida${g.runs === 1 ? "" : "s"}, en el orden de la guía`}
                  table={{
                    head: ["Actividad", "Bien", "Falla", "No pude", "No le tocó", "Pendiente"],
                    rows: g.activities.map((a) => [`${a.id} ${a.title}`, ...RESULT_ORDER.map((r) => a.counts[r]), a.pending]),
                  }}
                >
                  {!any ? (
                    <Empty />
                  ) : (
                    <StackedBars
                      series={RESULT_SERIES}
                      max={Math.max(1, ...g.activities.map((a) => RESULT_ORDER.reduce((n, r) => n + a.counts[r], 0)))}
                      rows={g.activities.map((a) => ({
                        key: a.id,
                        aria: `${a.id} ${a.title}`,
                        label: (
                          <>
                            {plainTask(a.id, a.title)} <span className="font-mono text-[11px] text-slate-400">{a.id}</span>
                          </>
                        ),
                        values: RESULT_ORDER.map((r) => a.counts[r]),
                      }))}
                    />
                  )}
                </ChartCard>
              );
            })}
          </div>
        )}
      </section>

      {/* 2b. Facilidad de cada tarea (Single Ease Question, 1 a 7), si la guía la pregunta */}
      {s.perGuide.some((g) => g.activities.some((a) => a.seq.n > 0)) && (
        <section>
          <div className={`grid gap-4 ${multi ? "lg:grid-cols-2" : ""}`}>
            {s.perGuide
              .filter((g) => g.activities.some((a) => a.seq.n > 0))
              .map((g) => (
                <ChartCard
                  key={g.guide.id}
                  title={`Facilidad de cada tarea · ${g.guide.title}`}
                  subtitle="Promedio de «¿Qué tan fácil o difícil fue?» (1 = muy difícil, 7 = muy fácil). Menos de 5 indica que la tarea costó trabajo."
                  table={{
                    head: ["Actividad", "Promedio (1 a 7)", "Respuestas"],
                    rows: g.activities.map((a) => [`${a.id} ${a.title}`, a.seq.avg === null ? "—" : fmt(a.seq.avg, 1), a.seq.n]),
                  }}
                >
                  <Bars
                    max={7}
                    color={COLORS.series}
                    format={(n) => (n ? fmt(n, 1) : "—")}
                    rows={g.activities.map((a) => ({
                      key: a.id,
                      aria: `${a.id} ${a.title}`,
                      label: (
                        <>
                          {plainTask(a.id, a.title)} <span className="font-mono text-[11px] text-slate-400">{a.id}</span>
                        </>
                      ),
                      sub: a.seq.n ? `${a.seq.n} respuesta${a.seq.n === 1 ? "" : "s"}${a.seq.avg !== null && a.seq.avg < 5 ? " · costó trabajo" : ""}` : "sin respuestas",
                      value: a.seq.avg ?? 0,
                    }))}
                  />
                </ChartCard>
              ))}
          </div>
        </section>
      )}

      {/* 3 y 4. Pasos con "No pude" y fallas por actividad */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Pasos con más «No pude»"
          subtitle="Los 10 pasos que más testers no lograron completar"
          table={{ head: ["Paso", "Testers"], rows: s.topBlockedSteps.map((r) => [`${r.label} ${r.text}`, r.count]) }}
        >
          {s.topBlockedSteps.length === 0 ? (
            <Empty>Aún no hay datos: nadie ha marcado «No pude» en un paso</Empty>
          ) : (
            <Bars
              color={COLORS.critical}
              rows={s.topBlockedSteps.map((r) => ({
                key: r.label,
                label: <span className="font-mono text-xs">{r.label}</span>,
                sub: r.text,
                aria: `Paso ${r.label}${r.text ? `, ${r.text}` : ""}`,
                value: r.count,
              }))}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Fallas reportadas por tarea"
          subtitle="Reportes de falla (sin evidencias), bloqueantes y no bloqueantes"
          table={{ head: ["Actividad", "Bloqueantes", "No bloqueantes"], rows: s.failuresByActivity.map((r) => [`${r.id} ${r.title}`, r.blocking, r.nonBlocking]) }}
        >
          {s.failuresByActivity.length === 0 ? (
            <Empty>Aún no hay datos: no se han reportado fallas</Empty>
          ) : (
            <StackedBars
              series={FAILURE_SERIES}
              rows={s.failuresByActivity.map((r) => ({
                key: r.id,
                aria: `${r.id} ${r.title}`,
                label: (
                  <>
                    {plainTask(r.id, r.title)} <span className="font-mono text-[11px] text-slate-400">{r.id}</span>
                  </>
                ),
                values: [r.blocking, r.nonBlocking],
              }))}
            />
          )}
        </ChartCard>
      </section>

      {/* 5. Encuesta */}
      <section>
        <H2>Encuesta</H2>
        {s.perGuide.every((g) => g.survey.responses === 0) ? (
          <ChartCard title="Respuestas de la encuesta" subtitle="Escalas, recomendación y opciones">
            <Empty />
          </ChartCard>
        ) : (
          <div className="space-y-6">
            {s.perGuide
              .filter((g) => g.survey.responses > 0)
              .map((g) => (
                <div key={g.guide.id} className="space-y-4">
                  <p className="text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">{g.guide.title}</span> · {g.survey.responses} respuesta{g.survey.responses === 1 ? "" : "s"}
                  </p>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {g.survey.nps.map((q) => (
                      <NpsCard key={q.id} q={q} />
                    ))}
                    {g.survey.scales.map((q) => (
                      <ChartCard
                        key={q.id}
                        title={q.label}
                        subtitle={
                          q.n ? `Promedio ${fmt(q.avg ?? 0, 1)} de ${q.max} · ${q.n} respuesta${q.n === 1 ? "" : "s"}` : "Sin respuestas"
                        }
                        table={{ head: ["Valor", "Respuestas"], rows: q.counts.map((c, i) => [q.min + i, c]) }}
                      >
                        {q.n === 0 ? (
                          <Empty />
                        ) : (
                          <>
                            <Columns
                              aria={`Distribución de ${q.label}`}
                              height={110}
                              cols={q.counts.map((c, i) => ({ key: String(i), label: String(q.min + i), value: c, title: `${q.min + i}: ${c} respuesta(s)` }))}
                            />
                            {(q.minLabel || q.maxLabel) && (
                              <div className="mt-1 flex justify-between gap-2 text-[11px] text-slate-500">
                                <span>{q.min} = {q.minLabel}</span>
                                <span className="text-right">{q.max} = {q.maxLabel}</span>
                              </div>
                            )}
                          </>
                        )}
                      </ChartCard>
                    ))}
                    {g.survey.choices.map((q) => (
                      <ChartCard
                        key={q.id}
                        title={q.label}
                        subtitle={q.n ? `${q.n} respuesta${q.n === 1 ? "" : "s"}` : "Sin respuestas"}
                        table={{ head: ["Opción", "Respuestas"], rows: q.options.map((o) => [o.label, o.count]) }}
                      >
                        {q.n === 0 ? (
                          <Empty />
                        ) : (
                          <Bars max={q.n} rows={q.options.map((o) => ({ key: o.label, label: o.label, aria: o.label, value: o.count }))} />
                        )}
                      </ChartCard>
                    ))}
                  </div>
                </div>
              ))}
            <ChartCard
              title="Comentarios abiertos"
              subtitle={
                s.openComments.total === 0
                  ? "Respuestas de texto libre de la encuesta"
                  : s.openComments.total > s.openComments.items.length
                    ? `Los ${s.openComments.items.length} más recientes de ${s.openComments.total}`
                    : `${s.openComments.total} comentario${s.openComments.total === 1 ? "" : "s"}, del más reciente al más antiguo`
              }
            >
              {s.openComments.total === 0 ? (
                <Empty>Aún no hay datos: nadie ha escrito un comentario</Empty>
              ) : (
                <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
                  {s.openComments.items.map((c) => (
                    <li key={`${c.runId}|${c.questionId}`} className="py-3">
                      <p className="whitespace-pre-line break-words text-sm text-slate-800">{c.text}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        <Link href={`/admin/runs/${encodeURIComponent(c.runId)}`} className="font-medium text-[#2F5DA8] hover:underline">
                          {c.tester}
                        </Link>
                        {" · "}
                        {c.guideTitle}
                        {" · "}
                        {new Date(c.at).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
          </div>
        )}
      </section>

      {/* Repartidores (encuesta aparte, no depende del filtro de guía) */}
      <CourierChartsSection />

      {/* 6. Dispositivos y tiempo */}
      <section>
        <H2>Dispositivos y actividad</H2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["Tipo de dispositivo", "Según el sistema y el tamaño de pantalla", s.devices.kind],
              ["Sistema operativo", "Sin versión; los menos usados van en «Otros»", s.devices.os],
              ["Navegador", "Sin versión; los menos usados van en «Otros»", s.devices.browser],
            ] as const
          ).map(([title, subtitle, rows]) => (
            <ChartCard key={title} title={title} subtitle={subtitle} table={{ head: [title, "Corridas"], rows: rows.map((r) => [r.label, r.count]) }}>
              {rows.length === 0 ? <Empty /> : <Bars rows={rows.map((r) => ({ key: r.label, label: r.label, aria: r.label, value: r.count }))} />}
            </ChartCard>
          ))}
        </div>
        <ChartCard
          className="mt-4"
          title="Corridas iniciadas por día"
          subtitle="Hora de la Ciudad de México"
          table={{ head: ["Día", "Corridas"], rows: s.runsByDay.map((r) => [r.label, r.count]) }}
        >
          {s.runsByDay.length === 0 ? (
            <Empty />
          ) : (
            <Columns
              aria="Corridas iniciadas por día"
              height={150}
              labelEvery={Math.ceil(s.runsByDay.length / 7)}
              cols={s.runsByDay.map((r) => ({ key: r.label, label: shortDay(r.label), value: r.count, title: `${r.label}: ${r.count} corrida(s)` }))}
            />
          )}
        </ChartCard>
      </section>

      {/* Para Sistemas: frases automáticas con códigos de actividad */}
      <details className="group">
        <summary className="cursor-pointer select-none text-lg font-semibold text-slate-900">
          Para Sistemas: resumen automático detallado <span className="text-sm font-normal text-slate-500">(con códigos de actividad)</span>
        </summary>
        <div className="mt-3">
          <InsightsPanel insights={computeInsights(guideId)} exportQs={guideId ? `?guide=${encodeURIComponent(guideId)}` : ""} />
        </div>
      </details>
    </main>
  );
}
