"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ALLOWED_PHOTO_TYPES,
  COURIER_NA,
  COURIER_NA_LABEL,
  COURIER_QUESTIONS,
  FACES,
  guessPhotoMime,
  ROUND_CLOSED,
  type CourierAnswer,
} from "@/lib/courier";
import {
  COURIER_RULES,
  courierAnswerError,
  courierCommentError,
  courierIssueError,
  courierNameError,
  phoneError,
  type FieldErrors,
} from "@/lib/validate";
import { compressImage, detectDevice, uid } from "@/components/tester/store";
import { toast, useConfirm } from "@/components/feedback";
import { Confetti, motion, Sparkles, staggerItem, staggerList, useReducedMotion } from "@/components/motion";
import { clearPhotos, deletePhoto, getPhoto, putPhoto } from "./photos";

/**
 * Encuesta para repartidores: una sola pantalla, botones grandes y palabras sencillas.
 * El borrador vive en localStorage (y las fotos en IndexedDB) hasta que se envía.
 */

type DraftPhoto = { id: string; name: string; size: number };
type DraftIssue = { id: string; description: string; photo?: DraftPhoto };
type Draft = {
  id: string;
  token: string;
  name: string;
  phone: string;
  answers: Record<string, CourierAnswer>;
  comment: string;
  issues: DraftIssue[];
};
type Sent = { id: string; token: string; name: string; issues: number };
type NewIssue = { id: string; description: string; photo: File | null };

const KEY = "apphouse-repartidor:draft";
const OFFLINE = "No hay internet.";
/** Anillo de foco visible con teclado (no cambia el aspecto al tocar). */
const FOCUS = "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-600";
/** Cada cuánto se reintenta solo un envío que falló por falta de internet (además del evento «online»). */
const RETRY_MS = 30_000;

function newToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
const newDraft = (): Draft => ({ id: uid(), token: newToken(), name: "", phone: "", answers: {}, comment: "", issues: [] });

function loadDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null") as Draft | null;
    return d && typeof d.id === "string" && typeof d.token === "string" && Array.isArray(d.issues) ? d : null;
  } catch {
    return null;
  }
}

/** Último error de validación del servidor (`{ error, fields }`), para marcar los campos. */
let lastFields: FieldErrors = {};
/** Código del último error del servidor (`{ error, code }`), p. ej. ROUND_CLOSED. */
let lastCode: string | undefined;

/**
 * Llama al servidor. Devuelve null si salió bien, o el mensaje de error (OFFLINE si no hay red).
 * Si el servidor rechaza datos, sus errores por campo quedan en `lastFields`.
 */
async function api(url: string, init: RequestInit): Promise<string | null> {
  lastFields = {};
  lastCode = undefined;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE;
  try {
    const res = await fetch(url, init);
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldErrors; code?: string };
    if (data.fields && typeof data.fields === "object") lastFields = data.fields;
    if (typeof data.code === "string") lastCode = data.code;
    return data.error || "No se pudo enviar. Inténtalo de nuevo.";
  } catch {
    return OFFLINE;
  }
}

/**
 * Ids nuevos para la encuesta, sus problemas y sus fotos (las fotos se copian en IndexedDB con su id
 * nuevo). Se usa cuando el servidor dice que la encuesta es de una ronda anterior (ROUND_CLOSED):
 * así se manda otra vez como encuesta nueva, con las mismas respuestas, sin tocar la anterior.
 * Devuelve también el cambio de ids de las fotos (viejo → nuevo).
 */
async function rekeyDraft(d: Draft): Promise<{ draft: Draft; photoIds: Map<string, string> }> {
  const photoIds = new Map<string, string>();
  const issues: DraftIssue[] = [];
  for (const it of d.issues) {
    let photo = it.photo;
    if (photo) {
      const pid = uid();
      const blob = await getPhoto(photo.id);
      if (blob) {
        await putPhoto(pid, blob);
        await deletePhoto(photo.id);
      }
      photoIds.set(photo.id, pid);
      photo = { ...photo, id: pid };
    }
    issues.push({ ...it, id: uid(), photo });
  }
  return { draft: { ...d, id: uid(), token: newToken(), issues }, photoIds };
}

/** Mismas reglas que el servidor (src/lib/validate.ts). */
function validateDraft(d: Draft): FieldErrors {
  const e: FieldErrors = {};
  const name = courierNameError(d.name);
  if (name) e.name = name;
  const phone = phoneError(d.phone);
  if (phone) e.phone = phone;
  const comment = courierCommentError(d.comment);
  if (comment) e.comment = comment;
  for (const q of COURIER_QUESTIONS) {
    const a = courierAnswerError(d.answers[q.id], q.na);
    if (a) e[`answers.${q.id}`] = a;
  }
  return e;
}

/** Enfoca (y muestra) el elemento; para las preguntas, la primera carita. */
function focusField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const target = (el.matches("input,textarea,button") ? el : el.querySelector<HTMLElement>("input,textarea,button,[role=radio]")) ?? el;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  (target as HTMLElement).focus({ preventScroll: true });
}

/**
 * Flechas, Inicio y Fin dentro de un grupo de opciones (role="radiogroup"): mueven el foco y eligen,
 * como los botones de opción nativos. `select` recibe la posición de la opción.
 */
function radioKeys(e: KeyboardEvent<HTMLElement>, select: (index: number) => void) {
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const cur = radios.indexOf(document.activeElement as HTMLElement);
  if (cur < 0) return;
  const last = radios.length - 1;
  const moves: Record<string, number> = {
    ArrowRight: cur === last ? 0 : cur + 1,
    ArrowDown: cur === last ? 0 : cur + 1,
    ArrowLeft: cur === 0 ? last : cur - 1,
    ArrowUp: cur === 0 ? last : cur - 1,
    Home: 0,
    End: last,
  };
  const next = moves[e.key];
  if (next === undefined) return;
  e.preventDefault();
  select(next);
  radios[next].focus();
}

/** Contador de caracteres que aparece cerca del límite (cuenta igual que `maxLength`). */
function Counter({ value, max }: { value: string; max: number }) {
  const n = value.length;
  if (n < max * 0.8) return null;
  return (
    <span className={`mt-1 block text-right text-sm ${n > max ? "font-semibold text-rose-700" : "text-slate-500"}`}>
      {n} de {max}
    </span>
  );
}

/** Mientras está montado, llama a `onRetry` al volver la señal y cada RETRY_MS si hay red. */
function RetryWhenOnline({ onRetry }: { onRetry: () => void }) {
  const fire = useEffectEvent(onRetry);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    // Al volver la señal la red tarda un poco en estar lista
    const onOnline = () => {
      clearTimeout(t);
      t = setTimeout(() => fire(), 1500);
    };
    const every = setInterval(() => navigator.onLine && fire(), RETRY_MS);
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(t);
      clearInterval(every);
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return null;
}

/** Cómo tomar captura de pantalla según el sistema del celular. */
function CaptureHint({ os }: { os?: string }) {
  const ios = /^iOS/.test(os ?? "");
  const android = /^Android/.test(os ?? "");
  return (
    <p className="mt-2 text-sm text-slate-600">
      {ios ? (
        <>
          Para tomar una foto de la pantalla, aprieta al mismo tiempo el botón de <b>subir volumen</b> y el <b>botón lateral</b>.
        </>
      ) : android ? (
        <>
          Para tomar una foto de la pantalla, aprieta al mismo tiempo el botón de <b>bajar volumen</b> y el de <b>encendido</b>.
        </>
      ) : (
        <>
          Para tomar una foto de la pantalla: en Android aprieta <b>bajar volumen + encendido</b>; en iPhone, <b>subir volumen + botón
          lateral</b>.
        </>
      )}{" "}
      La foto es opcional.
    </p>
  );
}

async function uploadPhoto(feedbackId: string, token: string, issueId: string, photoId: string, file: Blob, name: string) {
  const fd = new FormData();
  fd.append("file", file instanceof File ? file : new File([file], name, { type: file.type }));
  fd.append("issueId", issueId);
  fd.append("photoId", photoId);
  return api(`/api/repartidor/${feedbackId}/photos`, { method: "POST", headers: { "x-courier-token": token }, body: fd });
}

export default function CourierSurvey({ maxUploadMb }: { maxUploadMb: number }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const reduce = useReducedMotion();
  const [restored, setRestored] = useState(false);
  const [device, setDevice] = useState<Record<string, string | number>>({});
  const [editing, setEditing] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState<Sent | null>(null);
  /** El envío falló por falta de internet: se reintenta solo al volver la señal. */
  const [autoRetry, setAutoRetry] = useState(false);
  /** Fotos del borrador que ya no están en el celular (p. ej. modo privado y se recargó). */
  const [missingPhotos, setMissingPhotos] = useState<Set<string>>(() => new Set());
  const ref = useRef<Draft | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    const d = loadDraft();
    ref.current = d ?? newDraft();
    // localStorage solo existe en el cliente
    setDraft(ref.current);
    setRestored(Boolean(d && (d.name || Object.keys(d.answers).length || d.issues.length || d.comment)));
    detectDevice().then(setDevice, () => {});
    const withPhoto = ref.current.issues.flatMap((i) => (i.photo ? [i.photo.id] : []));
    if (withPhoto.length)
      void Promise.all(withPhoto.map(async (pid) => ((await getPhoto(pid)) ? null : pid))).then((ids) => {
        const lost = ids.filter((x): x is string => x !== null);
        if (lost.length) setMissingPhotos(new Set(lost));
      });
  }, []);

  const update = useCallback((fn: (d: Draft) => Draft) => {
    if (!ref.current) return;
    const next = fn(ref.current);
    ref.current = next;
    setDraft(next);
    setServerErrors({});
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* modo privado o almacenamiento lleno: el borrador queda solo en pantalla */
    }
  }, []);

  if (!draft) {
    return <main className="flex flex-1 items-center justify-center p-6 text-lg text-slate-500">Cargando…</main>;
  }

  if (sent) {
    return (
      <ThankYou
        sent={sent}
        maxUploadMb={maxUploadMb}
        os={String(device.os ?? "")}
        onIssueSent={() => setSent({ ...sent, issues: sent.issues + 1 })}
        onAgain={async (carry) => {
          const next = newDraft();
          // Problema que no se pudo agregar a la encuesta anterior (ronda cerrada): queda anotado en la nueva
          if (carry) {
            let photo: DraftPhoto | undefined;
            if (carry.photo) {
              photo = { id: uid(), name: carry.photo.name || "captura.jpg", size: carry.photo.size };
              await putPhoto(photo.id, carry.photo);
            }
            next.issues = [{ id: uid(), description: carry.description, photo }];
            try {
              localStorage.setItem(KEY, JSON.stringify(next));
            } catch {
              /* modo privado o almacenamiento lleno: el borrador queda solo en pantalla */
            }
          }
          ref.current = next;
          setDraft(ref.current);
          setSent(null);
          setShowErrors(false);
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  const choose = (qid: string, v: CourierAnswer) => update((d) => ({ ...d, answers: { ...d.answers, [qid]: v } }));

  const errs: FieldErrors = { ...validateDraft(draft), ...serverErrors };
  /** Error visible de un campo: tras intentar enviar, al salir del campo, o si lo marcó el servidor. */
  const shown = (k: string) => (showErrors || touched[k] || k in serverErrors ? errs[k] : undefined);
  const missing = COURIER_QUESTIONS.filter((q) => errs[`answers.${q.id}`]);
  const problems: string[] = [];
  if (errs.name) problems.push(errs.name);
  if (errs.phone) problems.push(errs.phone);
  if (missing.length)
    problems.push(
      missing.length === 1 ? "Te falta 1 pregunta. Toca una carita." : `Te faltan ${missing.length} preguntas. Toca una carita en cada una.`
    );
  if (errs.comment) problems.push(errs.comment);
  if (editing && editorDirty) problems.push("Tienes un problema sin guardar. Toca «Guardar problema» o «Cancelar».");

  /** Id del primer elemento con error, en el orden de la pantalla. */
  const firstError = (e: FieldErrors) => {
    if (e.name) return "c-name-input";
    if (e.phone) return "c-phone-input";
    const q = COURIER_QUESTIONS.find((x) => e[`answers.${x.id}`]);
    if (q) return `q-${q.id}`;
    if (e.comment) return "c-comment-input";
    const issue = Object.keys(e).find((k) => k.startsWith("issues"));
    if (issue || (editing && editorDirty)) return "c-issues";
    return null;
  };

  /** Manda la encuesta y luego cada foto. Se detiene en el primer error (queda en `lastCode`/`lastFields`). */
  const sendDraft = async (d: Draft) => {
    let error = await api("/api/repartidor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: d.id,
        token: d.token,
        name: d.name,
        phone: d.phone,
        device,
        answers: d.answers,
        comment: d.comment,
        issues: d.issues.map((i) => ({ id: i.id, description: i.description })),
      }),
    });
    let lostPhotos = 0;
    for (const it of d.issues) {
      if (error) break;
      if (!it.photo) continue;
      const blob = await getPhoto(it.photo.id);
      // La foto ya no está en el celular (p. ej. modo privado y se recargó): se avisa abajo y al terminar
      if (!blob) {
        lostPhotos++;
        continue;
      }
      error = await uploadPhoto(d.id, d.token, it.id, it.photo.id, blob, it.photo.name);
    }
    return { error, lostPhotos };
  };

  /** `auto`: reintento solo al volver la señal; si ahora falta algo, espera a que la persona toque «Enviar». */
  const send = async (auto = false) => {
    if (auto && (problems.length || sending)) return;
    setShowErrors(true);
    setSendError(null);
    if (problems.length) {
      toast.error(problems.length === 1 ? problems[0] : "Revisa lo que está marcado en rojo.", { id: "courier-form", title: "Falta algo" });
      const first = firstError(errs) ?? "c-issues";
      // Espera a que se pinten los mensajes antes de mover el foco
      requestAnimationFrame(() => focusField(first));
      return;
    }
    let d = ref.current!;
    setSending(true);
    try {
      let { error, lostPhotos } = await sendDraft(d);
      if (error && lastCode === ROUND_CLOSED) {
        // Se abrió una ronda nueva desde que esta encuesta se mandó (a medias): se manda otra vez como
        // encuesta nueva (otro id), con las mismas respuestas, problemas y fotos. La anterior no se toca.
        const { draft: next, photoIds } = await rekeyDraft(ref.current!);
        update(() => next);
        if (photoIds.size) setMissingPhotos((m) => (m.size ? new Set([...m].map((pid) => photoIds.get(pid) ?? pid)) : m));
        d = next;
        ({ error, lostPhotos } = await sendDraft(d));
      }
      if (error) {
        setSendError(error);
        setAutoRetry(error === OFFLINE);
        // Sin internet ya se ven el banner de arriba y el aviso junto al botón: no se suma otro aviso
        if (error === OFFLINE) toast.dismiss("courier-form");
        else toast.error(error, { id: "courier-form", title: "No se pudo enviar" });
        if (Object.keys(lastFields).length) {
          setServerErrors(lastFields);
          const first = firstError(lastFields);
          if (first) requestAnimationFrame(() => focusField(first));
        }
        return;
      }
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* nada */
      }
      await clearPhotos();
      setAutoRetry(false);
      setSent({ id: d.id, token: d.token, name: d.name.trim(), issues: d.issues.length });
      toast.dismiss("courier-form");
      toast.success("Encuesta enviada. ¡Gracias!");
      if (lostPhotos)
        toast.warning(
          lostPhotos === 1
            ? "1 foto no se envió porque ya no estaba en el celular. Puedes mandarla con «Reportar otro problema»."
            : `${lostPhotos} fotos no se enviaron porque ya no estaban en el celular. Puedes mandarlas con «Reportar otro problema».`,
          { title: "Faltó una foto" }
        );
      window.scrollTo(0, 0);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-10 pt-5">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label="Inicio" className="shrink-0">
          <Image src="/logo.png" alt="AppHouse" width={56} height={40} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Encuesta para repartidores</h1>
          <p className="text-base text-slate-600">Son 2 minutos. Toca la carita que diga cómo te fue.</p>
        </div>
      </header>
      <TodayGuide defaultOpen={!restored} />
      {restored && (
        <p className="mt-3 rounded-xl bg-brand-50 px-4 py-2.5 text-sm text-brand-700">Guardamos lo que ya llevabas. Puedes seguir.</p>
      )}

      {/* 1. Datos */}
      <section id="c-name" className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label className="block">
          <span className="text-lg font-semibold">Tu nombre</span>
          <input
            id="c-name-input"
            value={draft.name}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
            onBlur={() => draft.name && setTouched((t) => ({ ...t, name: true }))}
            autoComplete="name"
            enterKeyHint="next"
            placeholder="Ej. Juan Pérez"
            maxLength={COURIER_RULES.name.max}
            required
            aria-invalid={!!shown("name")}
            aria-describedby={shown("name") ? "c-name-error" : undefined}
            className={`mt-2 w-full rounded-2xl border-0 bg-white px-4 py-4 text-lg ring-1 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
              shown("name") ? "ring-2 ring-rose-500" : "ring-slate-300"
            }`}
          />
          {shown("name") && (
            <span id="c-name-error" className="mt-1 block text-base font-medium text-rose-700">
              {shown("name")}
            </span>
          )}
        </label>
        <label className="mt-4 block">
          <span className="text-lg font-semibold">
            Tu teléfono <span className="text-base font-normal text-slate-500">(si quieres)</span>
          </span>
          <input
            id="c-phone-input"
            value={draft.phone}
            onChange={(e) => update((d) => ({ ...d, phone: e.target.value }))}
            onBlur={() => draft.phone && setTouched((t) => ({ ...t, phone: true }))}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Ej. 55 1234 5678"
            maxLength={20}
            aria-invalid={!!shown("phone")}
            aria-describedby={shown("phone") ? "c-phone-error" : undefined}
            className={`mt-2 w-full rounded-2xl border-0 bg-white px-4 py-4 text-lg ring-1 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
              shown("phone") ? "ring-2 ring-rose-500" : "ring-slate-300"
            }`}
          />
          {shown("phone") && (
            <span id="c-phone-error" className="mt-1 block text-base font-medium text-rose-700">
              {shown("phone")}
            </span>
          )}
        </label>
        {device.os && (
          <p className="mt-3 text-sm text-slate-500" data-testid="device">
            Tu celular: {[device.model, device.os, device.browser].filter(Boolean).join(" · ")}
          </p>
        )}
      </section>

      {/* 2. Preguntas */}
      <h2 className="mt-7 px-1 text-xl font-bold">¿Cómo te fue?</h2>
      <motion.div {...staggerList()} className="mt-3 space-y-4">
        {COURIER_QUESTIONS.map((q, i) => {
          const value = draft.answers[q.id];
          const bad = !!shown(`answers.${q.id}`);
          return (
            <motion.section
              key={q.id}
              {...staggerItem(reduce)}
              id={`q-${q.id}`}
              data-testid={`q-${q.id}`}
              className={`rounded-3xl bg-white p-4 shadow-sm ring-1 ${bad ? "ring-2 ring-rose-500" : "ring-slate-200"}`}
            >
              <h3 id={`q-${q.id}-label`} className="text-lg font-semibold leading-snug">
                <span className="text-slate-500">{i + 1}.</span> {q.label}
              </h3>
              <div
                role="radiogroup"
                aria-labelledby={`q-${q.id}-label`}
                aria-invalid={bad}
                aria-describedby={bad ? `q-${q.id}-error` : undefined}
                onKeyDown={(e) => radioKeys(e, (n) => choose(q.id, n === FACES.length ? COURIER_NA : FACES[n].value))}
              >
                <div className="mt-3 grid grid-cols-5 gap-1.5">
                  {FACES.map((f, fi) => {
                    const on = value === f.value;
                    const faceLabel = q.faces[fi] ?? f.label;
                    return (
                      <motion.button
                        key={f.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={faceLabel}
                        tabIndex={on || (value === undefined && fi === 0) ? 0 : -1}
                        onClick={() => choose(q.id, f.value)}
                        whileHover={reduce ? undefined : { y: -3 }}
                        whileTap={reduce ? { opacity: 0.8 } : { scale: 0.88 }}
                        animate={on && !reduce ? { scale: [1, 1.14, 1.05] } : { scale: 1 }}
                        transition={{ duration: 0.35, ease: "easeOut" }}
                        className={`relative flex min-h-[84px] flex-col items-center justify-center rounded-2xl px-0.5 py-2 transition-[background-color,box-shadow] duration-200 ${FOCUS} ${
                          on ? "bg-brand-50 shadow-sm ring-[3px] ring-brand-600" : "bg-white ring-1 ring-slate-300"
                        }`}
                      >
                        <motion.span
                          className="relative inline-block text-[2.6rem] leading-none"
                          aria-hidden
                          animate={on ? (reduce ? { opacity: [0.4, 1] } : { y: [0, -14, 0, -5, 0], rotate: [0, -14, 12, -6, 0], scale: [1, 1.3, 1, 1.08, 1] }) : undefined}
                          transition={{ duration: 0.65, ease: "easeOut" }}
                        >
                          {f.emoji}
                          {on && <Sparkles count={8} radius={34} size={11} />}
                        </motion.span>
                        <span className={`mt-1.5 text-xs leading-tight ${on ? "font-bold text-brand-700" : "font-medium text-slate-700"}`}>
                          {faceLabel}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
                {q.na && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={value === COURIER_NA}
                    tabIndex={value === COURIER_NA ? 0 : -1}
                    onClick={() => choose(q.id, COURIER_NA)}
                    data-testid={`q-${q.id}-na`}
                    className={`mt-2.5 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors ${FOCUS} ${
                      value === COURIER_NA ? "bg-slate-700 text-white ring-2 ring-slate-700" : "bg-white text-slate-700 ring-1 ring-slate-300"
                    }`}
                  >
                    {value === COURIER_NA ? "✓ " : ""}
                    {COURIER_NA_LABEL}
                  </button>
                )}
              </div>
              {bad && (
                <p id={`q-${q.id}-error`} className="mt-2 text-base font-medium text-rose-700">
                  Toca una carita.
                </p>
              )}
            </motion.section>
          );
        })}
      </motion.div>

      {/* 3. Comentario */}
      <section className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label className="block">
          <span className="text-lg font-semibold">
            ¿Quieres decirnos algo más? <span className="text-base font-normal text-slate-500">(si quieres)</span>
          </span>
          <textarea
            id="c-comment-input"
            value={draft.comment}
            onChange={(e) => update((d) => ({ ...d, comment: e.target.value }))}
            rows={3}
            placeholder="Escribe aquí…"
            maxLength={COURIER_RULES.comment.max}
            aria-invalid={!!shown("comment")}
            aria-describedby={shown("comment") ? "c-comment-error" : undefined}
            className={`mt-2 w-full rounded-2xl border-0 bg-white px-4 py-3 text-lg ring-1 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
              shown("comment") ? "ring-2 ring-rose-500" : "ring-slate-300"
            }`}
          />
          <Counter value={draft.comment} max={COURIER_RULES.comment.max} />
          {shown("comment") && (
            <span id="c-comment-error" className="mt-1 block text-base font-medium text-rose-700">
              {shown("comment")}
            </span>
          )}
        </label>
        <p className="mt-1 text-sm text-slate-500">🎤 Si no quieres escribir, puedes usar el micrófono del teclado para dictar.</p>
      </section>

      {/* 4. Problemas */}
      <section id="c-issues" className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200" data-testid="issues">
        <h2 className="text-xl font-bold">¿Algo falló?</h2>
        <p className="mt-1 text-base text-slate-600">Si algo no funcionó, cuéntanos. Si no, sáltate esta parte.</p>

        {draft.issues.length > 0 && (
          <ul className="mt-4 space-y-3">
            {draft.issues.map((it, i) => (
              <li key={it.id} className="flex gap-3 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200" data-testid="saved-issue">
                {it.photo && <PhotoThumb id={it.photo.id} missing={missingPhotos.has(it.photo.id)} />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-amber-900">Problema {i + 1}</div>
                  <p className="whitespace-pre-wrap break-words text-base text-slate-800">{it.description}</p>
                  {it.photo && missingPhotos.has(it.photo.id) && (
                    <p className="mt-1 text-sm font-medium text-rose-800" data-testid="photo-missing">
                      ⚠️ La foto ya no está en este celular. El problema se enviará sin foto; si quieres mandarla, borra este problema y agrégalo
                      otra vez con la foto.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const yes = await confirm({
                        title: "¿Borrar este problema?",
                        message: it.photo ? "También se borra su foto. No se puede deshacer." : "No se puede deshacer.",
                        confirmLabel: "Sí, borrar",
                        cancelLabel: "Cancelar",
                        tone: "danger",
                      });
                      if (!yes) return;
                      if (it.photo) void deletePhoto(it.photo.id);
                      update((d) => ({ ...d, issues: d.issues.filter((x) => x.id !== it.id) }));
                      toast.success("Problema borrado");
                    }}
                    className={`mt-2 min-h-11 rounded-xl px-3 py-2 text-base font-semibold text-rose-700 ring-1 ring-rose-200 active:bg-rose-50 ${FOCUS}`}
                  >
                    🗑️ Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editing ? (
          <IssueEditor
            maxUploadMb={maxUploadMb}
            os={String(device.os ?? "")}
            onDirty={setEditorDirty}
            onCancel={() => {
              setEditing(false);
              setEditorDirty(false);
            }}
            onSave={async (it) => {
              let photo: DraftPhoto | undefined;
              if (it.photo) {
                photo = { id: uid(), name: it.photo.name || "captura.jpg", size: it.photo.size };
                await putPhoto(photo.id, it.photo);
              }
              update((d) => ({ ...d, issues: [...d.issues, { id: it.id, description: it.description, photo }] }));
              setEditing(false);
              setEditorDirty(false);
              toast.success("Problema guardado");
              return null;
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`mt-4 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-amber-100 px-4 text-lg font-bold text-amber-900 ring-1 ring-amber-300 active:scale-[0.98] ${FOCUS}`}
          >
            ➕ {draft.issues.length ? "Agregar otro problema" : "Agregar problema"}
          </button>
        )}
      </section>

      {/* Enviar */}
      <div className="mt-6">
        {showErrors && problems.length > 0 && (
          <div role="alert" className="mb-3 rounded-2xl bg-rose-50 p-4 text-base text-rose-800 ring-1 ring-rose-200">
            {problems.map((p) => (
              <p key={p}>• {p}</p>
            ))}
          </div>
        )}
        {sendError && (
          <div role="alert" className="mb-3 rounded-2xl bg-rose-50 p-4 text-base text-rose-800 ring-1 ring-rose-200" data-testid="send-error">
            {sendError === OFFLINE ? (
              <>
                <p className="font-bold">📵 No hay internet.</p>
                <p className="mt-1">
                  Tus respuestas siguen guardadas en este celular. Se mandan solas cuando vuelva la señal: deja esta página abierta. También
                  puedes tocar «Intentar de nuevo».
                </p>
              </>
            ) : (
              <p>{sendError}</p>
            )}
          </div>
        )}
        {autoRetry && !sending && <RetryWhenOnline onRetry={() => void send(true)} />}
        <motion.button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          whileHover={reduce || sending ? undefined : { y: -2 }}
          whileTap={reduce || sending ? { opacity: 0.85 } : { scale: 0.96 }}
          className={`flex min-h-[68px] w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 text-xl font-bold text-white shadow-md disabled:opacity-60 ${FOCUS} ${
            !sending && COURIER_QUESTIONS.every((q) => draft.answers[q.id]) ? "attn attn-success" : ""
          }`}
        >
          {sending ? "Enviando…" : sendError ? "Intentar de nuevo" : "Enviar"}
        </motion.button>
      </div>
    </main>
  );
}

const TODAY_STEPS = [
  "Antes de empezar te llega un correo con tu usuario y una contraseña temporal. Búscalo también en Correo no deseado.",
  "Abre la app de repartidor, entra con ese correo y crea tu contraseña nueva.",
  "Toca Disponible. Déjalo así hasta que Mesa de control dé por terminada la prueba.",
  "Cuando te llegue un pedido, acéptalo, recógelo y marca cada etapa hasta Entregado.",
  "Si un cliente te escribe por el chat, contéstale.",
  "Al terminar, contesta esta encuesta. Si algo falló, cuéntalo en «¿Algo falló?».",
];

/**
 * Guía corta «Qué haces hoy», arriba de la encuesta: pasos numerados, letra grande. Se puede plegar;
 * empieza abierta solo si el borrador está vacío (quien ya empezó la encuesta no la necesita).
 */
function TodayGuide({ defaultOpen }: { defaultOpen: boolean }) {
  return (
    <details
      open={defaultOpen}
      className="group mt-5 rounded-3xl bg-white shadow-sm ring-1 ring-slate-200"
      data-testid="today-guide"
    >
      <summary
        className={`flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-3xl px-5 py-3 [&::-webkit-details-marker]:hidden ${FOCUS}`}
      >
        <span>
          <span className="block text-2xl font-bold">Qué haces hoy</span>
          <span className="block text-sm text-slate-600 group-open:hidden">Toca para ver los {TODAY_STEPS.length} pasos de la prueba</span>
        </span>
        <span aria-hidden className="text-2xl text-slate-500 transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <ol className="space-y-4 px-5 pb-5 pt-1">
        {TODAY_STEPS.map((t, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xl font-bold text-white"
            >
              {i + 1}
            </span>
            <span className="pt-1 text-lg leading-snug text-slate-800">
              <span className="sr-only">Paso {i + 1}: </span>
              {t}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Miniatura de una foto guardada en el celular (IndexedDB). */
function PhotoThumb({ id, missing }: { id: string; missing?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  /** El navegador no puede mostrar la foto (p. ej. HEIC fuera de Safari): igual se envía. */
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    void getPhoto(id).then((b) => {
      if (!alive || !b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return (
    <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-amber-200">
      {missing ? (
        <span className="flex h-full items-center justify-center text-2xl" role="img" aria-label="Foto no disponible">
          ⚠️
        </span>
      ) : url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Foto de la pantalla" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span className="flex h-full items-center justify-center text-2xl" role="img" aria-label="Con foto">
          📷
        </span>
      )}
    </div>
  );
}

/** Formulario de un problema: qué pasó + foto de la pantalla (opcional). */
function IssueEditor({
  maxUploadMb,
  os,
  onSave,
  onCancel,
  onDirty,
  saveLabel = "Guardar problema",
}: {
  maxUploadMb: number;
  /** Sistema del celular (detectDevice), para explicar cómo tomar la captura. */
  os?: string;
  onSave: (it: NewIssue) => Promise<string | null>;
  onCancel: () => void;
  onDirty?: (dirty: boolean) => void;
  saveLabel?: string;
}) {
  const [id] = useState(uid);
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** El error es del texto (marca el campo como inválido). */
  const [descError, setDescError] = useState(false);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  /** Vista previa que el navegador no sabe mostrar (HEIC fuera de Safari). */
  const [brokenPreview, setBrokenPreview] = useState<string | null>(null);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (picked: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!picked) return;
    setError(null);
    setDescError(false);
    // Algunos celulares no dicen el tipo de la foto: se deduce por la extensión
    const type = picked.type || guessPhotoMime(picked.name);
    const f = type === picked.type ? picked : new File([picked], picked.name, { type, lastModified: picked.lastModified });
    if (!ALLOWED_PHOTO_TYPES.includes(type)) {
      setError("Ese archivo no es una foto. Elige una foto de la pantalla.");
      toast.error("Ese archivo no es una foto. Elige una foto de la pantalla.", { id: "courier-issue" });
      return;
    }
    setBusy(true);
    const c = await compressImage(f);
    setBusy(false);
    if (c.size > maxUploadMb * 1024 * 1024) {
      setError(`La foto es muy pesada (más de ${maxUploadMb} MB). Elige otra.`);
      toast.error(`La foto es muy pesada (más de ${maxUploadMb} MB). Elige otra.`, { id: "courier-issue" });
      return;
    }
    setPhoto(c);
    onDirty?.(true);
  };

  const textRef = useRef<HTMLTextAreaElement>(null);
  const save = async () => {
    const invalidText = courierIssueError(description);
    if (invalidText) {
      setError(invalidText);
      toast.error(invalidText, { id: "courier-issue" });
      setDescError(true);
      textRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const e = await onSave({ id, description: description.trim(), photo });
    setBusy(false);
    if (e) {
      setError(e === OFFLINE ? "📵 No hay internet. Conéctate y toca «" + saveLabel + "» otra vez." : e);
      toast.error(e === OFFLINE ? "No hay internet. Conéctate e inténtalo otra vez." : e, { id: "courier-issue", title: "No se pudo guardar" });
      if (lastFields.description) {
        setDescError(true);
        textRef.current?.focus();
      }
    }
  };

  return (
    <div className="animate-pop mt-4 rounded-2xl bg-slate-50 p-4 ring-2 ring-amber-300" data-testid="issue-editor">
      <label className="block">
        <span className="text-lg font-semibold">¿Qué pasó?</span>
        <textarea
          ref={textRef}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (descError && !courierIssueError(e.target.value)) {
              setDescError(false);
              setError(null);
            }
            onDirty?.(Boolean(e.target.value.trim()) || Boolean(photo));
          }}
          rows={3}
          autoFocus
          required
          maxLength={COURIER_RULES.issue.max}
          placeholder="Ej. No me llegó el aviso del pedido"
          aria-invalid={descError}
          aria-describedby={descError && error ? `${id}-error` : undefined}
          className={`mt-2 w-full rounded-2xl border-0 bg-white px-4 py-3 text-lg ring-1 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            descError ? "ring-2 ring-rose-500" : "ring-slate-300"
          }`}
        />
        <Counter value={description} max={COURIER_RULES.issue.max} />
      </label>
      <p className="text-sm text-slate-500">🎤 Puedes usar el micrófono del teclado para dictar.</p>

      <div className="mt-4">
        {photo && preview ? (
          <div className="flex items-center gap-3">
            {brokenPreview === preview ? (
              <span
                role="img"
                aria-label="Foto adjunta (este celular no puede mostrarla, pero sí se envía)"
                className="flex h-28 w-20 flex-col items-center justify-center rounded-xl bg-slate-100 text-center text-xs text-slate-600 ring-1 ring-slate-300"
              >
                <span aria-hidden className="text-3xl">
                  📷
                </span>
                Foto adjunta
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Foto de la pantalla"
                className="h-28 w-20 rounded-xl object-cover ring-1 ring-slate-300"
                onError={() => setBrokenPreview(preview)}
              />
            )}
            <div className="flex flex-col gap-2">
              <span className="text-base font-medium text-emerald-700">✅ Foto lista</span>
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  onDirty?.(Boolean(description.trim()));
                }}
                className={`min-h-11 rounded-xl px-3 py-2 text-base font-semibold text-rose-700 ring-1 ring-rose-200 active:bg-rose-50 ${FOCUS}`}
              >
                Quitar foto
              </button>
            </div>
          </div>
        ) : (
          <label className="flex min-h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white px-4 text-lg font-bold text-brand-700 ring-2 ring-brand-500 active:scale-[0.98] has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
            📷 Foto de la pantalla
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              data-testid="photo-input"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
        )}
        <CaptureHint os={os} />
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-base font-medium text-rose-800 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={`min-h-14 flex-1 rounded-2xl bg-white px-3 text-lg font-semibold text-slate-700 ring-1 ring-slate-300 active:scale-[0.98] ${FOCUS}`}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={`min-h-14 flex-[2] rounded-2xl bg-brand-500 px-3 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-60 ${FOCUS}`}
        >
          {busy ? "Un momento…" : saveLabel}
        </button>
      </div>
    </div>
  );
}

/** Pantalla final: gracias + reportar otro problema (se manda directo al servidor). */
function ThankYou({
  sent,
  maxUploadMb,
  os,
  onIssueSent,
  onAgain,
}: {
  sent: Sent;
  maxUploadMb: number;
  os?: string;
  onIssueSent: () => void;
  /** Empieza otra encuesta; `carry`: problema que se lleva a la encuesta nueva. */
  onAgain: (carry?: NewIssue) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [lastOk, setLastOk] = useState(false);
  /** Se abrió una ronda nueva: esta encuesta ya no acepta problemas. Guarda el que se intentó mandar. */
  const [roundClosed, setRoundClosed] = useState<NewIssue | null>(null);
  const reduce = useReducedMotion();
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-10 pt-10">
      <Confetti count={44} />
      <div className="animate-pop rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200" data-testid="thanks">
        <motion.div
          className="relative inline-block text-7xl"
          aria-hidden
          initial={reduce ? { opacity: 0 } : { scale: 0.2, rotate: -30, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { scale: [0.2, 1.3, 1], rotate: [-30, 12, 0], opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <motion.span
            className="inline-block"
            animate={reduce ? { opacity: [1, 0.7, 1] } : { y: [0, -10, 0], rotate: [0, -6, 6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1, delay: 0.7 }}
          >
            🎉
          </motion.span>
          <Sparkles count={12} radius={76} size={15} delay={0.2} />
        </motion.div>
        <h1 className="mt-3 text-3xl font-bold">¡Gracias, {sent.name.split(/\s+/)[0]}!</h1>
        <p className="mt-2 text-lg text-slate-700">Tus respuestas se enviaron. Nos ayudan a mejorar la app.</p>
        {sent.issues > 0 && (
          <p className="mt-2 text-base text-slate-600">
            Problemas enviados: <b>{sent.issues}</b>
          </p>
        )}
        {lastOk && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-base font-medium text-emerald-800">✅ Problema enviado. ¡Gracias!</p>}
      </div>

      {editing ? (
        <div className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-bold">Reportar otro problema</h2>
          <IssueEditor
            maxUploadMb={maxUploadMb}
            saveLabel="Enviar problema"
            os={os}
            onCancel={() => setEditing(false)}
            onSave={async (it) => {
              let error = await api(`/api/repartidor/${sent.id}/issues`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-courier-token": sent.token },
                body: JSON.stringify({ id: it.id, description: it.description }),
              });
              // El id de la foto se deriva del problema: si se reintenta no se duplica
              if (!error && it.photo) error = await uploadPhoto(sent.id, sent.token, it.id, `${it.id}-f`, it.photo, it.photo.name);
              if (error && lastCode === ROUND_CLOSED) {
                // Se abrió una encuesta nueva: el problema va en la nueva, no en esta
                setEditing(false);
                setRoundClosed(it);
                return null;
              }
              if (error) return error;
              setEditing(false);
              setLastOk(true);
              onIssueSent();
              toast.success("Problema enviado");
              return null;
            }}
          />
        </div>
      ) : roundClosed ? (
        <div role="alert" className="mt-5 rounded-3xl bg-amber-50 p-5 ring-1 ring-amber-300" data-testid="round-closed">
          <p className="text-lg font-bold text-amber-900">Se abrió una nueva encuesta.</p>
          <p className="mt-1 text-base text-slate-800">
            Contesta la encuesta de nuevo para reportar este problema. Ya lo dejamos anotado en la encuesta nueva.
          </p>
          <button
            type="button"
            onClick={() => onAgain(roundClosed)}
            className={`mt-4 flex min-h-16 w-full items-center justify-center rounded-2xl bg-brand-500 px-4 text-lg font-bold text-white active:scale-[0.98] ${FOCUS}`}
          >
            Contestar la encuesta nueva
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setLastOk(false);
            setEditing(true);
          }}
          className={`mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-amber-100 px-4 text-lg font-bold text-amber-900 ring-1 ring-amber-300 active:scale-[0.98] ${FOCUS}`}
        >
          ⚠️ Reportar otro problema
        </button>
      )}

      <div className="mt-4 grid gap-3">
        <button
          type="button"
          onClick={() => onAgain()}
          className={`min-h-14 rounded-2xl bg-white px-4 text-lg font-semibold text-slate-700 ring-1 ring-slate-300 active:scale-[0.98] ${FOCUS}`}
        >
          Llenar otra encuesta
        </button>
        <Link href="/" className="py-2 text-center text-base font-medium text-brand-600">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
