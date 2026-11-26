"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useViewRound } from "@/components/admin/ViewRound";

/** Lo que va haciendo Claude, según el tiempo transcurrido (aproximado: la API no informa el avance). */
const STAGES: [number, string][] = [
  [0, "Leyendo los reportes, los pedidos fallados y los problemas de repartidores…"],
  [12, "Clasificando cada error: desarrollo, servidor, logística o tester…"],
  [45, "Limpiando los resultados y recalculando los criterios…"],
  [60, "Revisando los criterios fijos con ISO/IEC/IEEE 29119…"],
  [100, "Redactando el dictamen y las recomendaciones…"],
  [180, "Sigue trabajando; con muchos reportes puede tardar un poco más…"],
];

/** Botón «Procesar con Claude» con indicador de «pensando» mientras la API responde (1–3 min). */
export default function ClaudeDictamenButton({ disabled, reclasificar, label }: { disabled?: boolean; reclasificar?: boolean; label?: string }) {
  const router = useRouter();
  // Ronda que el admin tiene en pantalla: el dictamen se hace sobre esa
  const round = useViewRound();
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const run = async () => {
    setSecs(0);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/claude-dictamen${reclasificar ? "?reclasificar=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(round ? { round } : {}),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "No se pudo procesar con Claude");
      if (body.error) setError(body.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar con Claude");
    } finally {
      setBusy(false);
    }
  };

  const stage = [...STAGES].reverse().find(([s]) => secs >= s)?.[1] ?? STAGES[0][1];
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  if (busy)
    return (
      <div role="status" aria-live="polite" data-testid="claude-thinking" className="flex items-center gap-4 rounded-xl bg-[#2F5DA8]/5 p-4 ring-1 ring-[#2F5DA8]/20">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
          <span className="absolute h-10 w-10 animate-ping rounded-full bg-[#3BA3A8]/30" />
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-[#2F5DA8]/20 border-t-[#2F5DA8]" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            Claude está pensando<span className="inline-block w-6 animate-pulse">…</span>
            <span className="ml-2 font-mono text-xs font-normal text-slate-500">{clock}</span>
          </p>
          <p className="text-sm text-slate-700">{stage}</p>
          <p className="mt-0.5 text-xs text-slate-500">Suele tardar de 1 a 3 minutos. No cierres ni recargues esta página.</p>
        </div>
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={disabled}
        className="rounded-lg bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        data-testid="claude-dictamen"
      >
        {label ?? "Procesar con Claude"}
      </button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  );
}
