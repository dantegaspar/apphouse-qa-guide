"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { QaTile, QaTileKind } from "@/lib/admin-data";

/**
 * Mapa de testers de la Mesa de control: una ficha por tester, como un mapa de asientos.
 * Verde = avanzando; rojo con pulso = bloqueado. Se actualiza con el refresco de la página
 * (MesaLive → TanStack Query), sin recargar: las fichas animan su avance y destellan al
 * cambiar de estado.
 */

const KIND: Record<QaTileKind, { label: string; card: string; name: string; stroke: string; dot: string }> = {
  blocked: { label: "Bloqueado", card: "qa-pulse bg-red-50 border-red-400", name: "text-red-700", stroke: "stroke-red-500", dot: "bg-red-500" },
  active: { label: "En progreso", card: "bg-white border-emerald-300", name: "text-emerald-700", stroke: "stroke-emerald-500", dot: "bg-emerald-500" },
  stalled: { label: "Sin avance", card: "bg-white border-slate-200", name: "text-slate-700", stroke: "stroke-slate-400", dot: "bg-amber-400" },
  idle: { label: "Sin empezar", card: "bg-white border-dashed border-slate-300", name: "text-slate-500", stroke: "stroke-slate-300", dot: "bg-slate-300" },
  abandoned: { label: "Abandonó", card: "bg-slate-100 border-slate-200 opacity-75", name: "text-slate-500", stroke: "stroke-slate-300", dot: "bg-slate-400" },
  finished: { label: "Terminó", card: "bg-emerald-50 border-emerald-200", name: "text-emerald-800", stroke: "stroke-emerald-600", dot: "bg-emerald-600" },
};
const LEGEND: QaTileKind[] = ["active", "blocked", "finished", "stalled", "idle", "abandoned"];

/** "hace 3 min" (versión de cliente; admin-data.ts no se puede importar aquí porque usa la base). */
function ago(iso: string, nowMs: number) {
  const m = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "hace <1 min";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `hace ${h} h ${m % 60} min` : `hace ${Math.floor(h / 24)} d`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function countsText(tiles: QaTile[]) {
  const n = (k: QaTileKind) => tiles.filter((t) => t.kind === k).length;
  return [
    plural(n("active"), "en progreso", "en progreso"),
    plural(n("blocked"), "bloqueado", "bloqueados"),
    plural(n("finished"), "terminó", "terminaron"),
    n("stalled") ? plural(n("stalled"), "sin avance", "sin avance") : "",
    n("idle") ? plural(n("idle"), "sin empezar", "sin empezar") : "",
    n("abandoned") ? plural(n("abandoned"), "abandonó", "abandonaron") : "",
  ].filter(Boolean);
}

/** Número que se desliza hasta su nuevo valor (sin animación si el sistema pide menos movimiento). */
function useTween(value: number, ms = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = reduce ? 1 : Math.min(1, (t - t0) / ms);
      const v = Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function Ring({ pct, kind }: { pct: number; kind: QaTileKind }) {
  const shown = useTween(pct);
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-10 w-10 shrink-0 sm:h-12 sm:w-12" aria-hidden>
      <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-slate-200" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className={`${KIND[kind].stroke} transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-slate-800 sm:text-[11px]">
        {kind === "finished" ? (
          <svg viewBox="0 0 20 20" className="h-5 w-5 fill-emerald-600" role="img" aria-label="Terminó">
            <path d="M8.1 13.6 4.5 10l-1.4 1.4 5 5 9-9-1.4-1.4z" />
          </svg>
        ) : (
          `${shown}%`
        )}
      </span>
    </div>
  );
}

function Tile({ t, nowMs }: { t: QaTile; nowMs: number }) {
  const k = KIND[t.kind];
  // Destello breve cuando el tester cambia de estado (ajuste de estado durante el render, sin efectos)
  const [seen, setSeen] = useState(t.kind);
  const [flash, setFlash] = useState(0);
  if (seen !== t.kind) {
    setSeen(t.kind);
    setFlash((f) => f + 1);
  }
  const status =
    t.kind === "blocked" ? t.blockedWhy : t.kind === "stalled" ? `Sin avance · ${t.minsSinceSave} min` : k.label;
  return (
    <li>
      <Link
        href={`/admin/runs/${t.id}`}
        data-kind={t.kind}
        className={`relative flex h-full flex-col gap-1.5 rounded-xl border-2 p-2.5 shadow-sm transition-colors duration-500 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F5DA8] ${k.card}`}
        title={`${t.name} · ${t.guideTitle}${t.whereTitle ? ` · ${t.where} ${t.whereTitle}` : ""} · ${t.saved}/${t.total} actividades`}
      >
        {flash > 0 && <span key={flash} className="qa-flash" aria-hidden />}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className={`flex items-start gap-1.5 text-sm font-semibold leading-tight sm:text-base ${k.name}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${k.dot} ${t.kind === "blocked" ? "qa-pulse-dot" : ""}`} aria-hidden />
              <span className="line-clamp-2 break-words">{t.name}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-500">{t.branch || t.guideTitle}</div>
          </div>
          <Ring pct={t.pct} kind={t.kind} />
        </div>
        <div className="truncate font-mono text-xs font-semibold text-slate-700" title={t.whereTitle || undefined}>
          {t.where}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-slate-200" aria-hidden>
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${k.dot}`}
            style={{ width: `${t.pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-1 text-[11px]">
          <span
            className={`truncate font-semibold ${
              t.kind === "blocked" ? "text-red-700" : t.kind === "stalled" ? "text-amber-700" : t.kind === "active" || t.kind === "finished" ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            {status}
          </span>
          <span className="shrink-0 tabular-nums text-slate-500">
            {t.saved}/{t.total}
          </span>
        </div>
        <div className="truncate text-[11px] text-slate-400">Actividad {ago(t.lastSignalAt, nowMs)}</div>
      </Link>
    </li>
  );
}

function Grid({ tiles, nowMs }: { tiles: QaTile[]; nowMs: number }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
      {tiles.map((t) => (
        <Tile key={t.id} t={t} nowMs={nowMs} />
      ))}
    </ul>
  );
}

export function QaGrid({
  tiles,
  at,
  refreshS,
  guides,
  grouped,
  stale = false,
}: {
  tiles: QaTile[];
  /** Hora del servidor de estos datos (ms). */
  at: number;
  refreshS: number;
  guides: { id: string; title: string }[];
  /** Mostrar encabezados por guía (cuando la página no filtra por guía). */
  grouped: boolean;
  /** La última consulta falló: mostrar el indicador en ámbar aunque los datos sean recientes. */
  stale?: boolean;
}) {
  const [nowMs, setNowMs] = useState(at);
  const [tab, setTab] = useState("");
  const [fs, setFs] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    const onFs = () => setFs(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      clearInterval(t);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const present = guides.filter((g) => tiles.some((t) => t.guideId === g.id));
  const active = present.some((g) => g.id === tab) ? tab : "";
  const shown = active ? tiles.filter((t) => t.guideId === active) : tiles;
  const secs = Math.max(0, Math.round((Math.max(nowMs, at) - at) / 1000));
  const late = stale || secs > refreshS * 3;

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <section
      ref={ref}
      aria-label="Mapa de testers"
      data-testid="qa-grid"
      className={`space-y-3 ${fs ? "overflow-y-auto bg-slate-50 p-6 sm:p-8" : "rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:p-4"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className={`font-bold text-slate-900 ${fs ? "text-2xl" : "text-lg"}`}>Mapa de testers</h2>
          <p className="text-sm text-slate-600" data-testid="qa-grid-counts">
            {countsText(shown).map((s, i) => (
              <span key={s}>
                {i > 0 && <span className="text-slate-300"> · </span>}
                <span className={i === 1 && shown.some((t) => t.kind === "blocked") ? "font-semibold text-red-700" : ""}>{s}</span>
              </span>
            ))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 whitespace-nowrap text-xs ${late ? "font-semibold text-amber-700" : "text-slate-500"}`} aria-live="off">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${late ? "bg-amber-400" : "bg-emerald-400"}`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${late ? "bg-amber-500" : "bg-emerald-500"}`} />
            </span>
            {late ? "Sin actualizar" : "En vivo"} · actualizado hace {secs} s
          </span>
          <button
            type="button"
            onClick={toggleFs}
            className="hidden rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex"
            title={fs ? "Salir de pantalla completa" : "Ver en pantalla completa (modo TV)"}
          >
            {fs ? "Salir" : "⛶ Pantalla completa"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {present.length > 1 ? (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 text-xs" role="group" aria-label="Guía del mapa">
            {[{ id: "", title: "Todas" }, ...present].map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={active === g.id}
                onClick={() => setTab(g.id)}
                className={`shrink-0 rounded-full px-2.5 py-1 font-medium ring-1 ${
                  active === g.id ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                }`}
              >
                {g.title} <span className="tabular-nums opacity-70">{g.id ? tiles.filter((t) => t.guideId === g.id).length : tiles.length}</span>
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600" aria-label="Leyenda">
          {LEGEND.map((k) => (
            <li key={k} className="flex items-center gap-1">
              <span className={`h-2.5 w-2.5 rounded-full ${KIND[k].dot} ${k === "blocked" ? "qa-pulse-dot" : ""}`} aria-hidden />
              {k === "active" ? "Verde: en progreso" : k === "blocked" ? "Rojo: bloqueado" : KIND[k].label}
            </li>
          ))}
        </ul>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Todavía no hay testers.</p>
      ) : grouped && !active && present.length > 1 ? (
        present.map((g) => {
          const list = tiles.filter((t) => t.guideId === g.id);
          return (
            <div key={g.id} className="space-y-2">
              <h3 className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-100 pb-1 text-sm font-semibold text-slate-800">
                {g.title}
                <span className="text-xs font-normal text-slate-500">{countsText(list).slice(0, 3).join(" · ")}</span>
              </h3>
              <Grid tiles={list} nowMs={nowMs} />
            </div>
          );
        })
      ) : (
        <Grid tiles={shown} nowMs={nowMs} />
      )}
    </section>
  );
}
