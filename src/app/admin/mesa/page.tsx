import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getGuide, GUIDES } from "@/lib/guides";
import {
  ABANDON_MIN, fmtDate, guideShortTitle, loadMesa, loadOpenHelp, loadOtherRoundsActivity, MESA_STATE, OTHER_ROUND_ACTIVE_H, qaTiles, STALL_MIN, timeAgo,
  type MesaRow, type MesaState,
} from "@/lib/admin-data";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { HelpRequestWatcher } from "@/components/admin/HelpRequestWatcher";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { OtherRoundsAlert } from "@/components/admin/OtherRoundsAlert";
import { QaGrid } from "@/components/admin/QaGrid";

export const dynamic = "force-dynamic";

/** Monitoreo en tiempo real: el refresco (router.refresh) no recarga la página ni parpadea. */
const REFRESH_S = 5;
const done = (r: MesaRow) => r.state === "finished" || r.state === "ended_blocked";
const late = (r: MesaRow) => !done(r) && r.minsSinceSave > STALL_MIN;

function StateChip({ r }: { r: MesaRow }) {
  const s = MESA_STATE[r.state];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}
      title={r.state === "help" ? r.openHelp?.reason || undefined : undefined}
    >
      {r.state === "stalled" ? `Sin avance +${STALL_MIN} min` : r.state === "help" && r.openHelp ? `Pide ayuda · ${r.openHelp.minsOpen} min` : s.label}
    </span>
  );
}

function Current({ r }: { r: MesaRow }) {
  const c = r.progress.current;
  if (!c) return <span className="text-slate-400">Aún no empieza</span>;
  const prefix = done(r) ? "Última: " : c.mode === "working" ? "" : c.mode === "next" ? "Sigue: " : "Última: ";
  return (
    <span className="min-w-0">
      <span className="text-slate-500">{prefix}</span>
      <span className="font-mono text-xs font-semibold text-slate-700">{c.id}</span>{" "}
      <span className="text-slate-800">{c.title || <em className="text-slate-400">(ya no está en la guía)</em>}</span>
    </span>
  );
}

function Progress({ r }: { r: MesaRow }) {
  const { saved, total } = r.progress;
  const pct = total ? Math.round((saved / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={`${saved} de ${total} actividades guardadas`}>
      <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${r.state === "finished" ? "bg-emerald-500" : "bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8]"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs tabular-nums text-slate-700">
        <span className="font-semibold">{saved}</span>/{total}
      </span>
    </div>
  );
}

function LastSaved({ r, nowMs }: { r: MesaRow; nowMs: number }) {
  const at = r.progress.lastSavedAt;
  return (
    <span className={`whitespace-nowrap ${late(r) ? "font-semibold text-red-700" : "text-slate-600"}`} title={at ? fmtDate(at) : undefined}>
      {at ? timeAgo(at, nowMs) : <>Sin guardar · empezó {timeAgo(r.run.created_at, nowMs)}</>}
    </span>
  );
}

function Failures({ r }: { r: MesaRow }) {
  if (!r.failures) return <span className="text-slate-300">0</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-slate-800">{r.failures}</span>
      {r.blocking > 0 && <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">{r.blocking} bloq.</span>}
    </span>
  );
}

function Who({ r }: { r: MesaRow }) {
  return (
    <div className="min-w-0">
      <Link href={`/admin/runs/${r.run.id}`} className="font-semibold text-[#2F5DA8] hover:underline">{r.run.name}</Link>
      <div className="text-xs text-slate-500">
        {r.guideTitle}
        {r.branch && <> · <span className="font-medium text-slate-700">{r.branch}</span></>}
        {r.fields && <> · {r.fields}</>}
      </div>
    </div>
  );
}

const SUMMARY: { key: MesaState; label: string; tone: string }[] = [
  { key: "help", label: "Piden ayuda", tone: "text-red-600" },
  { key: "stalled", label: `Sin avance +${STALL_MIN} min`, tone: "text-amber-600" },
  { key: "active", label: "Avanzando", tone: "text-sky-700" },
  { key: "abandoned", label: "Abandonadas", tone: "text-slate-500" },
  { key: "finished", label: "Terminadas", tone: "text-emerald-600" },
];

export default async function MesaPage({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { guide: guideParam } = await searchParams;
  const guideId = guideParam && getGuide(guideParam) ? guideParam : null;
  const qs = guideId ? `?guide=${encodeURIComponent(guideId)}` : "";
  const { rows, at: nowMs } = loadMesa(guideId);
  const countOf = (k: MesaState) => rows.filter((r) => r.state === k || (k === "finished" && r.state === "ended_blocked")).length;
  const firstCalm = rows.findIndex((r) => !r.reason);
  // La tabla es solo de la ronda a la vista; lo que sigue vivo en otras rondas (y sus solicitudes de ayuda) va en un aviso
  const otherRounds = loadOtherRoundsActivity(nowMs);
  const otherHelp = loadOpenHelp().rows.filter((h) => h.other_round);
  const whereOf = (guideId: string, activityId: string) => {
    const act = getGuide(guideId)?.activities.find((a) => a.id === activityId);
    return act ? `${act.id} ${act.title}` : activityId || "la guía";
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-3 py-5 sm:px-4 sm:py-6">
      <AutoRefresh seconds={REFRESH_S} />
      <HelpRequestWatcher
        open={[
          ...rows.filter((r) => r.openHelp).map((r) => ({ id: r.openHelp!.id, tester: r.run.name, where: whereOf(r.run.guide_id, r.openHelp!.activity_id) })),
          ...otherHelp.map((h) => ({ id: h.id, tester: h.tester, where: `${whereOf(h.guide_id, h.activity_id)} («${h.round_name}»)` })),
        ]}
      />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 h-1.5 w-16 rounded-full bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8]" />
          <h1 className="text-2xl font-bold text-slate-900">Mesa de control</h1>
          <p className="text-sm text-slate-600">Quién va en qué, en vivo. Primero los que necesitan atención.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full text-xs text-slate-400 sm:w-auto">
            <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500 align-middle" aria-hidden />
            En vivo · cada {REFRESH_S} s · {new Date(nowMs).toLocaleTimeString("es-MX", { timeStyle: "short" })}
          </span>
          <Link href={`/admin${qs}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">← Panel</Link>
          <Link href={`/admin/graficas${qs}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#2F5DA8] hover:bg-slate-50">Gráficas</Link>
          <LogoutButton />
        </div>
      </header>

      <OtherRoundsAlert
        rounds={otherRounds}
        activeHours={OTHER_ROUND_ACTIVE_H}
        help={otherHelp.map((h) => ({
          id: h.id,
          runId: h.run_id,
          tester: h.tester,
          where: whereOf(h.guide_id, h.activity_id),
          ago: timeAgo(h.created_at, nowMs),
          roundId: h.round_id,
        }))}
      />

      <nav className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Filtrar por guía">
        {[{ id: "", title: "Todas las guías" }, ...GUIDES].map((g) => (
          <Link
            key={g.id}
            href={g.id ? `/admin/mesa?guide=${encodeURIComponent(g.id)}` : "/admin/mesa"}
            className={`shrink-0 rounded-full px-3 py-1.5 font-medium ring-1 ${
              (guideId ?? "") === g.id ? "bg-[#2F5DA8] text-white ring-[#2F5DA8]" : "bg-white text-slate-700 ring-slate-300"
            }`}
          >
            {g.title}
          </Link>
        ))}
      </nav>

      <section aria-label="Resumen" className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
        {SUMMARY.map((s) => (
          <div key={s.key} className="rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200">
            <div className={`text-2xl font-bold tabular-nums ${s.tone}`}>{countOf(s.key)}</div>
            <div className="text-xs leading-tight text-slate-600">{s.label}</div>
          </div>
        ))}
      </section>

      {rows.length > 0 && (
        <QaGrid
          tiles={qaTiles(rows)}
          at={nowMs}
          refreshS={REFRESH_S}
          guides={GUIDES.map((g) => ({ id: g.id, title: guideShortTitle(g.id) }))}
          grouped={!guideId}
        />
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">Todavía no hay testers.</p>
      ) : (
        <>
          {/* Escritorio / tableta: tabla */}
          <div className="hidden overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200 md:block">
            <table className="w-full min-w-[900px] text-left text-sm" data-testid="mesa-table">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {["Estado", "Tester", "Dispositivo", "Actividad actual", "Avance", "Último guardado", "Fallas"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr
                    key={r.run.id}
                    className={`align-top ${r.state === "help" ? "bg-red-50" : r.state === "stalled" ? "bg-amber-50/60" : ""} ${i === firstCalm && i > 0 ? "border-t-4 border-slate-100" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <StateChip r={r} />
                        {r.state === "help" && r.openHelp?.reason && <span className="line-clamp-2 text-xs text-red-800">{r.openHelp.reason}</span>}
                        {r.reason && r.state !== "help" && <span className="text-xs text-slate-500">{r.reason}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><Who r={r} /></td>
                    <td className="max-w-[14rem] px-3 py-2.5 text-xs text-slate-600">{r.device || "—"}</td>
                    <td className="max-w-[18rem] px-3 py-2.5"><Current r={r} /></td>
                    <td className="px-3 py-2.5"><Progress r={r} /></td>
                    <td className="px-3 py-2.5"><LastSaved r={r} nowMs={nowMs} /></td>
                    <td className="px-3 py-2.5"><Failures r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Teléfono: tarjetas */}
          <ul className="space-y-2 md:hidden" data-testid="mesa-cards">
            {rows.map((r) => (
              <li
                key={r.run.id}
                className={`rounded-xl p-3 shadow-sm ring-1 ${r.state === "help" ? "bg-red-50 ring-red-300" : r.state === "stalled" ? "bg-amber-50/60 ring-amber-200" : "bg-white ring-slate-200"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <Who r={r} />
                  <div className="shrink-0">
                    <StateChip r={r} />
                  </div>
                </div>
                {r.state === "help" && r.openHelp?.reason && <p className="mt-1.5 text-sm text-red-800">«{r.openHelp.reason}»</p>}
                <div className="mt-2 text-sm"><Current r={r} /></div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                  <Progress r={r} />
                  <span className="text-xs text-slate-500">{r.progress.lastSavedAt ? "Guardó " : ""}<LastSaved r={r} nowMs={nowMs} /></span>
                  <span className="text-xs text-slate-500">Fallas: <Failures r={r} /></span>
                </div>
                {(r.device || (r.reason && r.state !== "help")) && (
                  <div className="mt-1.5 text-xs text-slate-500">
                    {r.reason && r.state !== "help" && <span className="font-medium text-slate-600">{r.reason}</span>}
                    {r.reason && r.state !== "help" && r.device && " · "}
                    {r.device}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-slate-400">
        «Sin avance»: más de {STALL_MIN} min sin guardar una actividad. «Abandonada»: más de {ABANDON_MIN} min sin ninguna actividad y sin terminar.
      </p>
    </main>
  );
}
