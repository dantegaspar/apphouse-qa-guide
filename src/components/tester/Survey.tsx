"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Guide, SurveyQuestion } from "@/lib/types";
import { Confetti, motion, Sparkles, useReducedMotion } from "@/components/motion";
import { Button, FieldError, inputCls, inputErrCls } from "./ui";
import { focusFirstError, LIMITS } from "./validation";

/** Las preguntas abiertas pueden traer un texto de ejemplo (`placeholder`) en el JSON de la guía. */
type Question = SurveyQuestion & { placeholder?: string };

/** Columnas según la cantidad de puntos de la escala (clases fijas para que Tailwind las genere). */
const SCALE_COLS: Record<number, string> = {
  2: "grid-cols-2 gap-1.5",
  3: "grid-cols-3 gap-1.5",
  4: "grid-cols-4 gap-1.5",
  5: "grid-cols-5 gap-1.5",
  6: "grid-cols-6 gap-1.5",
  7: "grid-cols-7 gap-1",
};

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
  pendingSend,
  onRetry,
  deviceLabel = "este teléfono",
  wide = false,
}: {
  submitLabel?: string;
  /** Confirmación antes del envío final (p. ej. «¿Terminar la prueba?»). false = no se envía. */
  beforeSubmit?: () => Promise<boolean>;
  survey: Guide["survey"];
  initial: Record<string, string | number>;
  finished: boolean;
  /** Guarda y envía la encuesta. Devuelve true si ya llegó al servidor, false si quedó pendiente. */
  onSubmit: (answers: Record<string, string | number>) => Promise<boolean> | boolean | void;
  onBack: () => void;
  /** Guarda el borrador en el navegador en cada cambio (sobrevive a recargas). */
  onDraft?: (answers: Record<string, string | number>) => void;
  /** Envía el borrador al servidor (se llama con pausa de ~1.5 s tras el último cambio). */
  onDraftSync?: (answers: Record<string, string | number>) => void;
  /** true = la encuesta ya se envió, pero todavía no llega al servidor (sin internet). */
  pendingSend?: boolean;
  /** Reintenta el envío de lo pendiente. Devuelve true si ya llegó. */
  onRetry?: () => Promise<boolean>;
  /** «este teléfono» o «esta computadora», para los avisos. */
  deviceLabel?: string;
  /** Pantalla de computadora: las opciones largas van en 2 columnas. */
  wide?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string | number>>(initial);
  const [sent, setSent] = useState(finished);
  const [tried, setTried] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  // Resultado del último intento (si quien usa el componente no informa `pendingSend`)
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const uidBase = useId();
  // Festejo solo cuando se acaba de enviar (no al volver a ver la encuesta ya terminada)
  const [justSent, setJustSent] = useState(false);
  const unsent = pendingSend ?? failed;

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

  const retry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setRetryFailed(false);
    const ok = await onRetry().catch(() => false);
    setRetrying(false);
    setFailed(!ok);
    setRetryFailed(!ok);
  };

  if (sent) {
    if (unsent) {
      return (
        <div className="animate-pop flex flex-col items-center py-12 text-center" data-testid="survey-pending">
          <div className="text-5xl" aria-hidden="true">
            📶
          </div>
          <h1 className="mt-4 text-2xl font-bold">Falta enviar tus respuestas</h1>
          <div className="mt-3 max-w-md rounded-2xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-950 ring-1 ring-amber-300" role="alert">
            <p>
              Tus respuestas quedaron guardadas en {deviceLabel}, pero <strong>falta internet</strong> para que lleguen a Mesa de control.
            </p>
            <p className="mt-2">
              Conéctate a internet y toca <strong>«Reintentar envío»</strong>. No cierres esta página ni borres el historial hasta que veas
              «Ya se recibieron».
            </p>
          </div>
          {onRetry && (
            <Button size="lg" className="mt-5 w-full max-w-md" onClick={retry} disabled={retrying}>
              {retrying ? "Enviando…" : "Reintentar envío"}
            </Button>
          )}
          {retryFailed && !retrying && (
            <p className="mt-2 max-w-md text-sm text-amber-800" role="status">
              Todavía no hay conexión. Se seguirá intentando solo; si no se envía, avisa a Mesa de control.
            </p>
          )}
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
        <p className="mt-2 max-w-sm text-slate-600" role="status">
          Gracias por tu ayuda. Tus resultados, reportes y respuestas ya se recibieron en Mesa de control.
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Ver resumen
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
        <span className="text-right text-xs text-slate-600" role="status" data-testid="survey-autosave">
          {savedAt !== null ? `✓ Borrador guardado en ${deviceLabel} · falta enviar` : `Se guarda solo en ${deviceLabel} mientras contestas`}
        </span>
      </div>
      <h1 className="text-2xl font-bold">{survey.title}</h1>
      {survey.intro && <p className="text-slate-700">{survey.intro}</p>}
      <p className="text-sm text-slate-600">Las preguntas con * son obligatorias.</p>
      {(survey.questions as Question[]).map((q, n) => {
        const legendId = `${uidBase}-q-${q.id}`;
        const errId = `q-${q.id}-err`;
        const err = shown[q.id];
        return (
          <fieldset
            key={q.id}
            className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${err ? "ring-2 ring-rose-400" : "ring-slate-200"}`}
            data-error={err ? "true" : undefined}
          >
            {/* float + w-full: la leyenda queda dentro de la tarjeta (con su relleno), no sobre el borde */}
            <legend id={legendId} className="float-left mb-3 w-full font-medium">
              {n + 1}. {q.label}
              {q.required && (
                <>
                  <span className="text-rose-700" aria-hidden="true">
                    {" "}
                    *
                  </span>
                  <span className="sr-only"> (obligatoria)</span>
                </>
              )}
            </legend>
            <div className="clear-both">
              {(q.type === "scale" || q.type === "nps") && <ScaleQuestion q={q} value={answers[q.id]} onPick={(v) => set(q.id, v)} legendId={legendId} errId={err ? errId : undefined} reduce={!!reduce} />}
              {q.type === "choice" && (
                <RadioGroup
                  labelledBy={legendId}
                  describedBy={err ? errId : undefined}
                  invalid={!!err}
                  options={q.options ?? []}
                  value={answers[q.id]}
                  onPick={(o) => set(q.id, o)}
                  className={"grid gap-2" + (wide ? " lg:grid-cols-2" : "")}
                >
                  {(o, on, props) => (
                    <motion.button
                      key={o}
                      {...props}
                      whileTap={reduce ? { opacity: 0.8 } : { scale: 0.97 }}
                      animate={on && !reduce ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                      transition={{ duration: 0.25 }}
                      className={`block min-h-11 w-full rounded-xl px-4 py-3 text-left text-sm ring-1 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 ${
                        on ? "bg-brand-500 font-medium text-white ring-brand-500" : "bg-white ring-slate-300"
                      } ${wide && /^ningun/i.test(o) ? "lg:col-span-2" : ""}`}
                    >
                      {o}
                    </motion.button>
                  )}
                </RadioGroup>
              )}
              {q.type === "text" && (
                <TextQuestion
                  value={String(answers[q.id] ?? "")}
                  onChange={(v) => set(q.id, v)}
                  labelledBy={legendId}
                  errId={err ? errId : undefined}
                  placeholder={q.placeholder}
                />
              )}
              {err && <FieldError id={errId}>{err}</FieldError>}
            </div>
          </fieldset>
        );
      })}
      {tried && missing.length > 0 && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800" role="alert">
          {missing.length === 1 ? "Falta 1 respuesta obligatoria" : `Faltan ${missing.length} respuestas obligatorias`} (marcadas en rojo).
        </p>
      )}
      <Button
        size="lg"
        className="w-full"
        pulse={missing.length === 0 && !sending}
        disabled={sending}
        onClick={async () => {
          if (sending) return;
          if (missing.length) {
            setTried(true);
            focusFirstError(rootRef.current);
            return;
          }
          if (beforeSubmit && !(await beforeSubmit())) return;
          const clean = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
          pending.current = null;
          setSending(true);
          // Se espera el envío real: solo se festeja si ya llegó a Mesa de control
          const ok = (await Promise.resolve(onSubmit(clean)).catch(() => false)) !== false;
          setSending(false);
          setFailed(!ok);
          setRetryFailed(false);
          setSent(true);
          setJustSent(true);
          window.scrollTo({ top: 0 });
        }}
      >
        {sending ? "Enviando…" : submitLabel}
      </Button>
      {!tried && missing.length > 0 && (
        <p className="-mt-2 text-center text-xs text-slate-600">
          {missing.length === 1 ? "Falta 1 respuesta obligatoria" : `Faltan ${missing.length} respuestas obligatorias`}
        </p>
      )}
    </div>
  );
}

type RadioProps = {
  type: "button";
  role: "radio";
  "aria-checked": boolean;
  tabIndex: number;
  "data-radio": string;
  onClick: () => void;
};

/**
 * Grupo de opciones de una sola respuesta (radiogroup accesible): con Tab se entra y sale del
 * grupo en una sola parada, y con las flechas se cambia la opción elegida.
 */
function RadioGroup<T extends string | number>({
  labelledBy,
  describedBy,
  invalid,
  options,
  value,
  onPick,
  className,
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  invalid: boolean;
  options: T[];
  value: string | number | undefined;
  onPick: (o: T) => void;
  className: string;
  children: (o: T, on: boolean, props: RadioProps) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.findIndex((o) => o === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const radios = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
    const cur = radios.indexOf(document.activeElement as HTMLElement);
    if (cur < 0 || !options.length) return;
    let next: number;
    if (e.key in keys) next = (cur + keys[e.key] + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    else return;
    e.preventDefault();
    onPick(options[next]);
    radios[next]?.focus();
  };
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      onKeyDown={onKeyDown}
      className={className}
    >
      {options.map((o, i) =>
        children(o, i === selected, {
          type: "button",
          role: "radio",
          "aria-checked": i === selected,
          tabIndex: i === selected || (selected < 0 && i === 0) ? 0 : -1,
          "data-radio": String(o),
          onClick: () => onPick(o),
        })
      )}
    </div>
  );
}

function ScaleQuestion({
  q,
  value,
  onPick,
  legendId,
  errId,
  reduce,
}: {
  q: Question;
  value: string | number | undefined;
  onPick: (v: number) => void;
  legendId: string;
  errId?: string;
  reduce: boolean;
}) {
  const nps = q.type === "nps";
  const min = nps ? 0 : (q.min ?? 1);
  const max = nps ? 10 : (q.max ?? 5);
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const cols = nps ? "grid-cols-6 gap-1.5 sm:grid-cols-11" : (SCALE_COLS[values.length] ?? "grid-cols-5 gap-1.5 sm:grid-cols-7");
  const minLabel = nps ? "Nada probable" : q.minLabel;
  const maxLabel = nps ? "Muy probable" : q.maxLabel;
  return (
    <>
      <RadioGroup
        labelledBy={legendId}
        describedBy={errId}
        invalid={!!errId}
        options={values}
        value={value}
        onPick={onPick}
        className={`grid ${cols}`}
      >
        {(v, on, props) => (
          <motion.button
            key={v}
            {...props}
            aria-label={v === min && minLabel ? `${v}, ${minLabel}` : v === max && maxLabel ? `${v}, ${maxLabel}` : undefined}
            whileTap={reduce ? { opacity: 0.8 } : { scale: 0.88 }}
            animate={on && !reduce ? { scale: [1, 1.18, 1] } : { scale: 1 }}
            transition={{ duration: 0.3 }}
            className={`min-h-11 rounded-lg py-2.5 text-sm font-semibold ring-1 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 ${
              on ? "bg-brand-500 text-white ring-brand-500" : "bg-white ring-slate-300"
            }`}
          >
            {v}
          </motion.button>
        )}
      </RadioGroup>
      {(minLabel || maxLabel) && (
        <div className="mt-1.5 flex justify-between gap-3 text-xs text-slate-600" aria-hidden="true">
          <span>{minLabel ? `${min} · ${minLabel}` : ""}</span>
          <span className="text-right">{maxLabel ? `${max} · ${maxLabel}` : ""}</span>
        </div>
      )}
    </>
  );
}

function TextQuestion({
  value,
  onChange,
  labelledBy,
  errId,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  labelledBy: string;
  errId?: string;
  placeholder?: string;
}) {
  const max = LIMITS.surveyText;
  const showCount = value.length >= max * 0.8;
  const countId = `${labelledBy}-count`;
  return (
    <>
      <textarea
        className={(errId ? inputErrCls : inputCls) + " min-h-24"}
        aria-labelledby={labelledBy}
        aria-invalid={!!errId}
        aria-describedby={[errId, showCount ? countId : ""].filter(Boolean).join(" ") || undefined}
        maxLength={max}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {showCount && (
        <p id={countId} className={`mt-1 text-right text-xs ${value.length >= max ? "font-medium text-rose-700" : "text-slate-600"}`}>
          {value.length} de {max} caracteres
        </p>
      )}
    </>
  );
}
