"use client";

import { useState } from "react";
import { confirm } from "@/components/feedback";
import { Button, FormField } from "./ui";
import { focusFirstError, LIMITS } from "./validation";
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
  const [tried, setTried] = useState(false);
  const r = reason.trim();
  const reasonErr = !r
    ? "Escribe por qué no puedes seguir."
    : r.length < 5
      ? "Escribe un poco más (al menos 5 letras) para que el guía entienda."
      : r.length > LIMITS.reason
        ? `Máximo ${LIMITS.reason} caracteres (llevas ${r.length}).`
        : null;
  const pwErr = password.trim() ? null : "Escribe la contraseña del guía.";

  const request = async () => {
    if (reasonErr) {
      setTried(true);
      focusFirstError(document.querySelector<HTMLElement>('[data-testid="blocked-panel"]'));
      return;
    }
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

  const submitPassword = async () => {
    if (pwErr) {
      setTried(true);
      focusFirstError(document.querySelector<HTMLElement>('[data-testid="blocked-panel"]'));
      return;
    }
    if (
      mode === "end" &&
      !(await confirm({
        title: "¿Terminar la prueba?",
        message: "Se cerrarán todas las actividades que faltan y ya no podrás seguir. Después verás tu resumen y la encuesta.",
        confirmLabel: "Sí, terminar la prueba",
        cancelLabel: "Seguir en pausa",
        tone: "danger",
      }))
    )
      return;
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
        <FormField
          id="blocked-reason"
          label="¿Por qué no puedes seguir con la prueba? *"
          labelClassName="mb-1 block text-sm font-semibold text-rose-950"
          error={tried ? reasonErr : null}
          hint={<span className="text-rose-900">Revisa o corrige el texto antes de enviarlo.</span>}
        >
          {(p) => (
            <textarea
              {...p}
              className={p.className + " min-h-24"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. Al tocar Pagar sale un error y no se crea el pedido."
            />
          )}
        </FormField>
        {errorBox}
        <Button size="lg" pulse={!reasonErr && !busy} className="w-full !bg-rose-600 hover:!bg-rose-700" disabled={busy} onClick={request}>
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
        <div className="text-xs font-semibold uppercase text-slate-600">Motivo · {stepLabel}</div>
        <p className="mt-0.5 whitespace-pre-wrap">{blocked.reason}</p>
      </div>

      {mode === null ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-amber-900">Cuando llegue el guía:</p>
          <Button size="lg" variant="success" className="w-full" onClick={() => { setTried(false); setMode("resolve"); }}>
            ✓ Ya se resolvió, continuar
          </Button>
          <Button size="lg" variant="danger" className="w-full" onClick={() => { setTried(false); setMode("end"); }}>
            Terminar la prueba (contraseña del guía)
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200"
          onSubmit={(e) => {
            e.preventDefault();
            void submitPassword();
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
          <FormField id="guide-password" label="Contraseña del guía" error={tried ? pwErr : null}>
            {(p) => (
              <input {...p} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            )}
          </FormField>
          {errorBox}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMode(null);
                setPassword("");
                setError(null);
                setTried(false);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" variant={mode === "resolve" ? "success" : "primary"} className={mode === "end" ? "!bg-rose-600" : ""} disabled={busy}>
              {busy ? "Verificando…" : mode === "resolve" ? "Confirmar y continuar" : "Terminar la prueba"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
