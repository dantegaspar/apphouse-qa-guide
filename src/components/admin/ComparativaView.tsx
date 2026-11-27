import Link from "next/link";
import ComparativaButton from "@/components/admin/ComparativaButton";
import { fmtDate } from "@/lib/admin-data";
import { hasClaudeKey } from "@/lib/claude-dictamen";
import { defaultPair, loadComparison } from "@/lib/comparativa";
import {
  PREV_BUG_LABEL,
  TREND_LABEL,
  type ActivityDelta,
  type ActivitySide,
  type BugRef,
  type ComparisonFacts,
  type ComparisonRow,
  type MetricDelta,
  type PrevBugResult,
  type PrevBugStatus,
  type Trend,
} from "@/lib/comparativa-types";
import { AUDIENCE_LABEL, PLAIN_SEVERITY } from "@/lib/plain-summary";
import { listRounds, parseRoundId, viewRoundId } from "@/lib/rounds";
import { SEVERITY_CLASS } from "@/lib/types";

/**
 * «Comparativa» entre dos encuestas (componente de servidor). Arriba, en lenguaje llano para todo el personal:
 * qué mejoró, qué retrocedió y qué bugs de la encuesta pasada se solucionaron. Abajo, «Para Sistemas» con el detalle.
 * Los números salen de src/lib/comparativa.ts; Claude solo redacta.
 */

const TH = "px-3 py-2";
const NEW_BUGS_OPEN = 5;
const STATUS_ORDER: PrevBugStatus[] = ["persiste", "no_se_repitio", "sin_verificar"];
const STATUS_TONE: Record<PrevBugStatus, string> = {
  persiste: "text-red-700",
  no_se_repitio: "text-emerald-700",
  sin_verificar: "text-slate-600",
};
const TREND_CLASS: Record<Trend, string> = {
  mejoro: "bg-emerald-100 text-emerald-800",
  retrocedio: "bg-red-100 text-red-800",
  igual: "bg-slate-100 text-slate-600",
  sin_datos: "bg-slate-100 text-slate-500",
};

const short = (id: string) => id.slice(0, 8);
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const side = (s: ActivitySide) => (s.executed ? `${s.allOk}/${s.executed} · ${pct(s.okRate)}` : "—");
const verdictWord = (v: boolean | null) => (v === null ? "Sin resultado" : v ? "Sí" : "No");
const verdictClass = (v: boolean | null) => (v === null ? "text-slate-500" : v ? "text-emerald-700" : "text-red-700");

function Chip({ children, className = "bg-slate-100 text-slate-600" }: { children: React.ReactNode; className?: string }) {
  return <span className={`ml-1.5 inline-block rounded px-1.5 py-0.5 align-middle text-[11px] font-medium ${className}`}>{children}</span>;
}

function Card({ testId, title, children }: { testId: string; title: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} aria-label={title} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 print:shadow-none">
      <h3 className="mb-2 text-lg font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

/** Lista llana de indicadores y tareas con una tendencia. */
function TrendList({ metrics, activities, empty }: { metrics: MetricDelta[]; activities: ActivityDelta[]; empty: string }) {
  if (!metrics.length && !activities.length) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
      {metrics.map((m) => (
        <li key={`m-${m.id}`}>
          {m.sentence}
          {m.informative && <Chip>Solo informativo (no decide)</Chip>}
        </li>
      ))}
      {activities.map((a) => (
        <li key={`a-${a.id}`}>
          {a.sentence}
          {a.fewPeople && <Chip className="bg-amber-100 text-amber-900">pocas personas</Chip>}
        </li>
      ))}
    </ul>
  );
}

/** Junta los reportes iguales (misma tarea, gravedad y texto) para no repetirlos: «Lo reportaron 3 personas». */
function grouped<T extends BugRef>(list: T[]): { b: T; n: number }[] {
  const m = new Map<string, { b: T; n: number }>();
  for (const b of list) {
    const k = `${b.activityId}|${b.severity}|${b.description.toLowerCase()}`;
    const e = m.get(k);
    if (e) e.n++;
    else m.set(k, { b, n: 1 });
  }
  return [...m.values()];
}

function BugItem({ b, n = 1, children }: { b: BugRef; n?: number; children?: React.ReactNode }) {
  return (
    <li className="py-2">
      <p className="font-medium text-slate-900">
        {b.task} <span className="text-xs font-normal text-slate-500">· {AUDIENCE_LABEL[b.audience]}</span>
        {n > 1 && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-700">Lo reportaron {n} personas</span>}
      </p>
      <p className="text-xs text-slate-600">{PLAIN_SEVERITY[b.severity]}</p>
      {b.description && <p className="mt-0.5 text-sm text-slate-700">«{b.description}»</p>}
      {children}
    </li>
  );
}

function Stat({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className={`text-3xl font-semibold tabular-nums ${className}`}>{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  );
}

function ClaudeBox({ facts, row, stale }: { facts: ComparisonFacts; row: ComparisonRow | null; stale: boolean }) {
  const n = row?.narrative;
  const key = hasClaudeKey();
  return (
    <section aria-label="Resumen de Claude" className="rounded-2xl bg-[#2F5DA8]/5 p-5 ring-1 ring-[#2F5DA8]/20">
      <h3 className="text-lg font-semibold text-slate-900">En pocas palabras</h3>
      {n ? (
        <div className="mt-2 space-y-3 text-sm text-slate-800">
          {stale && (
            <p className="rounded-lg bg-amber-50 p-2 text-amber-900 ring-1 ring-amber-200">Los datos cambiaron desde que se redactó; vuelve a redactar.</p>
          )}
          {row.unverifiedNumbers.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-2 text-amber-900 ring-1 ring-amber-200">
              Algunas cifras del texto no salen del cálculo ({row.unverifiedNumbers.join(", ")}). Lo que cuenta son las tablas de abajo.
            </p>
          )}
          <p className="text-base">{n.resumen}</p>
          {n.puntosClave.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5">
              {n.puntosClave.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {n.recomendaciones.length > 0 && (
            <div>
              <p className="font-semibold text-slate-900">Recomendaciones</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {n.recomendaciones.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-1 text-sm text-slate-700">
          Claude puede leer los resultados de las dos encuestas y escribir en pocas líneas qué cambió. También revisa qué reportes de la encuesta nueva
          son el mismo problema que uno de la pasada.
        </p>
      )}
      {row?.error && <p className="mt-2 text-sm text-red-700">{row.error}</p>}
      <div className="mt-3">
        {key ? (
          <ComparativaButton
            base={facts.base.id}
            current={facts.current.id}
            label={n ? "Volver a redactar" : "Redactar comparativa con Claude"}
          />
        ) : (
          <p className="text-sm text-slate-600">Falta ANTHROPIC_API_KEY en el servidor; los números de abajo sí están calculados.</p>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">Claude solo redacta; los números los calcula el sistema.</p>
    </section>
  );
}

function SystemsDetail({ facts, row }: { facts: ComparisonFacts; row: ComparisonRow | null }) {
  return (
    <details className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid="cmp-sistemas">
      <summary className="cursor-pointer text-lg font-semibold text-slate-900">Para Sistemas</summary>
      <div className="mt-4 space-y-5 text-sm">
        <div>
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Actividades</h4>
          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={TH}>Código</th>
                  <th className={TH}>Tarea</th>
                  <th className={`${TH} text-right`}>Antes</th>
                  <th className={`${TH} text-right`}>Ahora</th>
                  <th className={`${TH} text-right`}>Δ pts</th>
                  <th className={TH}>Tendencia</th>
                  <th className={TH}>Muestra</th>
                </tr>
              </thead>
              <tbody>
                {facts.activities.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className={`${TH} font-mono text-xs`}>{a.id}</td>
                    <td className={TH}>{a.task}</td>
                    <td className={`${TH} text-right tabular-nums`}>{side(a.before)}</td>
                    <td className={`${TH} text-right tabular-nums`}>{side(a.after)}</td>
                    <td className={`${TH} text-right tabular-nums`}>{a.deltaPts == null ? "—" : `${a.deltaPts > 0 ? "+" : ""}${Math.round(a.deltaPts)}`}</td>
                    <td className={TH}>
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${TREND_CLASS[a.trend]}`}>{TREND_LABEL[a.trend]}</span>
                    </td>
                    <td className={`${TH} text-xs`}>{a.fewPeople ? <span className="text-amber-700">Pocas (&lt; 5)</span> : "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Bugs de la encuesta anterior</h4>
          {facts.prevBugs.length ? (
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className={TH}>Id</th>
                    <th className={TH}>Actividad</th>
                    <th className={TH}>Severidad</th>
                    <th className={TH}>Estado</th>
                    <th className={TH}>Mismo que</th>
                    <th className={TH}>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.prevBugs.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100 align-top">
                      <td className={`${TH} font-mono text-xs`}>{short(b.id)}</td>
                      <td className={`${TH} font-mono text-xs`}>{b.activityId}</td>
                      <td className={TH}>
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_CLASS[b.severity]}`}>{b.severity}</span>
                      </td>
                      <td className={`${TH} ${STATUS_TONE[b.status]}`}>{PREV_BUG_LABEL[b.status]}</td>
                      <td className={`${TH} font-mono text-xs`}>{b.sameAs.length ? b.sameAs.map(short).join(", ") : "—"}</td>
                      <td className={`${TH} text-slate-600`}>{b.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-600">La encuesta anterior no tuvo bugs del desarrollo.</p>
          )}
        </div>

        {row?.narrative?.notaSistemas && (
          <div>
            <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Nota de Claude para Sistemas</h4>
            <p className="whitespace-pre-line text-slate-700">{row.narrative.notaSistemas}</p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
          <div>
            <dt className="font-semibold">Modelo</dt>
            <dd className="font-mono">{row?.model || "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold">Redactado</dt>
            <dd>{row ? fmtDate(row.created_at) : "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold">Costo</dt>
            <dd className="font-mono">{row?.costUsd == null ? "—" : `$${row.costUsd.toFixed(2)}`}</dd>
          </div>
          <div>
            <dt className="font-semibold">Huella de datos</dt>
            <dd className="font-mono">
              {short(facts.hash)} · emparejado por {facts.matchedBy}
            </dd>
          </div>
        </dl>

        <p className="text-xs leading-relaxed text-slate-600">
          Se compara solo lo que califica el desarrollo: las mismas reglas del veredicto (solo pruebas completas, sin logística; reportes
          reclasificados como ajenos, del tester, “No es falla” o “Duplicada” no cuentan). No se usan métricas de bots ni de carga del servidor. Una
          tarea mejora o retrocede si “Todo salió bien” cambia 10 puntos o más, o si pasa de cumplir a no cumplir la meta (o al revés). Un bug de la
          encuesta pasada cuenta como solucionado si su tarea se volvió a probar y nadie reportó el mismo problema; Claude decide qué reportes son el
          mismo problema y el sistema hace las cuentas.
        </p>
      </div>
    </details>
  );
}

function Comparison({ base, current }: { base: number; current: number }) {
  const { facts, row, stale } = loadComparison(base, current);
  const up = (t: Trend) => ({ metrics: facts.metrics.filter((m) => m.trend === t), activities: facts.activities.filter((a) => a.trend === t) });
  const same = facts.metrics.filter((m) => m.trend === "igual" || m.trend === "sin_datos");
  const c = facts.bugCounts;
  const byStatus = (s: PrevBugStatus): PrevBugResult[] => facts.prevBugs.filter((b) => b.status === s);
  const newList = (
    <ul className="divide-y divide-slate-100">
      {grouped(facts.newBugs).map(({ b, n }) => (
        <BugItem key={b.id} b={b} n={n} />
      ))}
    </ul>
  );

  return (
    <>
      <section aria-label="Resultado" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-2xl font-bold text-slate-900">
          {facts.base.name} → {facts.current.name}
        </h2>
        <p className="mt-2 text-base text-slate-800">
          ¿Se puede pasar a producción? Antes: <strong className={verdictClass(facts.verdict.before)}>{verdictWord(facts.verdict.before)}</strong> · Ahora:{" "}
          <strong className={verdictClass(facts.verdict.after)}>{verdictWord(facts.verdict.after)}</strong>
        </p>
        {facts.verdict.after === null && <p className="mt-1 text-sm text-slate-500">La encuesta nueva todavía no tiene resultado.</p>}
      </section>

      {(facts.pending.base > 0 || facts.pending.current > 0) && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Hay reportes sin revisar
          {facts.pending.base > 0 && ` en ${facts.base.name} (${facts.pending.base})`}
          {facts.pending.base > 0 && facts.pending.current > 0 && " y"}
          {facts.pending.current > 0 && ` en ${facts.current.name} (${facts.pending.current})`}. Los números pueden cambiar cuando Sistemas los revise (
          <Link href="/admin/veredicto?vista=sistemas" className="font-medium underline">
            revisar
          </Link>
          ).
        </p>
      )}

      <ClaudeBox facts={facts} row={row} stale={stale} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card testId="cmp-mejoro" title="¿Qué mejoró?">
          <TrendList {...up("mejoro")} empty="Nada cambió para bien de forma clara." />
        </Card>
        <Card testId="cmp-retroceso" title="¿Se tuvo un retroceso?">
          <TrendList {...up("retrocedio")} empty="No hubo retrocesos." />
        </Card>
      </div>

      <Card testId="cmp-bugs" title="¿Se solucionaron los bugs de la encuesta pasada?">
        {c.previous === 0 ? (
          <p className="text-sm text-slate-600">La encuesta pasada no tuvo problemas de la app.</p>
        ) : (
          <p className="mb-3 text-sm text-slate-600">
            La encuesta pasada tuvo {c.previous} {c.previous === 1 ? "problema" : "problemas"} de la app.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat value={c.solved} label="Solucionados" className="text-emerald-700" />
          <Stat value={c.persist} label="Siguen pasando" className="text-red-700" />
          <Stat value={c.unverified} label="Sin verificar" className="text-slate-700" />
          <Stat value={c.new} label="Nuevos" className="text-amber-700" />
        </div>

        {STATUS_ORDER.map((s) => {
          const list = byStatus(s);
          if (!list.length) return null;
          return (
            <div key={s} className="mt-4">
              <h4 className={`text-sm font-semibold ${STATUS_TONE[s]}`}>
                {PREV_BUG_LABEL[s]} · {list.length}
              </h4>
              <ul className="divide-y divide-slate-100">
                {grouped(list).map(({ b, n }) => (
                  <BugItem key={b.id} b={b} n={n}>
                    <p className="mt-0.5 text-xs text-slate-500">
                      La probaron {b.retestedBy} {b.retestedBy === 1 ? "persona" : "personas"} en la encuesta nueva
                    </p>
                  </BugItem>
                ))}
              </ul>
            </div>
          );
        })}

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-slate-900">Problemas nuevos · {facts.newBugs.length}</h4>
          {!facts.newBugs.length ? (
            <p className="text-sm text-slate-600">No apareció ningún problema nuevo.</p>
          ) : facts.newBugs.length > NEW_BUGS_OPEN ? (
            <details>
              <summary className="cursor-pointer text-sm text-[#2F5DA8] hover:underline">Ver los {facts.newBugs.length} problemas nuevos</summary>
              {newList}
            </details>
          ) : (
            newList
          )}
        </div>

        {facts.matchedBy === "tarea" && (
          <p className="mt-3 text-xs text-slate-500">
            Sin Claude, se comparó por tarea: si en la misma tarea hay un problema nuevo, se toma como que sigue pasando.
          </p>
        )}
      </Card>

      {same.length > 0 && (
        <section aria-label="Sin cambios" className="text-sm text-slate-600">
          <h3 className="font-semibold text-slate-700">Sin cambios</h3>
          <ul className="mt-1 space-y-0.5">
            {same.map((m) => (
              <li key={m.id}>
                {m.sentence}
                {m.trend === "sin_datos" && <Chip>{TREND_LABEL.sin_datos}</Chip>}
                {m.informative && <Chip>Solo informativo (no decide)</Chip>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SystemsDetail facts={facts} row={row} />
    </>
  );
}

export function ComparativaView({ antes, ahora }: { antes?: string; ahora?: string }) {
  const rounds = listRounds();
  if (rounds.length < 2)
    return (
      <section data-testid="comparativa" className="rounded-2xl bg-slate-50 p-6 text-slate-700 ring-1 ring-slate-200">
        <p>Para comparar hace falta al menos dos encuestas. Abre una nueva desde la barra de arriba.</p>
      </section>
    );

  const pair = defaultPair(viewRoundId());
  const current = parseRoundId(ahora) ?? pair.current;
  const base = parseRoundId(antes) ?? (ahora ? defaultPair(current).base : pair.base) ?? rounds.find((r) => r.id !== current)!.id;
  const sel = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

  return (
    <div data-testid="comparativa" className="space-y-5">
      <form method="get" action="/admin/veredicto" className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <input type="hidden" name="vista" value="comparativa" />
        <label className="min-w-48 flex-1 text-sm font-medium text-slate-700">
          Encuesta anterior
          <select name="antes" defaultValue={String(base)} className={sel}>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {fmtDate(r.created_at)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-48 flex-1 text-sm font-medium text-slate-700">
          Encuesta nueva
          <select name="ahora" defaultValue={String(current)} className={sel}>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {fmtDate(r.created_at)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-[#2F5DA8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264d8c]">
          Comparar
        </button>
      </form>

      {base === current ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Elegiste la misma encuesta en los dos lados. Elige dos encuestas distintas para compararlas.
        </p>
      ) : (
        <Comparison base={base} current={current} />
      )}
    </div>
  );
}
