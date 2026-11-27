import Link from "next/link";
import { COLORS } from "@/components/admin/charts/Charts";
import { AUDIENCE_LABEL, PLAIN_SEVERITY, type Audience, type OpinionItem, type PlainSummary, type Problem, type Tone } from "@/lib/plain-summary";
import type { Severity } from "@/lib/types";
import { THRESHOLDS } from "@/lib/verdict";

/**
 * Resumen ejecutivo para todo el personal (componente de servidor): veredicto Sí/No con el porqué en una
 * frase, cuatro indicadores, qué no funcionó para quién y qué opinaron, con rapidez y fluidez (informativo), sin códigos ni siglas.
 */

const TONE_DOT: Record<Tone, string> = { good: COLORS.good, bad: COLORS.critical, neutral: COLORS.neutral };
const TONE_WORD: Record<Tone, string> = { good: "En meta", bad: "Fuera de meta", neutral: "" };
const SEV_CHIP: Record<Severity, string> = {
  critico: "bg-red-600 text-white",
  alto: "bg-red-100 text-red-800 ring-1 ring-inset ring-red-200",
  medio: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300",
  bajo: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
};
const PER_AUDIENCE = 5;

/** Barra de proporción: «a de b». El texto lleva el número; la barra solo apoya. */
function Meter({ value, of, color, label }: { value: number; of: number; color: string; label: string }) {
  const w = of ? Math.max(4, Math.round((value / of) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: COLORS.track }} role="img" aria-label={label} title={label}>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

function OpinionList({ items }: { items: OpinionItem[] }) {
  return (
    <ul className="mt-2 space-y-3">
      {items.map((it) => {
        const nums = `${it.avg.toFixed(1)} de ${it.max}`;
        return (
          <li key={it.id}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-slate-700">{it.label}</span>
              <strong className="shrink-0 text-right text-slate-900">{it.word}</strong>
            </div>
            <div className="mt-1.5">
              <Meter value={it.avg} of={it.max} color={TONE_DOT[it.tone]} label={`${it.label}: ${it.word}, ${nums}`} />
            </div>
            <p className="mt-1 text-xs tabular-nums text-slate-500">
              {nums} · {it.n} {it.n === 1 ? "respuesta" : "respuestas"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function ProblemItem({ p }: { p: Problem }) {
  const label = `Le pasó a ${p.affected} de ${p.of} ${p.of === 1 ? "persona" : "personas"}`;
  return (
    <li className="break-inside-avoid py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium text-slate-900">{p.task}</span>
        <span className="text-sm tabular-nums text-slate-600">{label}</span>
      </div>
      <div className="mt-1.5">
        <Meter value={p.affected} of={p.of} color={p.severity === "bajo" ? COLORS.neutral : p.severity === "medio" ? COLORS.warning : COLORS.critical} label={label} />
      </div>
      {p.severity && (
        <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEV_CHIP[p.severity]}`}>{PLAIN_SEVERITY[p.severity]}</span>
      )}
      {p.examples.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-sm text-slate-600">
          {p.examples.map((e) => (
            <li key={e}>«{e}»</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AudienceColumn({ audience, children, empty }: { audience: Audience; children?: React.ReactNode; empty?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white p-4 ring-1 ring-slate-200 print:break-inside-avoid">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{AUDIENCE_LABEL[audience]}</h4>
      {children ?? <p className="mt-2 text-sm text-slate-500">{empty}</p>}
    </div>
  );
}

export function PlainSummaryView({ s, sistemasHref }: { s: PlainSummary; sistemasHref?: string }) {
  const hero =
    s.ready === null ? "bg-slate-50 ring-slate-200" : s.ready ? "bg-emerald-50 ring-emerald-200" : "bg-red-50 ring-red-200";
  const mark = s.ready === null ? "…" : s.ready ? "✓" : "✕";
  const markClass = s.ready === null ? "bg-slate-300 text-slate-700" : s.ready ? "bg-emerald-600 text-white" : "bg-red-600 text-white";
  const by = (a: Audience) => s.problems.filter((p) => p.audience === a);
  const hasAny = s.problems.length > 0 || s.courier.issues.length > 0;

  return (
    <div data-testid="plain-summary" className="space-y-6">
      {/* 1. Veredicto en una frase */}
      <section data-testid="verdict" className={`rounded-2xl p-6 ring-1 ${hero}`}>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">¿Está listo para usarse con clientes reales?</p>
        <div className="mt-2 flex items-start gap-4">
          <span aria-hidden className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl font-bold ${markClass}`}>{mark}</span>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{s.headline}</h2>
            <p className="mt-1 text-base text-slate-800">
              <span className="font-semibold">{s.ready ? "Por qué: " : s.ready === false ? "Por qué no: " : ""}</span>
              {s.why}
            </p>
            {s.moreReasons.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                {s.moreReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 2. Pocos indicadores */}
      <section aria-label="Indicadores clave" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {s.figures.map((f) => (
          <div key={f.id} className="flex min-w-0 flex-col rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 print:shadow-none">
            <div className="flex items-start gap-1.5 text-sm text-slate-600">
              <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_DOT[f.tone] }} />
              <span className="leading-tight">{f.label}</span>
            </div>
            <div className="mt-1 text-3xl font-semibold text-slate-900">{f.value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{f.detail}</div>
            {TONE_WORD[f.tone] && (
              <div className={`mt-1 text-xs font-semibold ${f.tone === "good" ? "text-emerald-700" : "text-red-700"}`}>{TONE_WORD[f.tone]}</div>
            )}
          </div>
        ))}
      </section>

      {/* 3. Qué no funcionó, para quién y a cuántos */}
      <section aria-labelledby="que-fallo">
        <h3 id="que-fallo" className="text-lg font-semibold text-slate-900">Qué no funcionó</h3>
        <p className="mb-3 text-sm text-slate-600">
          {!hasAny
            ? "Nadie reportó problemas con la app."
            : s.ready
              ? "Nada de esto impide pasar a producción, pero conviene corregirlo. Las frases entre comillas son de los participantes."
              : "Ordenado de lo más grave a lo menos grave. Las frases entre comillas son de los participantes."}
        </p>
        {hasAny && (
          <div className="grid gap-3 lg:grid-cols-3">
            {(["clientes", "establecimientos"] as const).map((a) => {
              const ps = by(a);
              return (
                <AudienceColumn key={a} audience={a} empty="Sin problemas reportados.">
                  {ps.length > 0 && (
                    <>
                      <ul className="divide-y divide-slate-100">
                        {ps.slice(0, PER_AUDIENCE).map((p) => (
                          <ProblemItem key={p.task} p={p} />
                        ))}
                      </ul>
                      {ps.length > PER_AUDIENCE && (
                        <p className="pt-1 text-sm text-slate-500">
                          y {ps.length - PER_AUDIENCE} más{sistemasHref ? <> en <Link href={sistemasHref} className="text-[#2F5DA8] hover:underline">Para Sistemas</Link></> : ""}.
                        </p>
                      )}
                    </>
                  )}
                </AudienceColumn>
              );
            })}
            <AudienceColumn audience="repartidores" empty={s.courier.responses ? "Sin problemas reportados." : "Todavía no hay encuestas de repartidores."}>
              {s.courier.responses > 0 ? (
                <div className="space-y-2 pt-2 text-sm">
                  {s.courier.issues.length > 0 ? (
                    <>
                      <p className="font-medium text-slate-900">
                        Reportaron {s.courier.issues.length} {s.courier.issues.length === 1 ? "problema" : "problemas"}
                      </p>
                      <ul className="space-y-0.5 text-slate-600">
                        {s.courier.issues.slice(0, 3).map((e) => (
                          <li key={e}>«{e}»</li>
                        ))}
                      </ul>
                      {s.courier.issues.length > 3 && <p className="text-slate-500">y {s.courier.issues.length - 3} más.</p>}
                    </>
                  ) : (
                    <p className="text-slate-600">Sin problemas reportados.</p>
                  )}
                  {s.courier.score !== null && (
                    <p className="text-slate-600">
                      Satisfacción: <strong className="text-slate-900">{Math.round(s.courier.score)} de 100</strong> (solo como referencia, no decide el resultado).
                    </p>
                  )}
                </div>
              ) : undefined}
            </AudienceColumn>
          </div>
        )}
      </section>

      {/* 4. Qué salió bien */}
      {s.wentWell.length > 0 && (
        <section aria-labelledby="que-funciono">
          <h3 id="que-funciono" className="mb-3 text-lg font-semibold text-slate-900">Qué salió bien</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.wentWell.map((w) => {
              const label = `${w.ok} de ${w.total} tareas salieron bien`;
              return (
                <div key={w.audience} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">{AUDIENCE_LABEL[w.audience]}</span>
                    <span className="text-sm tabular-nums text-slate-700">{label}</span>
                  </div>
                  <div className="mt-2">
                    <Meter value={w.ok} of={w.total} color={COLORS.good} label={label} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">«Salió bien» = a {Math.round(THRESHOLDS.activityOk * 10)} de cada 10 personas o más les funcionó sin problemas.</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 5. Qué opinaron (informativo) */}
      {s.opinion.length > 0 && (
        <section aria-labelledby="opinion">
          <h3 id="opinion" className="text-lg font-semibold text-slate-900">Qué opinaron de la app</h3>
          <p className="mb-3 text-sm text-slate-600">
            Promedio de lo que contestaron en la encuesta final. Solo es de referencia: no decide el resultado. En la rapidez influyen también el internet y el servidor.
          </p>
          <div className="grid gap-3 lg:grid-cols-3">
            {s.opinion.map((row) => (
              <div key={row.audience} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">{AUDIENCE_LABEL[row.audience]}</span>
                {row.general.length > 0 && <OpinionList items={row.general} />}
                {row.adopcion && (
                  <div className="mt-3 text-sm">
                    <p className="text-slate-700">¿La usarían hoy, tal como está?</p>
                    <p className="mt-0.5 text-slate-900">
                      <strong>Sí: {row.adopcion.si}</strong> · Tal vez: {row.adopcion.talvez} · No: {row.adopcion.no}
                      <span className="text-slate-500"> (de {row.adopcion.n})</span>
                    </p>
                  </div>
                )}
                {row.speed.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Rapidez y fluidez</p>
                    <OpinionList items={row.speed} />
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {s.notCounted && <p className="text-xs text-slate-500">{s.notCounted}</p>}
    </div>
  );
}
