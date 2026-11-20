"use client";

import { useEffect, useRef, useState } from "react";
import type { Guide } from "@/lib/types";
import { Confetti, motion, Sparkles, useReducedMotion } from "@/components/motion";
import { Button, FieldError, inputCls, inputErrCls } from "./ui";
import { focusFirstError, LIMITS } from "./validation";

export default function Survey({
  survey,
  initial,
  finished,
  onSubmit,
  onBack,
  onDraft,
  onDraftSync,
  submitLabel = "Enviar encuesta",
  beforeSubmit,
}: {
  submitLabel?: string;
  /** Confirmación antes del envío final (p. ej. «¿Terminar la prueba?»). false = no se envía. */
  beforeSubmit?: () => Promise<boolean>;
  survey: Guide["survey"];
  initial: Record<string, string | number>;
  finished: boolean;
  onSubmit: (answers: Record<string, string | number>) => void;
  onBack: () => void;
  /** Guarda el borrador en el navegador en cada cambio (sobrevive a recargas). */
  onDraft?: (answers: Record<string, string | number>) => void;
  /** Envía el borrador al servidor (se llama con pausa de ~1.5 s tras el último cambio). */
  onDraftSync?: (answers: Record<string, string | number>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | number>>(initial);
  const [sent, setSent] = useState(finished);
  const [tried, setTried] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // Festejo solo cuando se acaba de enviar (no al volver a ver la encuesta ya terminada)
  const [justSent, setJustSent] = useState(false);

  // Envío diferido del borrador al servidor
  const pending = useRef<Record<string, string | number> | null>(null);
  const syncRef = useRef(onDraftSync);
  useEffect(() => {
    syncRef.current = onDraftSync;
  }, [onDraftSync]);
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => {
      if (pending.current) syncRef.current?.(pending.current);
      pending.current = null;
    }, 1500);
    return () => clearTimeout(t);
  }, [savedAt]);
  // Al salir de la encuesta, se envía lo pendiente
  useEffect(
    () => () => {
      if (pending.current) syncRef.current?.(pending.current);
    },
    []
  );

  const set = (id: string, v: string | number) => {
    const next = { ...answers, [id]: v };
    setAnswers(next);
    onDraft?.(next);
    pending.current = next;
    setSavedAt((n) => (n ?? 0) + 1);
  };
  const isMissing = (id: string) => answers[id] === undefined || String(answers[id]).trim() === "";
  const errors: Record<string, string> = {};
  for (const q of survey.questions) {
    if (q.required && isMissing(q.id)) errors[q.id] = q.type === "text" ? "Escribe tu respuesta." : "Elige una opción.";
    else if (q.type === "text" && String(answers[q.id] ?? "").length > LIMITS.surveyText) errors[q.id] = `Máximo ${LIMITS.surveyText} caracteres.`;
  }
  const missing = Object.keys(errors);
  const shown = tried ? errors : {};

  if (sent) {
    return (
      <div className="animate-pop flex flex-col items-center py-12 text-center" data-testid="survey-done">
        {justSent && <Confetti count={44} />}
        <motion.div
          className="relative text-6xl"
          initial={reduce ? { opacity: 0 } : { scale: 0.2, rotate: -30, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { scale: [0.2, 1.3, 1], rotate: [-30, 12, 0], opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <motion.span
            className="inline-block"
            animate={reduce ? { opacity: [1, 0.7, 1] } : { y: [0, -8, 0], rotate: [0, -6, 6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1, delay: 0.7 }}
          >
            🎉
          </motion.span>
          <Sparkles count={12} radius={70} size={14} delay={0.2} loop={justSent} />
        </motion.div>
        <h1 className="mt-4 text-2xl font-bold">¡Prueba terminada!</h1>
        <p className="mt-2 max-w-sm text-slate-600">
          Gracias por tu ayuda. Tus resultados, reportes y respuestas ya están guardados. Avisa en el grupo que terminaste.
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Ver resumen
          </Button>
          <Button variant="ghost" onClick={() => setSent(false)}>
            Editar respuestas
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-pop space-y-4 pb-8" ref={rootRef}>
      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack} className="min-h-11 text-sm font-medium text-brand-600">
          ← Resumen
        </button>
        <span className="text-xs text-slate-600" role="status" data-testid="survey-autosave">
          {savedAt !== null ? "✓ Guardado automáticamente" : "Tus respuestas se guardan solas"}
        </span>
      </div>
      <h1 className="text-2xl font-bold">{survey.title}</h1>
      {survey.intro && <p className="text-slate-700">{survey.intro}</p>}
      <p className="text-sm text-slate-600">Las preguntas con * son obligatorias.</p>
      {survey.questions.map((q, n) => (
        <fieldset
          key={q.id}
          className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${shown[q.id] ? "ring-2 ring-rose-400" : "ring-slate-200"}`}
          data-error={shown[q.id] ? "true" : undefined}
          aria-invalid={q.type !== "text" && shown[q.id] ? true : undefined}
          aria-describedby={shown[q.id] ? `q-${q.id}-err` : undefined}
        >
          <legend className="sr-only">
            {q.label}
            {q.required ? " (obligatoria)" : ""}
          </legend>
          <p className="mb-3 font-medium" aria-hidden="true">
            {n + 1}. {q.label}
            {q.required && <span className="text-rose-700"> *</span>}
          </p>
          {(q.type === "scale" || q.type === "nps") && (
            <>
              <div className={`grid gap-1.5 ${q.type === "nps" ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-5"}`}>
                {Array.from({ length: (q.type === "nps" ? 10 : (q.max ?? 5)) - (q.type === "nps" ? 0 : (q.min ?? 1)) + 1 }, (_, i) =>
                  (q.type === "nps" ? 0 : (q.min ?? 1)) + i
                ).map((v) => (
                  <motion.button
                    key={v}
                    type="button"
                    onClick={() => set(q.id, v)}
                    aria-pressed={answers[q.id] === v}
                    whileTap={reduce ? { opacity: 0.8 } : { scale: 0.88 }}
                    animate={answers[q.id] === v && !reduce ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={`min-h-11 rounded-lg py-2.5 text-sm font-semibold ring-1 transition-colors ${
                      answers[q.id] === v ? "bg-brand-500 text-white ring-brand-500" : "bg-white ring-slate-300"
                    }`}
                  >
                    {v}
                  </motion.button>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-600">
                <span>{q.type === "nps" ? "Nada probable" : q.minLabel}</span>
                <span>{q.type === "nps" ? "Muy probable" : q.maxLabel}</span>
              </div>
            </>
          )}
          {q.type === "choice" && (
            <div className="space-y-2">
              {q.options?.map((o) => (
                <motion.button
                  key={o}
                  type="button"
                  onClick={() => set(q.id, o)}
                  aria-pressed={answers[q.id] === o}
                  whileTap={reduce ? { opacity: 0.8 } : { scale: 0.97 }}
                  animate={answers[q.id] === o && !reduce ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                  transition={{ duration: 0.25 }}
                  className={`block min-h-11 w-full rounded-xl px-4 py-3 text-left text-sm ring-1 transition-colors ${
                    answers[q.id] === o ? "bg-brand-500 font-medium text-white ring-brand-500" : "bg-white ring-slate-300"
                  }`}
                >
                  {o}
                </motion.button>
              ))}
            </div>
          )}
          {q.type === "text" && (
            <textarea
              className={(shown[q.id] ? inputErrCls : inputCls) + " min-h-20"}
              aria-label={q.label}
              aria-invalid={!!shown[q.id]}
              aria-describedby={shown[q.id] ? `q-${q.id}-err` : undefined}
              maxLength={LIMITS.surveyText + 100}
              value={String(answers[q.id] ?? "")}
              onChange={(e) => set(q.id, e.target.value)}
            />
          )}
          {shown[q.id] && <FieldError id={`q-${q.id}-err`}>{shown[q.id]}</FieldError>}
        </fieldset>
      ))}
      {tried && missing.length > 0 && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800" role="alert">
          {missing.length === 1 ? "Falta 1 respuesta obligatoria" : `Faltan ${missing.length} respuestas obligatorias`} (marcadas en rojo).
        </p>
      )}
      <Button
        size="lg"
        className="w-full"
        pulse={missing.length === 0}
        onClick={async () => {
          if (missing.length) {
            setTried(true);
            focusFirstError(rootRef.current);
            return;
          }
          if (beforeSubmit && !(await beforeSubmit())) return;
          const clean = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
          pending.current = null;
          onSubmit(clean);
          setSent(true);
          setJustSent(true);
          window.scrollTo({ top: 0 });
        }}
      >
        {submitLabel}
      </Button>
      {!tried && missing.length > 0 && (
        <p className="-mt-2 text-center text-xs text-slate-600">
          {missing.length === 1 ? "Falta 1 respuesta obligatoria" : `Faltan ${missing.length} respuestas obligatorias`}
        </p>
      )}
    </div>
  );
}
