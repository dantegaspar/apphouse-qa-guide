"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEGACY_SEVERITY, SEVERITIES, SEVERITY_CLASS as SEV_CLASS, TRIAGE, type Severity, type Triage } from "@/lib/types";

/** Severidad y revisión de una falla (Mesa de control). Cuentan para el veredicto. */
export default function IssueTriage({ id, severity, triage }: { id: string; severity: string; triage: string }) {
  const router = useRouter();
  const [sev, setSev] = useState<Severity>((severity in SEVERITIES ? severity : LEGACY_SEVERITY[severity] ?? "medio") as Severity);
  const [tri, setTri] = useState<Triage>((triage in TRIAGE ? triage : "pendiente") as Triage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: { severity?: Severity; triage?: Triage }) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/issues/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se guardó");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se guardó");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="issue-triage">
      <select
        aria-label="Severidad"
        disabled={busy}
        value={sev}
        onChange={(e) => {
          const v = e.target.value as Severity;
          setSev(v);
          save({ severity: v });
        }}
        className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEV_CLASS[sev]}`}
      >
        {Object.entries(SEVERITIES).map(([k, l]) => (
          <option key={k} value={k}>{l}</option>
        ))}
      </select>
      <select
        aria-label="Revisión"
        disabled={busy}
        value={tri}
        onChange={(e) => {
          const v = e.target.value as Triage;
          setTri(v);
          save({ triage: v });
        }}
        className="rounded bg-white px-1.5 py-0.5 text-xs ring-1 ring-slate-300"
      >
        {Object.entries(TRIAGE).map(([k, l]) => (
          <option key={k} value={k}>{l}</option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
