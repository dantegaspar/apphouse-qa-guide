"use client";

import { useEffect, useRef, useState } from "react";
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
      <div className="relative mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2 text-sm">
        <span className="font-semibold text-slate-700">Encuesta:</span>
        <RoundMenu rounds={rounds} view={view} active={active} busy={busy} onPick={(id) => post({ action: "view", id })} />

        {mode === "" && (
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
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
            className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto"
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
              className="min-w-0 flex-1 rounded-lg sm:w-56 sm:flex-none border border-slate-300 px-2 py-1"
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

function Badge({ on }: { on?: boolean }) {
  return <span className={`rounded px-1 text-[10px] font-bold uppercase ${on ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"}`}>actual</span>;
}

/**
 * Menú desplegable de rondas: en la barra solo se ve la encuesta elegida; al abrirlo salen todas,
 * de la más reciente a la más antigua, con su fecha y conteos. Escala a muchas rondas sin ocupar la barra.
 */
function RoundMenu({
  rounds,
  view,
  active,
  busy,
  onPick,
}: {
  rounds: RoundItem[];
  view: number;
  active: number;
  busy: boolean;
  onPick: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const sorted = [...rounds].sort((a, b) => b.id - a.id);
  const current = rounds.find((r) => r.id === view);
  const many = rounds.length > 1;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelectorAll<HTMLElement>("[role=option]")[focus]?.focus();
  }, [open, focus]);

  const show = () => {
    setFocus(Math.max(0, sorted.findIndex((r) => r.id === view)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const pick = (id: number) => {
    close();
    if (id !== view) onPick(id);
  };

  return (
    <div ref={wrap} className="min-w-0 flex-1 sm:relative sm:flex-none">
      <button
        ref={btn}
        type="button"
        data-testid="round-menu"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Ronda de encuestas: ${current?.name ?? ""}`}
        disabled={busy}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
        className="flex w-full items-center gap-1.5 rounded-full bg-[#2F5DA8] py-1 pl-3 pr-2 font-medium text-white ring-1 ring-[#2F5DA8] disabled:opacity-60 sm:w-auto sm:max-w-md"
      >
        <span className="truncate">{current?.name ?? "—"}</span>
        <span className="text-xs text-blue-100">{current ? current.runs + current.couriers : 0}</span>
        {many && view === active && <Badge on />}
        <svg aria-hidden viewBox="0 0 20 20" className={`ml-auto size-4 shrink-0 transition-transform sm:ml-0 ${open ? "rotate-180" : ""}`} fill="currentColor">
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>

      {open && (
        <ul
          ref={list}
          role="listbox"
          aria-label="Rondas de encuestas, de la más reciente a la más antigua"
          data-testid="round-list"
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Tab") {
              if (e.key === "Escape") e.preventDefault();
              close();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setFocus((f) => Math.min(sorted.length - 1, f + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setFocus((f) => Math.max(0, f - 1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setFocus(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setFocus(sorted.length - 1);
            }
          }}
          className="absolute inset-x-4 z-40 mt-1 max-h-[60vh] sm:inset-x-auto sm:left-0 sm:w-[22rem] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {sorted.map((r) => {
            const on = r.id === view;
            return (
              <li
                key={r.id}
                role="option"
                aria-selected={on}
                tabIndex={-1}
                onClick={() => pick(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(r.id);
                  }
                }}
                className={`flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 outline-none focus:bg-slate-100 ${on ? "bg-blue-50" : "hover:bg-slate-50"}`}
              >
                <span className={`mt-0.5 size-4 shrink-0 text-[#2F5DA8] ${on ? "" : "invisible"}`} aria-hidden>
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate ${on ? "font-semibold text-[#2F5DA8]" : "font-medium text-slate-800"}`}>{r.name}</span>
                    {many && r.id === active && <Badge />}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Desde {fmtDay(r.created_at)} · {r.runs} {r.runs === 1 ? "prueba" : "pruebas"} · {r.couriers}{" "}
                    {r.couriers === 1 ? "repartidor" : "repartidores"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
