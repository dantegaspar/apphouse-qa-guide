"use client";

import { useEffect, useRef, useState } from "react";
import { Button, FieldError, FormField, Sheet } from "./ui";
import { compressImage } from "./store";
import { focusFirstError, LIMITS, validateFile } from "./validation";

export type ReportDraft = {
  kind: "issue" | "evidence";
  description: string;
  expected: string;
  blocking: boolean;
  orderNumber: string;
};

/** «Ej. 261120-0004» con la fecha de hoy (formato de folio AAMMDD-NNNN). */
function todayOrderExample() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Ej. ${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}-0004`;
}

const ACCEPT = "image/*,video/mp4,video/quicktime,video/webm";

export default function ReportSheet({
  open,
  onClose,
  kind,
  context,
  maxUploadMb,
  allowedMime = [],
  reportExample,
  orderExample,
  onSubmit,
}: {
  /** Ejemplos de la guía para «¿Qué pasó?» y el número de pedido. */
  reportExample?: string;
  orderExample?: string;
  /** Tipos de archivo que acepta el servidor. */
  allowedMime?: string[];
  open: boolean;
  onClose: () => void;
  kind: "issue" | "evidence";
  context: string;
  maxUploadMb: number;
  /** Devuelve un mensaje de error o null si todo se guardó. */
  onSubmit: (draft: ReportDraft, files: File[]) => Promise<string | null>;
}) {
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [blocking, setBlocking] = useState<boolean | null>(null);
  const [orderNumber, setOrderNumber] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect -- reinicia el formulario al abrir */
      setDescription("");
      setExpected("");
      setBlocking(null);
      setOrderNumber("");
      setFiles([]);
      setFileErrors([]);
      setError(null);
      setTried(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open]);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const out: File[] = [];
    const errs: string[] = [];
    const room = 5 - files.length;
    const picked = Array.from(list);
    if (picked.length > room) errs.push(`Solo caben 5 archivos por reporte: no se agregaron ${picked.length - room}.`);
    for (const f of picked.slice(0, Math.max(0, room))) {
      // Tipo antes de comprimir; tamaño después (las fotos grandes se reducen)
      const typeErr = validateFile(f, allowedMime, Number.POSITIVE_INFINITY);
      if (typeErr) {
        errs.push(typeErr);
        continue;
      }
      const c = await compressImage(f);
      const sizeErr = validateFile(c, allowedMime, maxUploadMb);
      if (sizeErr) {
        errs.push(sizeErr);
        continue;
      }
      out.push(c);
    }
    setFileErrors(errs);
    setFiles((prev) => [...prev, ...out].slice(0, 5));
    if (inputRef.current) inputRef.current.value = "";
  };

  const isIssue = kind === "issue";
  const errors: Record<string, string> = {};
  if (isIssue) {
    const d = description.trim();
    if (!d) errors.description = "Cuéntanos qué pasó.";
    else if (d.length < 5) errors.description = "Escribe un poco más (al menos 5 letras) para que el equipo entienda la falla.";
    else if (d.length > LIMITS.description) errors.description = `Máximo ${LIMITS.description} caracteres (llevas ${d.length}).`;
    if (expected.trim().length > LIMITS.expected) errors.expected = `Máximo ${LIMITS.expected} caracteres.`;
    if (blocking === null) errors.blocking = "Elige Sí o No.";
    if (orderNumber.trim().length > LIMITS.orderNumber) errors.orderNumber = `Máximo ${LIMITS.orderNumber} caracteres.`;
  } else {
    if (files.length === 0) errors.files = "Agrega al menos una captura o video.";
    if (description.trim().length > LIMITS.description) errors.description = `Máximo ${LIMITS.description} caracteres.`;
  }
  const valid = Object.keys(errors).length === 0;
  const shown = tried ? errors : {};

  const submit = async () => {
    if (!valid) {
      setTried(true);
      focusFirstError(formRef.current);
      return;
    }
    setBusy(true);
    setError(null);
    const msg = await onSubmit(
      { kind, description: description.trim(), expected: expected.trim(), blocking: !!blocking, orderNumber: orderNumber.trim() },
      files
    );
    setBusy(false);
    if (msg) setError(msg);
    else onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={isIssue ? "Reportar una falla" : "Adjuntar captura"}
      footer={
        <div className="pb-3">
          {error && (
            <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
              {error}
            </p>
          )}
          {tried && !valid && (
            <p className="mb-2 text-center text-sm font-medium text-rose-700" role="alert">
              Revisa lo marcado en rojo.
            </p>
          )}
          <Button size="lg" className="w-full" onClick={submit} disabled={busy} pulse={valid && !busy}>
            {busy ? "Enviando…" : isIssue ? "Enviar reporte" : "Guardar captura"}
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-slate-600">{context}</p>
      <div className="space-y-4" ref={formRef}>
        {isIssue && (
          <>
            <FormField
              id="r-desc"
              label="¿Qué pasó? *"
              error={shown.description}
              hint={description.length > LIMITS.description * 0.8 ? `${description.trim().length} de ${LIMITS.description} caracteres` : undefined}
            >
              {(p) => (
                <textarea
                  {...p}
                  className={p.className + " min-h-24"}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={reportExample || "Ej. Toqué Guardar tarjeta y la pantalla se quedó en blanco."}
                />
              )}
            </FormField>
            <FormField id="r-exp" label="¿Qué esperabas que pasara?" error={shown.expected}>
              {(p) => (
                <textarea
                  {...p}
                  className={p.className + " min-h-20"}
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="Ej. Que saliera el aviso de tarjeta rechazada."
                />
              )}
            </FormField>
            <div data-error={shown.blocking ? "true" : undefined}>
              <span className="mb-1 block text-sm font-medium text-slate-800" id="r-block-label">
                ¿Te impide seguir? *
              </span>
              <div className={`grid grid-cols-2 gap-2 ${shown.blocking ? "animate-shake" : ""}`} role="group" aria-labelledby="r-block-label">
                {[
                  [true, "Sí"],
                  [false, "No"],
                ].map(([v, l]) => (
                  <button
                    key={String(v)}
                    type="button"
                    aria-pressed={blocking === v}
                    onClick={() => setBlocking(v as boolean)}
                    className={`min-h-12 rounded-xl py-3 font-medium ring-1 ${
                      blocking === v ? "bg-brand-500 text-white ring-brand-500" : shown.blocking ? "bg-white ring-2 ring-rose-400" : "bg-white ring-slate-300"
                    }`}
                  >
                    {l as string}
                  </button>
                ))}
              </div>
              {shown.blocking && <FieldError>{shown.blocking}</FieldError>}
              {blocking && (
                <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  La actividad quedará en pausa y tendrás que pedir ayuda al guía de la prueba para continuar.
                </p>
              )}
            </div>
            <FormField id="r-order" label="Número de pedido (si aplica)" error={shown.orderNumber}>
              {(p) => <input {...p} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder={orderExample || todayOrderExample()} />}
            </FormField>
          </>
        )}
        {!isIssue && (
          <FormField id="r-note" label="Nota (opcional)" error={shown.description}>
            {(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </FormField>
        )}
        <div data-error={shown.files ? "true" : undefined}>
          <span className="mb-1 block text-sm font-medium text-slate-800">
            Captura de pantalla o video {isIssue ? "(recomendado)" : "*"}
          </span>
          <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <div className="grid grid-cols-3 gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
                {f.type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-2 text-center text-xs text-slate-600">🎬 {f.name}</div>
                )}
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              </div>
            ))}
            {files.length < 5 && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-600 hover:border-brand-500 hover:text-brand-600"
              >
                <span className="text-2xl">📷</span>
                Agregar
              </button>
            )}
          </div>
          {shown.files && <FieldError>{shown.files}</FieldError>}
          {fileErrors.map((m, i) => (
            <FieldError key={i}>{m}</FieldError>
          ))}
          <p className="mt-1 text-xs text-slate-600">Hasta 5 archivos (fotos o videos), máximo {maxUploadMb} MB cada uno.</p>
        </div>
      </div>
    </Sheet>
  );
}
