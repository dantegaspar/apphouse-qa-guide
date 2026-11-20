import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getGuide } from "@/lib/guides";
import {
  checkValue, fmtDate, guideTitle, HELP_STATUS, isImage, isVideo, parseRec, resultLabel, runStatusLabel,
  type ActivityRow, type AttachmentRow, type HelpRow, type IssueRow, type RunRow, type StepRow,
} from "@/lib/admin-data";

export const dynamic = "force-dynamic";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

const fmtVal = (v: unknown) => (typeof v === "boolean" ? (v ? "Sí" : "No") : String(v));

function KV({ data, labels }: { data: Record<string, unknown>; labels?: Map<string, string> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== "" && v !== null);
  if (!entries.length) return <p className="text-sm text-slate-500">Sin datos.</p>;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{labels?.get(k) ?? k}</dt>
          <dd className="break-words text-slate-900">{fmtVal(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await params;
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  if (!run) notFound();
  const guide = getGuide(run.guide_id);
  const steps = db.prepare("SELECT run_id, activity_id, step_id, outcome FROM step_results WHERE run_id = ?").all(id) as StepRow[];
  const acts = db.prepare("SELECT * FROM activity_results WHERE run_id = ?").all(id) as ActivityRow[];
  const issues = db.prepare("SELECT * FROM issues WHERE run_id = ? ORDER BY created_at").all(id) as IssueRow[];
  const atts = db.prepare("SELECT id, run_id, issue_id, original_name, mime, size FROM attachments WHERE run_id = ? ORDER BY created_at").all(id) as AttachmentRow[];
  const help = db.prepare("SELECT * FROM help_requests WHERE run_id = ? ORDER BY created_at").all(id) as HelpRow[];
  const survey = db.prepare("SELECT answers FROM survey_responses WHERE run_id = ?").get(id) as { answers: string } | undefined;

  const prep = parseRec(run.prep);
  const finish = parseRec(run.finish);
  const device = parseRec(run.device);
  const testerLabels = new Map((guide?.tester.fields ?? []).map((f) => [f.id, f.label]));

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <Link href="/admin" className="text-sm text-[#2F5DA8] hover:underline">← Volver al panel</Link>

      <header className="rounded-xl bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8] p-5 text-white">
        <h1 className="text-2xl font-bold">{run.name}</h1>
        <p className="text-sm opacity-90">{run.email} · {run.role}</p>
        <p className="mt-1 text-xs opacity-80">
          {guideTitle(run.guide_id)} (v{run.guide_version}) · {runStatusLabel(run.status)} · creada {fmtDate(run.created_at)} · actualizada {fmtDate(run.updated_at)}
          {run.finished_at ? ` · terminó ${fmtDate(run.finished_at)}` : ""}
        </p>
      </header>

      {run.status === "ended_blocked" && (
        <section className="rounded-xl bg-red-50 p-4 ring-2 ring-red-300">
          <h2 className="font-semibold text-red-900">Prueba terminada por bloqueo</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-red-900">{run.ended_reason || "Sin motivo"}</p>
          {run.ended_at && <p className="mt-1 text-xs text-red-700">{fmtDate(run.ended_at)}</p>}
        </section>
      )}

      {help.length > 0 && (
        <Card title={`Solicitudes de ayuda (${help.length})`}>
          <ul className="space-y-2">
            {help.map((h) => {
              const act = guide?.activities.find((a) => a.id === h.activity_id);
              const stepIdx = act && h.step_id ? act.steps.findIndex((s) => s.id === h.step_id) : -1;
              return (
                <li key={h.id} className="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        h.status === "open" ? "bg-red-600 text-white" : h.status === "resolved" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                      }`}
                    >
                      {HELP_STATUS[h.status] ?? h.status}
                    </span>
                    <span className="font-semibold text-slate-700">
                      {h.activity_id} {act?.title}
                      {stepIdx >= 0 ? ` · paso ${stepIdx + 1}` : ""}
                    </span>
                    <span>pedida {fmtDate(h.created_at)}</span>
                    {h.resolved_at && <span>· cerrada {fmtDate(h.resolved_at)}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{h.reason}</p>
                  {h.resolution && <p className="mt-1 text-xs text-slate-500">{h.resolution}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Tester y dispositivo">
        <KV data={{ ...parseRec(run.tester_fields) }} labels={testerLabels} />
        <div className="my-3 border-t border-slate-100" />
        <KV data={device} />
      </Card>

      {guide && (
        <Card title="Preparación">
          <ul className="space-y-1 text-sm">
            {guide.prep.checklist.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className={prep[c.id] ? "text-emerald-600" : "text-slate-400"}>{prep[c.id] ? "✓" : "○"}</span>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {guide?.activities.map((a) => {
        const ar = acts.find((x) => x.activity_id === a.id);
        const checks = parseRec(ar?.checks);
        const fieldVals = parseRec(ar?.fields);
        const fieldLabels = new Map((a.fields ?? []).map((f) => [f.id, f.label]));
        const aIssues = issues.filter((i) => i.activity_id === a.id);
        return (
          <Card key={a.id} title={`${a.id} · ${a.title}`}>
            <p className="mb-3">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                ar?.result === "ok" ? "bg-emerald-100 text-emerald-800"
                : ar?.result === "issue" ? "bg-red-100 text-red-800"
                : ar?.result === "blocked" ? "bg-amber-100 text-amber-800"
                : "bg-slate-100 text-slate-600"}`}>
                {resultLabel(ar?.result)}
              </span>
            </p>
            <ol className="space-y-1.5 text-sm">
              {a.steps.map((s, idx) => {
                const o = steps.find((x) => x.activity_id === a.id && x.step_id === s.id)?.outcome;
                return (
                  <li key={s.id} className="flex gap-2">
                    <span className={`w-4 shrink-0 text-center font-bold ${o === "ok" ? "text-emerald-600" : o === "fail" ? "text-red-600" : "text-slate-300"}`}>
                      {o === "ok" ? "✓" : o === "fail" ? "✗" : "·"}
                    </span>
                    <span className="text-slate-800"><span className="text-slate-400">{idx + 1}.</span> {s.text.replace(/\*\*/g, "")}</span>
                  </li>
                );
              })}
            </ol>
            {a.expected.length > 0 && (
              <div className="mt-3">
                <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Qué debería pasar</h3>
                <ul className="space-y-1 text-sm">
                  {a.expected.map((t, i) => {
                    const v = checkValue(checks, i, t);
                    return (
                      <li key={i} className="flex gap-2">
                        <span className={v === undefined ? "text-slate-300" : v ? "text-emerald-600" : "text-red-600"}>{v === undefined ? "·" : v ? "✓" : "✗"}</span>
                        <span>{t.replace(/\*\*/g, "")}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {Object.keys(fieldVals).length > 0 && (
              <div className="mt-3"><KV data={fieldVals} labels={fieldLabels} /></div>
            )}
            {ar?.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{ar.notes}</p>}
            {aIssues.map((i) => (
              <div key={i.id} className="mt-3 rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm">
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{i.kind === "evidence" ? "Evidencia" : "Reporte"}{i.step_id ? ` · paso ${i.step_id}` : ""}</span>
                  {i.blocking ? <span className="rounded bg-red-100 px-1.5 font-medium text-red-800">bloqueante</span> : null}
                  {i.order_number && <span>pedido {i.order_number}</span>}
                  <span>{fmtDate(i.created_at)}</span>
                </div>
                {i.description && <p className="mt-1 whitespace-pre-wrap">{i.description}</p>}
                {i.expected && <p className="mt-1 whitespace-pre-wrap text-slate-500">Esperaba: {i.expected}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {atts.filter((x) => x.issue_id === i.id).map((x) => {
                    const src = `/api/admin/files/${x.id}`;
                    if (isImage(x.mime))
                      return (
                        <a key={x.id} href={src} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={x.original_name} loading="lazy" className="max-h-64 max-w-full rounded-lg ring-1 ring-slate-200" />
                        </a>
                      );
                    if (isVideo(x.mime))
                      return <video key={x.id} src={src} controls preload="metadata" className="max-h-72 max-w-full rounded-lg" />;
                    return (
                      <a key={x.id} href={`${src}?download=1`} className="rounded-lg bg-white px-3 py-2 text-xs text-[#2F5DA8] ring-1 ring-slate-200">
                        {x.original_name}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        );
      })}

      {guide && (
        <Card title="Cierre">
          <ul className="space-y-1 text-sm">
            {guide.finish.checklist.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className={finish[c.id] ? "text-emerald-600" : "text-slate-400"}>{finish[c.id] ? "✓" : "○"}</span>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Encuesta">
        {!survey || !guide ? (
          <p className="text-sm text-slate-500">Aún no respondió la encuesta.</p>
        ) : (
          <dl className="space-y-3 text-sm">
            {guide.survey.questions.map((q) => {
              const v = parseRec(survey.answers)[q.id];
              return (
                <div key={q.id}>
                  <dt className="text-slate-500">{q.label}</dt>
                  <dd className="whitespace-pre-wrap font-medium text-slate-900">{v === undefined || v === "" ? "—" : fmtVal(v)}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </Card>
    </main>
  );
}
