"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const RUN_OPTIONS: [string, string][] = [
  ["", "Automático"],
  ["excluir", "No cuenta (logística, servidor u otro problema ajeno al desarrollo)"],
  ["incluir", "Sí cuenta (aunque reportó logística)"],
];
const COURIER_OPTIONS: [string, string][] = [
  ["", "Sí cuenta"],
  ["excluir", "No cuenta (problema ajeno al desarrollo, p. ej. el correo nunca llegó)"],
];

/** Mesa de control decide si la prueba entra en el cálculo del veredicto. */
export default function VerdictScope({
  runId,
  courierId,
  scope,
  note,
  auto,
}: {
  runId?: string;
  courierId?: string;
  scope: string;
  note: string;
  auto?: string;
}) {
  const OPTIONS = courierId ? COURIER_OPTIONS : RUN_OPTIONS;
  const url = courierId ? `/api/admin/courier/${courierId}/scope` : `/api/admin/runs/${runId}/scope`;
  const router = useRouter();
  const [value, setValue] = useState(scope);
  const [text, setText] = useState(note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string, nextNote: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: next, note: nextNote }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se guardó");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se guardó");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 text-sm" data-testid="verdict-scope">
      {auto && <p className="text-slate-700">{auto}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="¿Cuenta para el veredicto?"
          disabled={busy}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            save(e.target.value, text);
          }}
          className="rounded bg-white px-2 py-1 ring-1 ring-slate-300"
        >
          {OPTIONS.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        {value === "excluir" && (
          <input
            aria-label="Motivo"
            placeholder={courierId ? "Motivo, p. ej. el correo de acceso nunca llegó" : "Motivo, p. ej. no le asignaron repartidor o falló el servidor"}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== note && save(value, text)}
            className="min-w-64 flex-1 rounded px-2 py-1 ring-1 ring-slate-300"
          />
        )}
        {busy && <span className="text-xs text-slate-500">Guardando…</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}
