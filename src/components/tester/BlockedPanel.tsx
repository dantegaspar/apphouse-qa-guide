"use client";

import { useState } from "react";
import { END_CAUSES, type EndCause } from "@/lib/end-causes";
import { Button, FormField, Sheet } from "./ui";
import { focusFirstError, LIMITS } from "./validation";
import { callRun, type Blocked } from "./store";

/**
 * Panel de actividad bloqueada: el tester explica por qué no puede seguir y pide ayuda al guía.
 * Ya no se pide la contraseña del guía: si se resolvió, el tester continúa; si ya no puede seguir,
 * elige el motivo en una ventana y la prueba se cierra, pero todavía contesta la encuesta final.
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
  const [endOpen, setEndOpen] = useState(false);
  const [cause, setCause] = useState<EndCause | "">("");
  const [detail, setDetail] = useState("");
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
  const causeErr = cause ? null : "Elige por qué ya no puedes seguir.";
  const d = detail.trim();
  const detailErr =
    cause === "otro" && d.length < 5
      ? "Cuéntanos el motivo (al menos 5 letras)."
      : d.length > LIMITS.reason
        ? `Máximo ${LIMITS.reason} caracteres (llevas ${d.length}).`
        : null;

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

  const resolve = async () => {
    setBusy(true);
    setError(null);
    const r = await callRun(run, "help/resolve", { helpId: blocked.helpId });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onResolved();
  };

  const end = async () => {
    if (causeErr || detailErr) {
      setTried(true);
      focusFirstError(document.querySelector<HTMLElement>('[data-testid="end-sheet"]'));
      return;
    }
    setBusy(true);
    setError(null);
    const r = await callRun<{ endedAt: string; reason: string }>(run, "end", { cause, reason: d || blocked.reason });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setEndOpen(false);
    onEnded(r.data.reason || blocked.reason, r.data.endedAt || new Date().toISOString());
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

      {!endOpen && errorBox}
      <div className="space-y-2">
        <Button size="lg" variant="success" className="w-full" disabled={busy} onClick={() => void resolve()} data-testid="blocked-resolve">
          {busy && !endOpen ? "Enviando…" : "✓ Ya se resolvió, continuar"}
        </Button>
        <Button
          size="lg"
          variant="danger"
          className="w-full"
          data-testid="blocked-end"
          onClick={() => {
            setTried(false);
            setError(null);
            setEndOpen(true);
          }}
        >
          Ya no puedo seguir con la prueba
        </Button>
      </div>

      <Sheet
        open={endOpen}
        onClose={() => !busy && setEndOpen(false)}
        title="¿Por qué ya no puedes seguir?"
        footer={
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setEndOpen(false)}>
              Cancelar
            </Button>
            <Button className="!bg-rose-600 hover:!bg-rose-700" disabled={busy} onClick={() => void end()} data-testid="end-confirm">
              {busy ? "Enviando…" : "Terminar y contestar la encuesta →"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4" data-testid="end-sheet">
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200">
            Las actividades que faltan se cierran, pero <strong>la encuesta final sigue</strong>: contéstala para que tu prueba cuente.
          </p>
          <fieldset aria-invalid={tried && !!causeErr} aria-describedby={tried && causeErr ? "end-cause-error" : undefined}>
            <legend className="mb-2 text-sm font-semibold text-slate-800">Elige el motivo *</legend>
            <div className="space-y-2">
              {END_CAUSES.map((c) => (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 text-sm ring-1 transition ${
                    cause === c.id ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <input type="radio" name="end-cause" className="mt-0.5 h-5 w-5 shrink-0 accent-[#2f5da8]" checked={cause === c.id} onChange={() => setCause(c.id)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            {tried && causeErr && (
              <p id="end-cause-error" role="alert" className="mt-2 text-sm font-medium text-rose-700">
                {causeErr}
              </p>
            )}
          </fieldset>
          <FormField
            id="end-detail"
            label={cause === "otro" ? "Cuéntanos el motivo *" : "¿Algo más que debamos saber? (opcional)"}
            error={tried ? detailErr : null}
          >
            {(p) => <textarea {...p} className={p.className + " min-h-20"} value={detail} onChange={(e) => setDetail(e.target.value)} />}
          </FormField>
          {endOpen && errorBox}
        </div>
      </Sheet>
    </section>
  );
}
