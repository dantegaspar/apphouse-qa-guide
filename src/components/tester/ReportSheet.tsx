"use client";

import { useEffect, useRef, useState } from "react";
import { Button, inputCls, Sheet } from "./ui";
import { compressImage } from "./store";

export type ReportDraft = {
  kind: "issue" | "evidence";
  description: string;
  expected: string;
  blocking: boolean;
  orderNumber: string;
};

const ACCEPT = "image/*,video/mp4,video/quicktime,video/webm";

export default function ReportSheet({
  open,
  onClose,
  kind,
  context,
  maxUploadMb,
  onSubmit,
}: {
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
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect -- reinicia el formulario al abrir */
      setDescription("");
      setExpected("");
      setBlocking(null);
      setOrderNumber("");
      setFiles([]);
      setError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open]);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const out: File[] = [];
    for (const f of Array.from(list)) {
      const c = await compressImage(f);
      if (c.size > maxUploadMb * 1024 * 1024) {
        setError(`«${f.name}» pesa más de ${maxUploadMb} MB. Graba un video más corto o manda una captura.`);
        continue;
      }
      out.push(c);
    }
    setFiles((prev) => [...prev, ...out].slice(0, 5));
    if (inputRef.current) inputRef.current.value = "";
  };

  const isIssue = kind === "issue";
  const valid = isIssue ? description.trim().length > 2 && blocking !== null : files.length > 0;

  const submit = async () => {
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
          {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button size="lg" className="w-full" onClick={submit} disabled={!valid || busy}>
            {busy ? "Enviando…" : isIssue ? "Enviar reporte" : "Guardar captura"}
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-slate-500">{context}</p>
      <div className="space-y-4">
        {isIssue && (
          <>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">¿Qué pasó? *</span>
              <textarea
                className={inputCls + " min-h-24"}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej. Toqué Guardar tarjeta y la pantalla se quedó en blanco."
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">¿Qué esperabas que pasara?</span>
              <textarea
                className={inputCls + " min-h-20"}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="Ej. Que saliera el aviso de tarjeta rechazada."
              />
            </label>
            <div>
              <span className="mb-1 block text-sm font-medium">¿Te impide seguir? *</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  [true, "Sí"],
                  [false, "No"],
                ].map(([v, l]) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setBlocking(v as boolean)}
                    className={`rounded-xl py-3 font-medium ring-1 ${
                      blocking === v ? "bg-brand-500 text-white ring-brand-500" : "bg-white ring-slate-300"
                    }`}
                  >
                    {l as string}
                  </button>
                ))}
              </div>
              {blocking && (
                <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  La actividad quedará en pausa y tendrás que pedir ayuda al guía de la prueba para continuar.
                </p>
              )}
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Número de pedido (si aplica)</span>
              <input className={inputCls} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Ej. 261118-0004" />
            </label>
          </>
        )}
        {!isIssue && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Nota (opcional)</span>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        )}
        <div>
          <span className="mb-1 block text-sm font-medium">
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
                className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-600"
              >
                <span className="text-2xl">📷</span>
                Agregar
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">Hasta 5 archivos, máximo {maxUploadMb} MB cada uno.</p>
        </div>
      </div>
    </Sheet>
  );
}
