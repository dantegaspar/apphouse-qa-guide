"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback";

type Activity = { id: number; name: string; active: number; help: number };
/** Solicitud de ayuda abierta en otra ronda (Mesa la lista aquí porque su tabla es solo de la ronda a la vista). */
type HelpItem = { id: string; runId: string; tester: string; where: string; ago: string; roundId: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Aviso en el panel y en Mesa: hay pruebas activas (o solicitudes de ayuda abiertas) en OTRA encuesta.
 * Pasa cuando el admin abre una ronda nueva y todavía hay testers terminando la anterior: sin este aviso
 * parecería que sus datos se perdieron. «Ver» cambia la vista a esa ronda (igual que el selector de arriba).
 */
export function OtherRoundsAlert({ rounds, help = [], activeMinutes }: { rounds: Activity[]; help?: HelpItem[]; activeMinutes: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!rounds.length) return null;
  const anyHelp = rounds.some((r) => r.help > 0);

  const view = async (id: number) => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/rounds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "view", id }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo cambiar de encuesta");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar de encuesta", { id: "admin-round" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="other-rounds-alert"
      className={`rounded-xl p-3 text-sm ring-1 print:hidden ${anyHelp ? "bg-red-50 text-red-900 ring-red-300" : "bg-amber-50 text-amber-900 ring-amber-300"}`}
    >
      <ul className="space-y-1.5">
        {rounds.map((r) => {
          const parts = [
            r.active > 0 && `${plural(r.active, "prueba sigue activa", "pruebas siguen activas")}`,
            r.help > 0 && `${plural(r.help, "solicitud de ayuda abierta", "solicitudes de ayuda abiertas")}`,
          ].filter(Boolean);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                <span className="font-semibold">{parts.join(" y ")}</span> en «{r.name}»
              </span>
              <span aria-hidden>·</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => view(r.id)}
                className="font-semibold text-[#2F5DA8] underline-offset-2 hover:underline disabled:opacity-50"
                data-testid="other-round-view"
              >
                Ver
              </button>
              {help
                .filter((h) => h.roundId === r.id)
                .map((h) => (
                  <span key={h.id} className="w-full pl-3 text-xs">
                    <Link href={`/admin/runs/${h.runId}`} className="font-semibold text-[#2F5DA8] hover:underline">
                      {h.tester}
                    </Link>{" "}
                    pide ayuda en {h.where} · {h.ago}
                  </span>
                ))}
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-xs opacity-80">
        No salen en esta vista: sus datos se guardan en su propia encuesta. «Activa»: sin terminar y con movimiento en los últimos {activeMinutes} min.
      </p>
    </section>
  );
}
