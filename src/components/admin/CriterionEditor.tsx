"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Captura de un criterio del Plan (medición y si cumple) por Mesa de control. */
export default function CriterionEditor({ n, measured, met, auto }: { n: number; measured: string; met: boolean | null; auto: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(auto ? "" : measured);
  const [value, setValue] = useState<"" | "si" | "no">(auto || met === null ? "" : met ? "si" : "no");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/criteria/${n}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ measured: text, met: value === "" ? null : value === "si" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se guardó");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se guardó");
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-[#2F5DA8] hover:underline" data-testid={`criterion-edit-${n}`}>
        {auto ? "Capturar a mano" : measured || met !== null ? "Editar" : "Capturar"}
      </button>
    );
  return (
    <div className="mt-1 space-y-1.5" data-testid={`criterion-form-${n}`}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Medido (ej. 640 ms)"
        aria-label="Medido"
        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={value} onChange={(e) => setValue(e.target.value as "" | "si" | "no")} aria-label="Cumple" className="rounded border border-slate-300 px-1.5 py-1 text-xs">
          <option value="">{n === 1 ? "Automático" : "Pendiente"}</option>
          <option value="si">Cumple</option>
          <option value="no">No cumple</option>
        </select>
        <button type="button" disabled={busy} onClick={save} className="rounded bg-[#2F5DA8] px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          Guardar
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          Cancelar
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
