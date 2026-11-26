import Link from "next/link";
import PhotoGallery from "@/components/admin/PhotoGallery";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getGuide, GUIDES } from "@/lib/guides";
import { ACTIVITY_RESULTS } from "@/lib/types";
import {
  deviceSummary, fmtDate, guideTitle, isImage, loadAll, loadOpenHelp, loadOtherRoundsActivity, OTHER_ROUND_ACTIVE_MIN, parseRec, runStatusClass,
  runStatusLabel, timeAgo,
} from "@/lib/admin-data";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { CourierAdminSection } from "@/components/admin/CourierSection";
import { ExportButton } from "@/components/admin/ExportButton";
import { HelpRequestWatcher } from "@/components/admin/HelpRequestWatcher";
import { OtherRoundsAlert } from "@/components/admin/OtherRoundsAlert";
import { InsightsPanel } from "@/components/admin/InsightsPanel";
import { Coachmark } from "@/components/feedback";
import { computeInsights } from "@/lib/insights";
import IssueTriage from "@/components/admin/IssueTriage";

export const dynamic = "force-dynamic";

const EXPORTS: [string, string][] = [
  ["runs", "Corridas"],
  ["steps", "Pasos"],
  ["activities", "Actividades"],
  ["issues", "Reportes"],
  ["survey", "Encuesta"],
  ["help", "Solicitudes de ayuda"],
];
const RESULT_KEYS = ["ok", "issue", "blocked", "skipped"] as const;

function Kpi({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className={`text-3xl font-bold ${tone || "text-[#2F5DA8]"}`}>{value}</div>
      <div className="text-sm text-slate-600">{label}</div>
    </div>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { guide: guideParam } = await searchParams;
  const guideId = guideParam && getGuide(guideParam) ? guideParam : null;
  const d = loadAll(guideId);
  const qs = guideId ? `?guide=${encodeURIComponent(guideId)}` : "";

  const finished = d.runs.filter((r) => r.status === "finished" || r.status === "ended_blocked").length;
  const blocking = d.issues.filter((i) => i.blocking).length;
  const guideIds = [...new Set(d.runs.map((r) => r.guide_id))].filter((id) => getGuide(id));
  const attachmentsByIssue = new Map<string, typeof d.attachments>();
  for (const a of d.attachments) attachmentsByIssue.set(a.issue_id, [...(attachmentsByIssue.get(a.issue_id) ?? []), a]);
  const runById = new Map(d.runs.map((r) => [r.id, r]));
  // Las solicitudes abiertas se muestran siempre, sin importar el filtro de guía ni la ronda a la vista
  const { rows: openHelp, at: nowMs } = loadOpenHelp();
  const otherRounds = loadOtherRoundsActivity(nowMs);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 h-1.5 w-16 rounded-full bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8]" />
          <h1 className="text-2xl font-bold text-slate-900">Panel de administración</h1>
          <p className="text-sm text-slate-600">Resultados de las pruebas de AppHouse</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="w-full text-xs text-slate-400 sm:w-auto">Se actualiza solo cada 20 s · {fmtDate(new Date(nowMs).toISOString())}</span>
          <Link href={`/admin/mesa${qs}`} className="rounded-lg bg-[#2F5DA8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#274f8f]">Mesa de control</Link>
          <a href="#repartidores" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#2F5DA8] hover:bg-slate-50">Repartidores</a>
          <Link href={`/admin/graficas${qs}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#2F5DA8] hover:bg-slate-50">Gráficas</Link>
          <Link href="/admin/veredicto" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#2F5DA8] hover:bg-slate-50">¿Listo para producción?</Link>
          <LogoutButton />
        </div>
      </header>
      <AutoRefresh seconds={20} />
      <HelpRequestWatcher
        open={openHelp.map((h) => {
          const act = getGuide(h.guide_id)?.activities.find((a) => a.id === h.activity_id);
          return { id: h.id, tester: h.tester, where: act ? `${h.activity_id} ${act.title}` : h.activity_id || "la guía" };
        })}
      />
      <OtherRoundsAlert rounds={otherRounds} activeMinutes={OTHER_ROUND_ACTIVE_MIN} />

      <section
        id="ayuda"
        data-testid="help-requests"
        className={`rounded-xl p-4 ring-2 ${openHelp.length ? "bg-red-50 ring-red-300" : "bg-white ring-slate-200"}`}
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          Solicitudes de ayuda
          <span
            className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-sm font-bold ${
              openHelp.length ? "animate-pulse bg-red-600 text-white" : "bg-slate-100 text-slate-500"
            }`}
            data-testid="help-count"
          >
            {openHelp.length}
          </span>
        </h2>
        {openHelp.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Nadie está esperando ayuda.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {openHelp.map((h) => {
              const g = getGuide(h.guide_id);
              const act = g?.activities.find((a) => a.id === h.activity_id);
              const stepIdx = act && h.step_id ? act.steps.findIndex((s) => s.id === h.step_id) : -1;
              return (
                <li key={h.id} className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-red-200">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <Link href={`/admin/runs/${h.run_id}`} className="font-semibold text-[#2F5DA8] hover:underline">
                      {h.tester}
                    </Link>
                    <span className="text-slate-600">{g?.title ?? h.guide_id}</span>
                    {h.other_round && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900" data-testid="help-round" title="Esta prueba es de otra encuesta">
                        {h.round_name}
                      </span>
                    )}
                    <span className="font-medium text-slate-800">
                      {h.activity_id} {act?.title}
                      {stepIdx >= 0 ? ` · paso ${stepIdx + 1}` : ""}
                    </span>
                    <span className="ml-auto font-semibold text-red-700">{timeAgo(h.created_at, nowMs)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{h.reason}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filtrar por guía">
        {[{ id: "", title: "Todas las guías" }, ...GUIDES].map((g) => (
          <Link
            key={g.id}
            href={g.id ? `/admin?guide=${encodeURIComponent(g.id)}` : "/admin"}
            className={`rounded-full px-3 py-1.5 font-medium ring-1 ${
              (guideId ?? "") === g.id ? "bg-[#2F5DA8] text-white ring-[#2F5DA8]" : "bg-white text-slate-700 ring-slate-300"
            }`}
          >
            {g.title}
          </Link>
        ))}
      </nav>

      <InsightsPanel insights={computeInsights(guideId, nowMs)} exportQs={qs} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Testers / corridas" value={d.runs.length} />
        <Kpi label="Terminadas" value={finished} tone="text-emerald-600" />
        <Kpi label="Reportes" value={d.issues.length} tone="text-amber-600" />
        <Kpi label="Reportes bloqueantes" value={blocking} tone="text-red-600" />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Descargar datos</h2>
        <div className="flex flex-wrap gap-2">
          <Coachmark id="admin-excel" inline message="Aquí bajas todos los resultados en un solo Excel, una hoja por tabla.">
            <ExportButton
              href={`/api/admin/export/xlsx${qs}`}
              label="Excel"
              className="inline-block rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
            >
              Excel (todo, una hoja por tabla)
            </ExportButton>
          </Coachmark>
          {EXPORTS.map(([k, label]) => (
            <ExportButton
              key={k}
              href={`/api/admin/export/${k}${qs}`}
              label={`CSV de ${label}`}
              className="rounded-lg bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8] px-3 py-2 text-sm font-medium text-white"
            >
              {label}
            </ExportButton>
          ))}
        </div>
      </section>

      {guideIds.map((gid) => {
        const g = getGuide(gid)!;
        const runIds = new Set(d.runs.filter((r) => r.guide_id === gid).map((r) => r.id));
        return (
          <section key={gid}>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Matriz de actividades · {g.title}</h2>
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Actividad</th>
                    {RESULT_KEYS.map((k) => (
                      <th key={k} className="px-3 py-2 text-center" title={ACTIVITY_RESULTS[k]}>
                        {k === "ok" ? "OK" : k === "issue" ? "Falla" : k === "blocked" ? "Bloqueada" : "No le tocó"}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center">Pendiente</th>
                    <th className="px-3 py-2 text-center">Pasos con falla</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {g.activities.map((a) => {
                    const res = d.activities.filter((x) => x.activity_id === a.id && runIds.has(x.run_id));
                    const counts = Object.fromEntries(RESULT_KEYS.map((k) => [k, res.filter((x) => x.result === k).length]));
                    const answered = res.filter((x) => x.result && x.result in ACTIVITY_RESULTS).length;
                    const failSteps = d.steps.filter((s) => s.activity_id === a.id && s.outcome === "fail" && runIds.has(s.run_id)).length;
                    return (
                      <tr key={a.id}>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-slate-500">{a.id}</span> {a.title}
                        </td>
                        {RESULT_KEYS.map((k) => (
                          <td key={k} className={`px-3 py-2 text-center ${counts[k] ? "font-semibold" : "text-slate-300"}`}>{counts[k]}</td>
                        ))}
                        <td className="px-3 py-2 text-center text-slate-500">{runIds.size - answered}</td>
                        <td className={`px-3 py-2 text-center ${failSteps ? "font-semibold text-red-600" : "text-slate-300"}`}>{failSteps}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Corridas</h2>
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {["Nombre", "Correo", "Rol", "Dispositivo", "Avance", "Reportes", "Estado", "Actualizada"].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.runs.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Todavía no hay corridas.</td></tr>
              )}
              {d.runs.map((r) => {
                const total = getGuide(r.guide_id)?.activities.reduce((n, a) => n + a.steps.length, 0) || 1;
                const done = d.steps.filter((s) => s.run_id === r.id).length;
                const pct = Math.min(100, Math.round((done / total) * 100));
                const n = d.issues.filter((i) => i.run_id === r.id).length;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/admin/runs/${r.id}`} className="text-[#2F5DA8] hover:underline">{r.name}</Link>
                    </td>
                    <td className="px-3 py-2">{r.email}</td>
                    <td className="px-3 py-2">{r.role}</td>
                    <td className="px-3 py-2 text-slate-600">{deviceSummary(parseRec(r.device), parseRec(r.tester_fields))}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">{n}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${runStatusClass(r.status)}`} title={r.ended_reason || undefined}>
                        {runStatusLabel(r.status)}
                      </span>
                      {d.help.some((h) => h.run_id === r.id && h.status === "open") && (
                        <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Pide ayuda</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fmtDate(r.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Reportes recientes</h2>
        <ul className="space-y-3">
          {d.issues.length === 0 && <li className="text-sm text-slate-500">Sin reportes.</li>}
          {d.issues.slice(0, 30).map((i) => {
            const r = runById.get(i.run_id)!;
            const act = getGuide(r.guide_id)?.activities.find((a) => a.id === i.activity_id);
            const atts = attachmentsByIssue.get(i.id) ?? [];
            return (
              <li key={i.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Link href={`/admin/runs/${r.id}`} className="font-semibold text-[#2F5DA8] hover:underline">{r.name}</Link>
                  <span>· {i.activity_id} {act?.title}{i.step_id ? ` · paso ${i.step_id}` : ""}</span>
                  <span>· {fmtDate(i.created_at)}</span>
                  {i.kind === "evidence" && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">evidencia</span>}
                  {i.kind === "issue" && <IssueTriage id={i.id} severity={i.severity} triage={i.triage} bugType={i.bug_type ?? ""} />}
                  {i.order_number && <span>· pedido {i.order_number}</span>}
                </div>
                {i.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{i.description}</p>}
                {i.expected && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-500">Esperaba: {i.expected}</p>}
                {atts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <PhotoGallery photos={atts.filter((a) => isImage(a.mime)).map((a) => ({ id: a.id, src: `/api/admin/files/${a.id}`, name: a.original_name }))}>
                      {atts
                        .filter((a) => !isImage(a.mime))
                        .map((a) => (
                          <a key={a.id} href={`/api/admin/files/${a.id}`} target="_blank" rel="noreferrer" className="block">
                            <span className="inline-flex h-20 items-center rounded-lg bg-slate-100 px-3 text-xs text-slate-700 ring-1 ring-slate-200">{a.original_name}</span>
                          </a>
                        ))}
                    </PhotoGallery>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <CourierAdminSection />
      <p className="text-xs text-slate-400">{guideId ? guideTitle(guideId) : "Todas las guías"}</p>
    </main>
  );
}
