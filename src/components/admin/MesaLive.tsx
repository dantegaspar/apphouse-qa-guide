"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ABANDON_MIN, fmtDate, MESA_BASE_S, MESA_STATE, nextIntervalS, OTHER_ROUND_ACTIVE_MIN, STALL_MIN, timeAgo, type MesaPollState, type MesaState,
} from "@/lib/mesa-shared";
import type { MesaRow } from "@/lib/admin-data";
import type { MesaPayload } from "@/lib/mesa-payload";
import { useViewRound } from "@/components/admin/ViewRound";
import { HelpRequestWatcher } from "@/components/admin/HelpRequestWatcher";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { OtherRoundsAlert } from "@/components/admin/OtherRoundsAlert";
import { QaGrid } from "@/components/admin/QaGrid";

// ---------------------------------------------------------------------------------------------
// Consulta en vivo (TanStack Query)

class MesaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type LiveState = MesaPollState & { sig: string; expired: boolean };

function useMesaQuery(initial: MesaPayload) {
  const guideId = initial.guideId;
  const queryKey = ["admin", "mesa", guideId ?? ""] as const;
  const live = useRef<LiveState>({ sig: initial.sig, calm: 0, fails: 0, expired: false });
  const [mountedAt] = useState(() => Date.now());
  // Copia para pintar (la ref la leen queryFn y refetchInterval; el render lee este estado)
  const [shown, setShown] = useState({ intervalS: MESA_BASE_S, calm: 0, expired: false });
  const publish = () => {
    const l = live.current;
    setShown({ intervalS: nextIntervalS(l), calm: l.calm, expired: l.expired });
  };

  const q = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<MesaPayload> => {
      const l = live.current;
      try {
        const res = await fetch(`/api/admin/mesa${guideId ? `?guide=${encodeURIComponent(guideId)}` : ""}`, { signal, cache: "no-store" });
        if (res.status === 401) {
          l.expired = true;
          throw new MesaHttpError(401, "La sesión del panel expiró");
        }
        if (!res.ok) throw new MesaHttpError(res.status, `El servidor respondió ${res.status}`);
        const data = (await res.json()) as MesaPayload;
        l.calm = data.sig === l.sig ? l.calm + 1 : 0;
        l.sig = data.sig;
        l.fails = 0;
        publish();
        return data;
      } catch (e) {
        if (!signal.aborted && !l.expired) l.fails += 1;
        publish();
        if (e instanceof MesaHttpError) throw e;
        throw new Error(typeof navigator !== "undefined" && !navigator.onLine ? "Sin conexión a internet" : "No se pudo conectar con el servidor");
      }
    },
    initialData: initial,
    initialDataUpdatedAt: mountedAt,
    // Recién pintada por el servidor: no hace falta pedirla otra vez al montar
    staleTime: (MESA_BASE_S - 1) * 1000,
    refetchInterval: () => (live.current.expired ? false : nextIntervalS(live.current) * 1000),
  });

  // La página se volvió a pintar en el servidor (p. ej. cambio de encuesta con router.refresh): esos datos mandan
  const qc = useQueryClient();
  useEffect(() => {
    const cur = qc.getQueryData<MesaPayload>(queryKey);
    if (cur && initial.at < cur.at) return;
    if (!cur || initial.at > cur.at) qc.setQueryData(queryKey, initial);
    live.current.sig = initial.sig;
    live.current.calm = 0;
    publish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return { q, ...shown };
}

/** Reloj de un segundo para «hace N s». */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const secsAgo = (ms: number, now: number) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};

/** Indicador de la cabecera: en vivo, o por qué no se está actualizando. */
function LiveStatus({ updatedAt, intervalS, calm, fetching, failing }: { updatedAt: number; intervalS: number; calm: boolean; fetching: boolean; failing: boolean }) {
  const now = useNow();
  return (
    <span className={`w-full text-xs sm:w-auto ${failing ? "font-semibold text-amber-700" : "text-slate-400"}`} data-testid="mesa-live-status">
      <span
        className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${failing ? "bg-amber-500" : fetching ? "bg-sky-500" : "animate-pulse bg-emerald-500"}`}
        aria-hidden
      />
      {failing ? "Sin actualizar" : "En vivo"} · cada {intervalS} s{calm && !failing ? " (sin cambios)" : ""} · actualizado hace {secsAgo(updatedAt, now)}
    </span>
  );
}

/** Aviso cuando la última consulta falló: qué pasó, de cuándo son los datos y cuándo se reintenta. */
function ConnectionAlert({
  message,
  updatedAt,
  errorAt,
  retryS,
  expired,
  onRetry,
  busy,
}: {
  message: string;
  updatedAt: number;
  errorAt: number;
  retryS: number;
  expired: boolean;
  onRetry: () => void;
  busy: boolean;
}) {
  const now = useNow();
  const left = Math.max(0, Math.ceil((errorAt + retryS * 1000 - now) / 1000));
  return (
    <div
      role="status"
      data-testid="mesa-connection-alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <p>
        <span className="font-semibold">{message}.</span>{" "}
        {expired ? (
          <>La Mesa dejó de actualizarse. Vuelve a entrar para seguir viendo los datos en vivo.</>
        ) : (
          <>
            Mostrando los datos de hace {secsAgo(updatedAt, now)}. {busy ? "Reintentando…" : `Reintento automático en ${left} s.`}
          </>
        )}
      </p>
      {expired ? (
        <Link href="/admin/login" className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700">
          Entrar de nuevo
        </Link>
      ) : (
        <button type="button" onClick={onRetry} disabled={busy} className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          Reintentar ahora
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Tabla y tarjetas

const done = (r: MesaRow) => r.state === "finished" || r.state === "ended_blocked";
const late = (r: MesaRow) => !done(r) && r.minsSinceSave > STALL_MIN;

function StateChip({ r }: { r: MesaRow }) {
  const s = MESA_STATE[r.state];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}
      title={r.state === "help" ? r.openHelp?.reason || undefined : undefined}
    >
      {r.state === "stalled" ? `Sin avance +${STALL_MIN} min` : r.state === "help" && r.openHelp ? `Pide ayuda · ${r.openHelp.minsOpen} min` : s.label}
    </span>
  );
}

function Current({ r }: { r: MesaRow }) {
  const c = r.progress.current;
  if (!c) return <span className="text-slate-400">Aún no empieza</span>;
  const prefix = done(r) ? "Última: " : c.mode === "working" ? "" : c.mode === "next" ? "Sigue: " : "Última: ";
  return (
    <span className="min-w-0">
      <span className="text-slate-500">{prefix}</span>
      <span className="font-mono text-xs font-semibold text-slate-700">{c.id}</span>{" "}
      <span className="text-slate-800">{c.title || <em className="text-slate-400">(ya no está en la guía)</em>}</span>
    </span>
  );
}

function Progress({ r }: { r: MesaRow }) {
  const { saved, total } = r.progress;
  const pct = total ? Math.round((saved / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={`${saved} de ${total} actividades guardadas`}>
      <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${r.state === "finished" ? "bg-emerald-500" : "bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8]"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs tabular-nums text-slate-700">
        <span className="font-semibold">{saved}</span>/{total}
      </span>
    </div>
  );
}

function LastSaved({ r, nowMs }: { r: MesaRow; nowMs: number }) {
  const at = r.progress.lastSavedAt;
  return (
    <span className={`whitespace-nowrap ${late(r) ? "font-semibold text-red-700" : "text-slate-600"}`} title={at ? fmtDate(at) : undefined}>
      {at ? timeAgo(at, nowMs) : <>Sin guardar · empezó {timeAgo(r.run.created_at, nowMs)}</>}
    </span>
  );
}

function Failures({ r }: { r: MesaRow }) {
  if (!r.failures) return <span className="text-slate-300">0</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-slate-800">{r.failures}</span>
      {r.blocking > 0 && <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">{r.blocking} bloq.</span>}
    </span>
  );
}

function Who({ r }: { r: MesaRow }) {
  return (
    <div className="min-w-0">
      <Link href={`/admin/runs/${r.run.id}`} className="font-semibold text-[#2F5DA8] hover:underline">{r.run.name}</Link>
      <div className="text-xs text-slate-500">
        {r.guideTitle}
        {r.branch && <> · <span className="font-medium text-slate-700">{r.branch}</span></>}
        {r.fields && <> · {r.fields}</>}
      </div>
    </div>
  );
}

const SUMMARY: { key: MesaState; label: string; tone: string }[] = [
  { key: "help", label: "Piden ayuda", tone: "text-red-600" },
  { key: "stalled", label: `Sin avance +${STALL_MIN} min`, tone: "text-amber-600" },
  { key: "active", label: "Avanzando", tone: "text-sky-700" },
  { key: "abandoned", label: "Abandonadas", tone: "text-slate-500" },
  { key: "finished", label: "Terminadas", tone: "text-emerald-600" },
];

// ---------------------------------------------------------------------------------------------

/**
 * Mesa de control en vivo. El servidor la pinta la primera vez (initial) y después el navegador pide
 * /api/admin/mesa con TanStack Query: cada 5 s, más espaciado si nada cambia, con espera creciente si
 * falla, y en pausa con la pestaña oculta. Una sola consulta alimenta tabla, mapa y avisos.
 */
export function MesaLive({ initial }: { initial: MesaPayload }) {
  const router = useRouter();
  const viewRound = useViewRound();
  const { q, intervalS, calm, expired } = useMesaQuery(initial);
  const d = q.data;
  const { rows, at: nowMs, guideId } = d;
  const qs = guideId ? `?guide=${encodeURIComponent(guideId)}` : "";
  const failing = q.isError && q.errorUpdatedAt > q.dataUpdatedAt;

  // Alguien cambió la encuesta a la vista (desde otra pestaña o computadora): repintar barra y página
  useEffect(() => {
    if (viewRound !== null && d.round !== viewRound) router.refresh();
  }, [d.round, viewRound, router]);

  const countOf = (k: MesaState) => rows.filter((r) => r.state === k || (k === "finished" && r.state === "ended_blocked")).length;
  const firstCalm = rows.findIndex((r) => !r.reason);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-3 py-5 sm:px-4 sm:py-6">
      <HelpRequestWatcher open={d.openHelp} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 h-1.5 w-16 rounded-full bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8]" />
          <h1 className="text-2xl font-bold text-slate-900">Mesa de control</h1>
          <p className="text-sm text-slate-600">Quién va en qué, en vivo. Primero los que necesitan atención.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveStatus updatedAt={q.dataUpdatedAt} intervalS={intervalS} calm={calm >= 6} fetching={q.isFetching} failing={failing} />
          <Link href={`/admin${qs}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">← Panel</Link>
          <Link href={`/admin/graficas${qs}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#2F5DA8] hover:bg-slate-50">Gráficas</Link>
          <LogoutButton />
        </div>
      </header>

      {failing && (
        <ConnectionAlert
          message={q.error?.message || "No se pudo actualizar"}
          updatedAt={q.dataUpdatedAt}
          errorAt={q.errorUpdatedAt}
          retryS={intervalS}
          expired={expired}
          busy={q.isFetching}
          onRetry={() => void q.refetch()}
        />
      )}

      <OtherRoundsAlert
        rounds={d.otherRounds}
        activeMinutes={OTHER_ROUND_ACTIVE_MIN}
        help={d.otherHelp.map((h) => ({ id: h.id, runId: h.runId, tester: h.tester, where: h.where, ago: timeAgo(h.createdAt, nowMs), roundId: h.roundId }))}
      />

      <nav className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Filtrar por guía">
        {[{ id: "", title: "Todas las guías" }, ...d.guides].map((g) => (
          <Link
            key={g.id}
            href={g.id ? `/admin/mesa?guide=${encodeURIComponent(g.id)}` : "/admin/mesa"}
            className={`shrink-0 rounded-full px-3 py-1.5 font-medium ring-1 ${
              (guideId ?? "") === g.id ? "bg-[#2F5DA8] text-white ring-[#2F5DA8]" : "bg-white text-slate-700 ring-slate-300"
            }`}
          >
            {g.title}
          </Link>
        ))}
      </nav>

      <section aria-label="Resumen" className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
        {SUMMARY.map((s) => (
          <div key={s.key} className="rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200">
            <div className={`text-2xl font-bold tabular-nums ${s.tone}`}>{countOf(s.key)}</div>
            <div className="text-xs leading-tight text-slate-600">{s.label}</div>
          </div>
        ))}
      </section>

      {rows.length > 0 && (
        <QaGrid tiles={d.tiles} at={nowMs} refreshS={intervalS} guides={d.guides.map((g) => ({ id: g.id, title: g.shortTitle }))} grouped={!guideId} stale={failing} />
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">Todavía no hay testers.</p>
      ) : (
        <>
          {/* Escritorio / tableta: tabla */}
          <div className="hidden overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200 md:block">
            <table className="w-full min-w-[900px] text-left text-sm" data-testid="mesa-table">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {["Estado", "Tester", "Dispositivo", "Actividad actual", "Avance", "Último guardado", "Fallas"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr
                    key={r.run.id}
                    className={`align-top ${r.state === "help" ? "bg-red-50" : r.state === "stalled" ? "bg-amber-50/60" : ""} ${i === firstCalm && i > 0 ? "border-t-4 border-slate-100" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <StateChip r={r} />
                        {r.state === "help" && r.openHelp?.reason && <span className="line-clamp-2 text-xs text-red-800">{r.openHelp.reason}</span>}
                        {r.reason && r.state !== "help" && <span className="text-xs text-slate-500">{r.reason}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><Who r={r} /></td>
                    <td className="max-w-[14rem] px-3 py-2.5 text-xs text-slate-600">{r.device || "—"}</td>
                    <td className="max-w-[18rem] px-3 py-2.5"><Current r={r} /></td>
                    <td className="px-3 py-2.5"><Progress r={r} /></td>
                    <td className="px-3 py-2.5"><LastSaved r={r} nowMs={nowMs} /></td>
                    <td className="px-3 py-2.5"><Failures r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Teléfono: tarjetas */}
          <ul className="space-y-2 md:hidden" data-testid="mesa-cards">
            {rows.map((r) => (
              <li
                key={r.run.id}
                className={`rounded-xl p-3 shadow-sm ring-1 ${r.state === "help" ? "bg-red-50 ring-red-300" : r.state === "stalled" ? "bg-amber-50/60 ring-amber-200" : "bg-white ring-slate-200"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <Who r={r} />
                  <div className="shrink-0">
                    <StateChip r={r} />
                  </div>
                </div>
                {r.state === "help" && r.openHelp?.reason && <p className="mt-1.5 text-sm text-red-800">«{r.openHelp.reason}»</p>}
                <div className="mt-2 text-sm"><Current r={r} /></div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                  <Progress r={r} />
                  <span className="text-xs text-slate-500">{r.progress.lastSavedAt ? "Guardó " : ""}<LastSaved r={r} nowMs={nowMs} /></span>
                  <span className="text-xs text-slate-500">Fallas: <Failures r={r} /></span>
                </div>
                {(r.device || (r.reason && r.state !== "help")) && (
                  <div className="mt-1.5 text-xs text-slate-500">
                    {r.reason && r.state !== "help" && <span className="font-medium text-slate-600">{r.reason}</span>}
                    {r.reason && r.state !== "help" && r.device && " · "}
                    {r.device}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-slate-400">
        «Sin avance»: más de {STALL_MIN} min sin guardar una actividad. «Abandonada»: más de {ABANDON_MIN} min sin ninguna actividad y sin terminar.
      </p>
    </main>
  );
}
