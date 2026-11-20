"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALLOWED_PHOTO_TYPES, COURIER_QUESTIONS, FACES } from "@/lib/courier";
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
  answers: Record<string, number>;
  comment: string;
  issues: DraftIssue[];
};
type Sent = { id: string; token: string; name: string; issues: number };
type NewIssue = { id: string; description: string; photo: File | null };

const KEY = "apphouse-repartidor:draft";
const OFFLINE = "No hay internet.";

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

/**
 * Llama al servidor. Devuelve null si salió bien, o el mensaje de error (OFFLINE si no hay red).
 * Si el servidor rechaza datos, sus errores por campo quedan en `lastFields`.
 */
async function api(url: string, init: RequestInit): Promise<string | null> {
  lastFields = {};
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE;
  try {
    const res = await fetch(url, init);
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldErrors };
    if (data.fields && typeof data.fields === "object") lastFields = data.fields;
    return data.error || "No se pudo enviar. Inténtalo de nuevo.";
  } catch {
    return OFFLINE;
  }
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
    const a = courierAnswerError(d.answers[q.id]);
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

/** Contador de caracteres que aparece cerca del límite. */
function Counter({ value, max }: { value: string; max: number }) {
  const n = value.trim().length;
  if (n < max * 0.8) return null;
  return (
    <span className={`mt-1 block text-right text-sm ${n > max ? "font-semibold text-rose-700" : "text-slate-500"}`}>
      {n} de {max}
    </span>
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
  const ref = useRef<Draft | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    const d = loadDraft();
    ref.current = d ?? newDraft();
    // localStorage solo existe en el cliente
    setDraft(ref.current);
    setRestored(Boolean(d && (d.name || Object.keys(d.answers).length || d.issues.length || d.comment)));
    detectDevice().then(setDevice, () => {});
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
        onIssueSent={() => setSent({ ...sent, issues: sent.issues + 1 })}
        onAgain={() => {
          ref.current = newDraft();
          setDraft(ref.current);
          setSent(null);
          setShowErrors(false);
          window.scrollTo(0, 0);
        }}
      />
    );
  }

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

  const send = async () => {
    setShowErrors(true);
    setSendError(null);
    if (problems.length) {
      toast.error(problems.length === 1 ? problems[0] : "Revisa lo que está marcado en rojo.", { id: "courier-form", title: "Falta algo" });
      const first = firstError(errs) ?? "c-issues";
      // Espera a que se pinten los mensajes antes de mover el foco
      requestAnimationFrame(() => focusField(first));
      return;
    }
    const d = ref.current!;
    setSending(true);
    try {
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
      for (const it of d.issues) {
        if (error) break;
        if (!it.photo) continue;
        const blob = await getPhoto(it.photo.id);
        if (!blob) continue; // la foto ya no está en el celular (p. ej. modo privado y se recargó)
        error = await uploadPhoto(d.id, d.token, it.id, it.photo.id, blob, it.photo.name);
      }
      if (error) {
        setSendError(error);
        toast.error(error === OFFLINE ? "No hay internet. Tus respuestas siguen guardadas; conéctate e inténtalo de nuevo." : error, {
          id: "courier-form",
          title: error === OFFLINE ? "Sin conexión" : "No se pudo enviar",
        });
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
      setSent({ id: d.id, token: d.token, name: d.name.trim(), issues: d.issues.length });
      toast.dismiss("courier-form");
      toast.success("Encuesta enviada. ¡Gracias!");
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
      <TodayGuide />
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
      <div className="mt-3 space-y-4">
        {COURIER_QUESTIONS.map((q, i) => {
          const value = draft.answers[q.id];
          const bad = !!shown(`answers.${q.id}`);
          return (
            <section
              key={q.id}
              id={`q-${q.id}`}
              data-testid={`q-${q.id}`}
              className={`rounded-3xl bg-white p-4 shadow-sm ring-1 ${bad ? "ring-2 ring-rose-500" : "ring-slate-200"}`}
            >
              <h3 className="text-lg font-semibold leading-snug">
                <span className="text-slate-400">{i + 1}.</span> {q.label}
              </h3>
              <div
                role="radiogroup"
                aria-label={q.label}
                aria-invalid={bad}
                aria-describedby={bad ? `q-${q.id}-error` : undefined}
                className="mt-3 grid grid-cols-5 gap-1.5"
              >
                {FACES.map((f, fi) => {
                  const on = value === f.value;
                  const faceLabel = q.faces[fi] ?? f.label;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={faceLabel}
                      onClick={() => update((d) => ({ ...d, answers: { ...d.answers, [q.id]: f.value } }))}
                      className={`flex min-h-[84px] flex-col items-center justify-center rounded-2xl px-0.5 py-2 transition active:scale-95 ${
                        on ? "scale-[1.04] bg-brand-50 ring-[3px] ring-brand-500" : "bg-slate-50 ring-1 ring-slate-200"
                      } ${value && !on ? "opacity-45" : ""}`}
                    >
                      <span className="text-[2.6rem] leading-none" aria-hidden>
                        {f.emoji}
                      </span>
                      <span className={`mt-1.5 text-xs leading-tight ${on ? "font-bold text-brand-700" : "font-medium text-slate-600"}`}>
                        {faceLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
              {bad && (
                <p id={`q-${q.id}-error`} className="mt-2 text-base font-medium text-rose-700">
                  Toca una carita.
                </p>
              )}
            </section>
          );
        })}
      </div>

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
                {it.photo && <PhotoThumb id={it.photo.id} />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-amber-900">Problema {i + 1}</div>
                  <p className="whitespace-pre-wrap break-words text-base text-slate-800">{it.description}</p>
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
                    className="mt-2 rounded-xl px-3 py-2 text-base font-semibold text-rose-700 ring-1 ring-rose-200 active:bg-rose-50"
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
            className="mt-4 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-amber-100 px-4 text-lg font-bold text-amber-900 ring-1 ring-amber-300 active:scale-[0.98]"
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
                <p className="mt-1">Tus respuestas siguen guardadas en este celular. Conéctate y toca «Intentar de nuevo».</p>
              </>
            ) : (
              <p>{sendError}</p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="flex min-h-[68px] w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 text-xl font-bold text-white shadow-md active:scale-[0.98] disabled:opacity-60"
        >
          {sending ? "Enviando…" : sendError ? "Intentar de nuevo" : "Enviar"}
        </button>
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

/** Guía corta «Qué haces hoy», arriba de la encuesta: pasos numerados, letra grande. */
function TodayGuide() {
  return (
    <section aria-labelledby="c-today" className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200" data-testid="today-guide">
      <h2 id="c-today" className="text-2xl font-bold">
        Qué haces hoy
      </h2>
      <ol className="mt-4 space-y-4">
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
    </section>
  );
}

/** Miniatura de una foto guardada en el celular (IndexedDB). */
function PhotoThumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
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
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Foto de la pantalla" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center text-2xl" aria-label="Con foto">
          📷
        </span>
      )}
    </div>
  );
}

/** Formulario de un problema: qué pasó + foto de la pantalla (opcional). */
function IssueEditor({
  maxUploadMb,
  onSave,
  onCancel,
  onDirty,
  saveLabel = "Guardar problema",
}: {
  maxUploadMb: number;
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
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    setError(null);
    setDescError(false);
    if (!ALLOWED_PHOTO_TYPES.includes(f.type)) {
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Foto de la pantalla" className="h-28 w-20 rounded-xl object-cover ring-1 ring-slate-300" />
            <div className="flex flex-col gap-2">
              <span className="text-base font-medium text-emerald-700">✅ Foto lista</span>
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  onDirty?.(Boolean(description.trim()));
                }}
                className="rounded-xl px-3 py-2 text-base font-semibold text-rose-700 ring-1 ring-rose-200 active:bg-rose-50"
              >
                Quitar foto
              </button>
            </div>
          </div>
        ) : (
          <label className="flex min-h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white px-4 text-lg font-bold text-brand-700 ring-2 ring-brand-500 active:scale-[0.98]">
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
        <p className="mt-2 text-sm text-slate-500">
          Para tomar una foto de la pantalla, aprieta al mismo tiempo el botón de <b>bajar volumen</b> y el de <b>encendido</b>. La foto
          es opcional.
        </p>
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
          className="min-h-14 flex-1 rounded-2xl bg-white px-3 text-lg font-semibold text-slate-700 ring-1 ring-slate-300 active:scale-[0.98]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="min-h-14 flex-[2] rounded-2xl bg-brand-500 px-3 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-60"
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
  onIssueSent,
  onAgain,
}: {
  sent: Sent;
  maxUploadMb: number;
  onIssueSent: () => void;
  onAgain: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [lastOk, setLastOk] = useState(false);
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-10 pt-10">
      <div className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200" data-testid="thanks">
        <div className="text-7xl" aria-hidden>
          🎉
        </div>
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
            onCancel={() => setEditing(false)}
            onSave={async (it) => {
              let error = await api(`/api/repartidor/${sent.id}/issues`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-courier-token": sent.token },
                body: JSON.stringify({ id: it.id, description: it.description }),
              });
              // El id de la foto se deriva del problema: si se reintenta no se duplica
              if (!error && it.photo) error = await uploadPhoto(sent.id, sent.token, it.id, `${it.id}-f`, it.photo, it.photo.name);
              if (error) return error;
              setEditing(false);
              setLastOk(true);
              onIssueSent();
              toast.success("Problema enviado");
              return null;
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setLastOk(false);
            setEditing(true);
          }}
          className="mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-amber-100 px-4 text-lg font-bold text-amber-900 ring-1 ring-amber-300 active:scale-[0.98]"
        >
          ⚠️ Reportar otro problema
        </button>
      )}

      <div className="mt-4 grid gap-3">
        <button
          type="button"
          onClick={onAgain}
          className="min-h-14 rounded-2xl bg-white px-4 text-lg font-semibold text-slate-700 ring-1 ring-slate-300 active:scale-[0.98]"
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
