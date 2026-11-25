"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback";
import { TRIAGE } from "@/lib/types";
import type { CriticalFinding } from "@/lib/verdict";

type Decision = "aceptado" | "descartado";

/** Un hallazgo crítico: Mesa lo acepta (cuenta en el veredicto) o lo descarta (sale), siempre con motivo. */
function Row({ f }: { f: CriticalFinding }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | "">(f.decision);
  const [note, setNote] = useState(f.decision ? f.note : "");
  const [busy, setBusy] = useState(false);
  const dirty = decision !== f.decision || (decision !== "" && note.trim() !== f.note);
  const canSave = decision !== "" && note.trim().length >= 3 && dirty;

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/issues/${f.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ triage: decision === "aceptado" ? "confirmada" : "descartada", note: note.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se guardó");
      toast.success(decision === "aceptado" ? "Hallazgo aceptado: cuenta en el veredicto." : "Hallazgo descartado: ya no cuenta en el veredicto.", { id: `crit-${f.id}` });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se guardó", { id: `crit-${f.id}` });
    } finally {
      setBusy(false);
    }
  };

  const name = `crit-${f.id}`;
  return (
    <li
      data-testid="critical-finding"
      className={`rounded-lg p-3 ring-1 ${
        f.decision === "aceptado" ? "bg-red-50 ring-red-200" : f.decision === "descartado" ? "bg-slate-50 ring-slate-200" : "bg-white ring-amber-300"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-slate-900">
          {f.activityId} {f.activityTitle}
        </span>
        <Link href={`/admin/runs/${f.runId}`} className="text-[#2F5DA8] hover:underline">
          {f.tester}
        </Link>
        <span className="ml-auto text-xs text-slate-500">
          Estado: {f.decision === "aceptado" ? "Aceptado" : f.decision === "descartado" ? "Descartado" : TRIAGE[f.triage as keyof typeof TRIAGE] ?? f.triage}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{f.description || "Sin descripción"}</p>
      {f.expected && <p className="mt-0.5 text-xs text-slate-500">Esperaba: {f.expected}</p>}
      {!f.decision && f.note && <p className="mt-0.5 text-xs text-slate-500">Nota anterior: {f.note}</p>}

      <fieldset className="mt-2 flex flex-wrap items-start gap-3 text-sm" disabled={busy}>
        <legend className="sr-only">Decisión sobre el hallazgo</legend>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name={name} checked={decision === "aceptado"} onChange={() => setDecision("aceptado")} />
          Aceptado <span className="text-xs text-slate-500">(cuenta como crítico)</span>
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name={name} checked={decision === "descartado"} onChange={() => setDecision("descartado")} />
          Descartado <span className="text-xs text-slate-500">(sale del veredicto)</span>
        </label>
        <div className="flex w-full flex-wrap items-start gap-2">
          <label className="sr-only" htmlFor={`${name}-note`}>
            Motivo
          </label>
          <textarea
            id={`${name}-note`}
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={decision === "descartado" ? "Motivo del descarte (obligatorio)" : "Motivo de la aceptación (obligatorio)"}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={save}
            disabled={!canSave || busy}
            className="rounded-lg bg-[#2F5DA8] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
        {f.decision && f.decidedAt && (
          <p className="w-full text-xs text-slate-500">Decidido {new Date(f.decidedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</p>
        )}
      </fieldset>
    </li>
  );
}

/** Revisión previa al veredicto: 1) Hallazgos críticos. */
export function CriticalReview({ findings }: { findings: CriticalFinding[] }) {
  const pending = findings.filter((f) => !f.decision).length;
  const accepted = findings.filter((f) => f.decision === "aceptado").length;
  const discarded = findings.filter((f) => f.decision === "descartado").length;
  return (
    <section data-testid="critical-review" className="rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold text-slate-900">Revisión antes del veredicto</h2>
      <p className="mt-1 text-slate-600">
        Revisa lo que se califica antes de generar el veredicto. Cada decisión lleva su motivo y queda en el reporte.
      </p>
      <h3 className="mt-4 text-base font-semibold text-slate-900">
        1) Hallazgos críticos <span className="font-normal text-slate-500">({findings.length})</span>
      </h3>
      <p className="mt-0.5 text-slate-600">
        Criterio de salida: 0 críticos abiertos. «Aceptado» lo deja contando como crítico; «Descartado» lo saca del cálculo.
        {findings.length > 0 && ` Aceptados ${accepted} · Descartados ${discarded} · Sin decidir ${pending}.`}
      </p>
      {pending > 0 && (
        <p className="mt-1 font-medium text-amber-800">Los que están sin decidir cuentan como abiertos (o los clasifica Claude al procesar los reportes).</p>
      )}
      {findings.length === 0 ? (
        <p className="mt-2 text-slate-500">No hay hallazgos críticos en esta encuesta.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {findings.map((f) => (
            <Row key={`${f.id}-${f.decision}-${f.note}`} f={f} />
          ))}
        </ul>
      )}
    </section>
  );
}
