"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast, useConfirm } from "@/components/feedback";

type RoundItem = { id: number; name: string; created_at: string; runs: number; couriers: number; open: number };

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

/**
 * Selector de ronda de encuestas («Primera encuesta», «Segunda encuesta»…) y botón «Nueva encuesta».
 * Todo el panel (resultados, Mesa, gráficas, veredicto, reporte y descargas) muestra solo la ronda elegida.
 * Abrir una ronda nueva no borra nada: lo anterior queda guardado en su ronda.
 */
export function RoundSwitcher({ rounds, view, active, nextName }: { rounds: RoundItem[]; view: number; active: number; nextName: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"" | "new" | "rename">("");
  const [name, setName] = useState("");
  // Ronda que se está renombrando: la que estaba en pantalla al picar «Renombrar» (si otra pestaña cambia
  // la vista mientras escribe, el nombre no cae en otra ronda)
  const [renameId, setRenameId] = useState<number | null>(null);
  const current = rounds.find((r) => r.id === view);
  const activeRound = rounds.find((r) => r.id === active);
  const archived = view !== active;

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/rounds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se guardó");
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se guardó", { id: "admin-round" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startNew = async () => {
    const n = name.trim() || nextName;
    const open = activeRound?.open ?? 0;
    const ok = await confirm({
      title: `¿Empezar «${n}»?`,
      message: (
        <div className="space-y-2">
          <p>El panel queda limpio para la siguiente ronda: las pruebas y encuestas nuevas entran a «{n}».</p>
          <p>
            No se borra nada. Lo de «{activeRound?.name}» ({activeRound?.runs ?? 0} pruebas, {activeRound?.couriers ?? 0} repartidores) queda guardado y lo
            vuelves a ver eligiéndolo arriba.
          </p>
          {open > 0 && (
            <p className="font-semibold text-amber-800">
              Ojo: {open} {open === 1 ? "prueba sigue" : "pruebas siguen"} en curso en «{activeRound?.name}». Si las terminan, se quedan en esa ronda.
            </p>
          )}
        </div>
      ),
      confirmLabel: "Sí, empezar nueva encuesta",
    });
    if (!ok) return;
    if (await post({ action: "new", name: n })) {
      setMode("");
      setName("");
      toast.success(`Listo: ahora ves «${n}», vacía y lista para la siguiente ronda.`, { id: "admin-round" });
    }
  };

  return (
    <div
      data-testid="round-switcher"
      className={`border-b print:hidden ${archived ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2 text-sm">
        <span className="font-semibold text-slate-700">Encuesta:</span>
        <div role="radiogroup" aria-label="Ronda de encuestas" className="flex flex-wrap gap-1.5">
          {rounds.map((r) => {
            const on = r.id === view;
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                title={`Desde ${fmtDay(r.created_at)} · ${r.runs} pruebas · ${r.couriers} repartidores`}
                onClick={() => !on && post({ action: "view", id: r.id })}
                className={`rounded-full px-3 py-1 font-medium ring-1 disabled:opacity-60 ${
                  on ? "bg-[#2F5DA8] text-white ring-[#2F5DA8]" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                }`}
              >
                {r.name}
                <span className={`ml-1.5 text-xs ${on ? "text-blue-100" : "text-slate-400"}`}>{r.runs + r.couriers}</span>
                {r.id === active && rounds.length > 1 && (
                  <span className={`ml-1.5 rounded px-1 text-[10px] font-bold uppercase ${on ? "bg-white/20" : "bg-emerald-100 text-emerald-800"}`}>actual</span>
                )}
              </button>
            );
          })}
        </div>

        {mode === "" && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setName(current?.name ?? "");
                setRenameId(view);
                setMode("rename");
              }}
              className="rounded-lg px-2 py-1 text-slate-600 underline-offset-2 hover:underline disabled:opacity-50"
            >
              Renombrar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setName(nextName);
                setMode("new");
              }}
              data-testid="new-round"
              className="rounded-lg border border-[#2F5DA8] bg-white px-3 py-1 font-semibold text-[#2F5DA8] hover:bg-blue-50 disabled:opacity-50"
            >
              + Nueva encuesta
            </button>
          </div>
        )}

        {mode !== "" && (
          <form
            className="ml-auto flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (mode === "new") return startNew();
              if (await post({ action: "rename", id: renameId ?? view, name })) setMode("");
            }}
          >
            <label className="sr-only" htmlFor="round-name">
              {mode === "new" ? "Nombre de la nueva encuesta" : "Nuevo nombre"}
            </label>
            <input
              id="round-name"
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "new" ? nextName : rounds.find((r) => r.id === (renameId ?? view))?.name}
              className="w-56 rounded-lg border border-slate-300 px-2 py-1"
            />
            <button type="submit" disabled={busy || (mode === "rename" && !name.trim())} className="rounded-lg bg-[#2F5DA8] px-3 py-1 font-semibold text-white disabled:opacity-50">
              {mode === "new" ? "Empezar" : "Guardar"}
            </button>
            <button type="button" onClick={() => setMode("")} className="rounded-lg px-2 py-1 text-slate-600 hover:underline">
              Cancelar
            </button>
          </form>
        )}

        {archived && (
          <p className="w-full text-xs text-amber-900">
            Estás viendo una encuesta anterior: todo el panel, el veredicto y las descargas son solo de «{current?.name}». Las pruebas nuevas entran a «
            {activeRound?.name}».
          </p>
        )}
      </div>
    </div>
  );
}
