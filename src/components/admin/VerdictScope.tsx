"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const OPTIONS: [string, string][] = [
  ["", "Automático"],
  ["excluir", "No cuenta (problema de logística u otro)"],
  ["incluir", "Sí cuenta (aunque reportó logística)"],
];

/** Mesa de control decide si la prueba entra en el cálculo del veredicto. */
export default function VerdictScope({ runId, scope, note, auto }: { runId: string; scope: string; note: string; auto: string }) {
  const router = useRouter();
  const [value, setValue] = useState(scope);
  const [text, setText] = useState(note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string, nextNote: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/runs/${runId}/scope`, {
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
      <p className="text-slate-700">{auto}</p>
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
            placeholder="Motivo, p. ej. no le asignaron repartidor"
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
