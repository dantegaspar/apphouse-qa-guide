import { deviceSummary, fmtDate, isImage, parseRec } from "@/lib/admin-data";
import PhotoGallery from "@/components/admin/PhotoGallery";
import { TriangleAlert } from "lucide-react";
import { COURIER_QUESTIONS, COURIER_RATING, FACES } from "@/lib/courier";
import { answerOf, courierStats, isCourierNa, loadCourier, ratingOf } from "@/lib/courier-data";
import { FaceIcon } from "@/components/courier/FaceIcon";
import { ExportButton } from "@/components/admin/ExportButton";
import VerdictScope from "@/components/admin/VerdictScope";
import { Bars, ChartCard, COLORS, Columns, Empty, fmt, Kpi } from "@/components/admin/charts/Charts";

/** Encuesta de repartidores en el panel y en las gráficas (no depende del filtro de guía). */

const FACE_COLORS = [COLORS.critical, COLORS.serious, COLORS.neutral, "#6cc06c", COLORS.good];
const COURIER_EXPORTS: [string, string][] = [
  ["courier", "Repartidores (CSV)"],
  ["courier_issues", "Repartidores - fallas (CSV)"],
];
const avgText = (v: number | null) => (v === null ? "—" : fmt(v, 1));
/** Cuántas encuestas se listan en /admin (las más recientes). */
const RECENT = 30;

function FaceAvg({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <FaceIcon value={value} className="h-[1em] w-[1em]" />
      <span className="font-semibold">{avgText(value)}</span>
      <span className="text-slate-500"> / 5</span>
    </span>
  );
}

/** Sección "Repartidores" de /admin. */
export function CourierAdminSection() {
  const { feedback, issues, attachments } = loadCourier();
  const stats = courierStats(feedback);
  const issuesBy = new Map<string, typeof issues>();
  for (const i of issues) issuesBy.set(i.feedback_id, [...(issuesBy.get(i.feedback_id) ?? []), i]);
  const attsBy = new Map<string, typeof attachments>();
  for (const a of attachments) attsBy.set(a.issue_id, [...(attsBy.get(a.issue_id) ?? []), a]);

  return (
    <section id="repartidores" data-testid="courier-admin" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Repartidores</h2>
        <div className="flex flex-wrap gap-2">
          {COURIER_EXPORTS.map(([k, label]) => (
            <ExportButton key={k} href={`/api/admin/export/${k}`} label={label} className="rounded-lg bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8] px-3 py-2 text-sm font-medium text-white">
              {label}
            </ExportButton>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="text-3xl font-bold text-[#2F5DA8]" data-testid="courier-count">{stats.responses}</div>
          <div className="text-sm text-slate-600">Encuestas</div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="text-3xl text-slate-900"><FaceAvg value={stats.avg} /></div>
          <div className="text-sm text-slate-600">Promedio general</div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid="courier-rating">
          <div className="text-3xl text-slate-900">
            <span className="font-semibold">{stats.rating.avg === null ? "—" : fmt(stats.rating.avg, 1)}</span>
            <span className="text-slate-500"> / 10</span>
          </div>
          <div className="text-sm text-slate-600" title={COURIER_RATING.label}>
            Lo recomendaría{stats.rating.n ? ` · ${stats.rating.n} resp.` : ""}
          </div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="text-3xl font-bold text-amber-600">{issues.length}</div>
          <div className="text-sm text-slate-600">Problemas reportados</div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="text-3xl font-bold text-slate-700">{attachments.length}</div>
          <div className="text-sm text-slate-600">Fotos</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full min-w-[560px] text-left text-sm" data-testid="courier-averages">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Pregunta</th>
              <th className="px-3 py-2">Promedio</th>
              {FACES.map((f) => (
                <th key={f.value} className="px-2 py-2 text-center" title={`Carita ${f.value} de 5`}>
                  <FaceIcon value={f.value} className="h-5 w-5" />
                  <span className="sr-only">{f.label}</span>
                </th>
              ))}
              <th className="px-2 py-2 text-center normal-case" title="No me tocó / No llegué a esta parte (no cuenta en el promedio)">No aplica</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stats.questions.map((q) => (
              <tr key={q.id}>
                <td className="px-3 py-2">{q.label}</td>
                <td className="px-3 py-2"><FaceAvg value={q.avg} /></td>
                {q.counts.map((c, i) => (
                  <td key={i} title={q.faces[i]} className={`px-2 py-2 text-center ${c ? "font-semibold" : "text-slate-300"}`}>{c}</td>
                ))}
                <td className={`px-2 py-2 text-center ${q.naCount ? "font-semibold text-slate-600" : "text-slate-300"}`}>{q.naCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-2 text-base font-semibold text-slate-900">Últimas encuestas</h3>
        {feedback.length > RECENT && (
          <p className="mb-2 text-sm text-slate-600" data-testid="courier-recent-note">
            Mostrando las {RECENT} más recientes de {feedback.length}. Para verlas todas, descarga «Repartidores (CSV)».
          </p>
        )}
        <ul className="space-y-3">
          {feedback.length === 0 && <li className="text-sm text-slate-500">Todavía no hay encuestas de repartidores.</li>}
          {feedback.slice(0, RECENT).map((f) => {
            const ans = parseRec(f.answers);
            const its = issuesBy.get(f.id) ?? [];
            return (
              <li key={f.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid="courier-row">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-slate-900">{f.name}</span>
                  {f.phone && <span className="text-slate-600">{f.phone}</span>}
                  <span className="text-slate-500">{deviceSummary(parseRec(f.device))}</span>
                  <span className="ml-auto text-xs text-slate-500">{fmtDate(f.created_at)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                  {COURIER_QUESTIONS.map((q) => {
                    const v = answerOf(ans, q.id);
                    if (isCourierNa(ans, q.id))
                      return (
                        <span key={q.id} title={q.label}>
                          {q.short}: <span className="text-slate-500">No le tocó</span>
                        </span>
                      );
                    return (
                      <span key={q.id} title={q.label}>
                        {q.short}: {v ? <FaceIcon value={v} className="-mt-0.5 h-4 w-4 align-middle" /> : "—"} <span className="text-slate-500">{v ? q.faces[v - 1] : ""}</span>
                      </span>
                    );
                  })}
                  {ratingOf(ans) !== null && (
                    <span title={COURIER_RATING.label}>
                      {COURIER_RATING.short}: <b>{ratingOf(ans)}</b>
                    </span>
                  )}
                </div>
                {f.comment && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">“{f.comment}”</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>¿Cuenta para el veredicto?</span>
                  <VerdictScope courierId={f.id} scope={f.verdict_scope ?? ""} note={f.verdict_scope_note ?? ""} />
                </div>
                {its.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {its.map((i) => (
                      <li key={i.id} className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200" data-testid="courier-issue">
                        <p className="flex items-start gap-1.5 whitespace-pre-wrap text-sm text-slate-800">
                          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <span>{i.description}</span>
                        </p>
                        {(attsBy.get(i.id) ?? []).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <PhotoGallery
                              photos={(attsBy.get(i.id) ?? []).filter((a) => isImage(a.mime)).map((a) => ({ id: a.id, src: `/api/admin/courier-files/${a.id}`, name: a.original_name }))}
                            >
                              {(attsBy.get(i.id) ?? [])
                                .filter((a) => !isImage(a.mime))
                                .map((a) => (
                                  <a key={a.id} href={`/api/admin/courier-files/${a.id}`} target="_blank" rel="noreferrer" className="block">
                                    <span className="inline-flex h-20 items-center rounded-lg bg-slate-100 px-3 text-xs text-slate-700 ring-1 ring-slate-200">{a.original_name}</span>
                                  </a>
                                ))}
                            </PhotoGallery>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Bloque "Repartidores" de /admin/graficas. */
export function CourierChartsSection() {
  const { feedback, issues } = loadCourier();
  const s = courierStats(feedback);
  return (
    <section data-testid="courier-charts">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">Repartidores</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Encuestas" value={fmt(s.responses)} />
        <Kpi label="Satisfacción promedio" value={s.avg === null ? "—" : fmt(s.avg, 1)} hint={s.avg === null ? "Sin respuestas" : "de 5 (todas las preguntas)"} />
        <Kpi
          label="Lo recomendaría"
          value={s.rating.avg === null ? "—" : fmt(s.rating.avg, 1)}
          hint={s.rating.n ? `de 10 · ${s.rating.n} respuesta${s.rating.n === 1 ? "" : "s"} · informativo` : "Sin respuestas"}
        />
        <Kpi label="Problemas reportados" value={fmt(issues.length)} accent={COLORS.warning} />
      </div>
      {s.responses === 0 ? (
        <ChartCard className="mt-4" title="Encuesta de repartidores" subtitle="Caritas de 1 (la peor) a 5 (la mejor)">
          <Empty />
        </ChartCard>
      ) : (
        <>
          <ChartCard
            className="mt-4"
            title="Promedio por pregunta"
            subtitle="De 1 (la peor carita) a 5 (la mejor). «No me tocó» no cuenta."
            table={{ head: ["Pregunta", "Promedio", "Respuestas", "No aplica"], rows: s.questions.map((q) => [q.label, avgText(q.avg), q.n, q.naCount]) }}
          >
            <Bars
              max={5}
              // Los promedios van de 1 a 5: 0 = sin caritas (p. ej. todos eligieron «No me tocó»)
              format={(n) => (n ? fmt(n, 1) : "—")}
              rows={s.questions.map((q) => ({ key: q.id, label: q.short, sub: q.label, aria: q.label, value: q.avg ?? 0 }))}
            />
          </ChartCard>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {s.questions.map((q) => (
              <ChartCard
                key={q.id}
                title={q.label}
                subtitle={
                  (q.n ? `Promedio ${avgText(q.avg)} de 5 · ${q.n} respuesta${q.n === 1 ? "" : "s"}` : "Sin respuestas") +
                  (q.naCount ? ` · No le tocó: ${q.naCount}` : "")
                }
                table={{
                  head: ["Carita", "Respuestas"],
                  rows: [...q.counts.map((c, i) => [`${i + 1} · ${q.faces[i]}`, c]), ...(q.naCount ? [["No me tocó", q.naCount]] : [])],
                }}
              >
                {q.n === 0 ? (
                  <Empty />
                ) : (
                  <>
                    <Columns
                      aria={`Distribución de ${q.label}`}
                      height={110}
                      cols={q.counts.map((c, i) => ({
                        key: String(i),
                        label: String(i + 1),
                        value: c,
                        color: FACE_COLORS[i],
                        title: `${q.faces[i]}: ${c} respuesta(s)`,
                      }))}
                    />
                    <div className="mt-1 flex justify-between gap-2 text-[11px] text-slate-500">
                      <span>{q.faces[0]}</span>
                      <span>{q.faces[4]}</span>
                    </div>
                  </>
                )}
              </ChartCard>
            ))}
          </div>
          <ChartCard
            className="mt-4"
            title={COURIER_RATING.label}
            subtitle={
              s.rating.n
                ? `Promedio ${fmt(s.rating.avg ?? 0, 1)} de 10 · ${s.rating.n} respuesta${s.rating.n === 1 ? "" : "s"} · informativo, no decide el veredicto`
                : "Sin respuestas (las encuestas anteriores no tenían esta pregunta)"
            }
            table={{ head: ["Calificación", "Respuestas"], rows: s.rating.counts.map((c, i) => [String(i + COURIER_RATING.min), c]) }}
          >
            {s.rating.n === 0 ? (
              <Empty />
            ) : (
              <Columns
                aria={`Distribución de ${COURIER_RATING.label}`}
                height={110}
                cols={s.rating.counts.map((c, i) => {
                  const n = i + COURIER_RATING.min;
                  return { key: String(n), label: String(n), value: c, color: n <= 6 ? COLORS.critical : n <= 8 ? COLORS.neutral : COLORS.good, title: `${n}: ${c} respuesta(s)` };
                })}
              />
            )}
          </ChartCard>
        </>
      )}
    </section>
  );
}
