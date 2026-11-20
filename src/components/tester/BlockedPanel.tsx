"use client";

import { useState } from "react";
import { Button, inputCls } from "./ui";
import { callRun, type Blocked } from "./store";

type Mode = null | "resolve" | "end";

/**
 * Panel de actividad bloqueada: el tester explica por qué no puede seguir y pide ayuda al guía.
 * Para desbloquear o terminar la prueba hace falta la contraseña del guía (se verifica en el servidor).
 */
export default function BlockedPanel({
  blocked,
  run,
  stepLabel,
  beforeRequest,
  onRequested,
  onResolved,
  onEnded,
}: {
  blocked: Blocked;
  run: { runId: string; token: string };
  stepLabel: string;
  /** Envía los datos pendientes (el reporte) antes de pedir ayuda. */
  beforeRequest: () => Promise<boolean>;
  onRequested: (helpId: string, reason: string, at: string) => void;
  onResolved: () => void;
  onEnded: (reason: string, at: string) => void;
}) {
  const [reason, setReason] = useState(blocked.reason);
  const [mode, setMode] = useState<Mode>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async () => {
    setBusy(true);
    setError(null);
    await beforeRequest();
    const r = await callRun<{ id: string; createdAt: string }>(run, "help", {
      activityId: blocked.activityId,
      stepId: blocked.stepId,
      issueId: blocked.issueId,
      reason: reason.trim(),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onRequested(r.data.id, reason.trim(), r.data.createdAt);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const r =
      mode === "resolve"
        ? await callRun(run, "help/resolve", { helpId: blocked.helpId, password })
        : await callRun<{ endedAt: string }>(run, "end", { password, reason: blocked.reason });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPassword("");
    if (mode === "resolve") onResolved();
    else onEnded(blocked.reason, (r.data as { endedAt?: string }).endedAt || new Date().toISOString());
  };

  const errorBox = error && (
    <p role="alert" className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-rose-700 ring-1 ring-rose-200">
      {error}
    </p>
  );

  if (!blocked.helpId) {
    return (
      <section className="space-y-3 rounded-2xl bg-rose-50 p-4 ring-2 ring-rose-300" data-testid="blocked-panel">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-rose-700">Actividad en pausa · {stepLabel}</div>
          <h2 className="mt-0.5 text-lg font-bold leading-snug text-rose-950">Reportaste una falla que te impide seguir</h2>
          <p className="mt-1 text-sm text-rose-900">
            No puedes avanzar hasta que el guía de la prueba te ayude. Explícale qué pasa y pide ayuda.
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-rose-950">¿Por qué no puedes seguir con la prueba? *</span>
          <textarea
            className={inputCls + " min-h-24"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Al tocar Pagar sale un error y no se crea el pedido."
          />
          <span className="mt-1 block text-xs text-rose-800">Revisa o corrige el texto antes de enviarlo.</span>
        </label>
        {errorBox}
        <Button size="lg" className="w-full !bg-rose-600 hover:!bg-rose-700" disabled={busy || reason.trim().length < 3} onClick={request}>
          {busy ? "Enviando…" : "🙋 Solicitar ayuda al guía de la prueba"}
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl bg-amber-50 p-4 ring-2 ring-amber-300" data-testid="blocked-panel">
      <div className="flex items-start gap-3">
        <span className="relative mt-1 flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
        </span>
        <div>
          <h2 className="text-lg font-bold leading-snug text-amber-950">Ayuda solicitada · espera al guía</h2>
          <p className="mt-1 text-sm text-amber-900">
            El guía ya ve tu solicitud. Avísale también en el <strong>grupo de WhatsApp</strong> de la prueba para que llegue más rápido.
          </p>
        </div>
      </div>
      <div className="rounded-xl bg-white/70 p-3 text-sm text-slate-700 ring-1 ring-amber-200">
        <div className="text-xs font-semibold uppercase text-slate-500">Motivo · {stepLabel}</div>
        <p className="mt-0.5 whitespace-pre-wrap">{blocked.reason}</p>
      </div>

      {mode === null ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-amber-900">Cuando llegue el guía:</p>
          <Button size="lg" variant="success" className="w-full" onClick={() => setMode("resolve")}>
            ✓ Ya se resolvió, continuar
          </Button>
          <Button size="lg" variant="danger" className="w-full" onClick={() => setMode("end")}>
            Terminar la prueba (contraseña del guía)
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <p className="text-sm font-semibold">
            {mode === "resolve" ? "El guía confirma que ya se resolvió" : "El guía termina la prueba"}
          </p>
          {mode === "end" && (
            <p className="text-xs text-slate-600">
              Se cerrarán todas las actividades. Después podrás ver tu resumen y contestar la encuesta.
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-sm">Contraseña del guía</span>
            <input
              className={inputCls}
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          {errorBox}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMode(null);
                setPassword("");
                setError(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" variant={mode === "resolve" ? "success" : "primary"} className={mode === "end" ? "!bg-rose-600" : ""} disabled={busy || !password}>
              {busy ? "Verificando…" : mode === "resolve" ? "Confirmar y continuar" : "Terminar la prueba"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
