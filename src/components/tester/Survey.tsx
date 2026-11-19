"use client";

import { useState } from "react";
import type { Guide } from "@/lib/types";
import { Button, inputCls } from "./ui";

export default function Survey({
  survey,
  initial,
  finished,
  onSubmit,
  onBack,
}: {
  survey: Guide["survey"];
  initial: Record<string, string | number>;
  finished: boolean;
  onSubmit: (answers: Record<string, string | number>) => void;
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | number>>(initial);
  const [sent, setSent] = useState(finished);
  const set = (id: string, v: string | number) => setAnswers({ ...answers, [id]: v });
  const missing = survey.questions.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === ""));

  if (sent) {
    return (
      <div className="animate-pop flex flex-col items-center py-12 text-center">
        <div className="text-6xl">🎉</div>
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
    <div className="animate-pop space-y-4 pb-8">
      <button onClick={onBack} className="text-sm text-brand-600">
        ← Resumen
      </button>
      <h1 className="text-2xl font-bold">{survey.title}</h1>
      {survey.intro && <p className="text-slate-600">{survey.intro}</p>}
      {survey.questions.map((q, n) => (
        <fieldset key={q.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <legend className="sr-only">{q.label}</legend>
          <p className="mb-3 font-medium">
            {n + 1}. {q.label}
            {q.required && <span className="text-rose-600"> *</span>}
          </p>
          {(q.type === "scale" || q.type === "nps") && (
            <>
              <div className={`grid gap-1.5 ${q.type === "nps" ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-5"}`}>
                {Array.from({ length: (q.type === "nps" ? 10 : (q.max ?? 5)) - (q.type === "nps" ? 0 : (q.min ?? 1)) + 1 }, (_, i) =>
                  (q.type === "nps" ? 0 : (q.min ?? 1)) + i
                ).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set(q.id, v)}
                    className={`rounded-lg py-2.5 text-sm font-semibold ring-1 ${
                      answers[q.id] === v ? "bg-brand-500 text-white ring-brand-500" : "bg-white ring-slate-300"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>{q.type === "nps" ? "Nada probable" : q.minLabel}</span>
                <span>{q.type === "nps" ? "Muy probable" : q.maxLabel}</span>
              </div>
            </>
          )}
          {q.type === "choice" && (
            <div className="space-y-2">
              {q.options?.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => set(q.id, o)}
                  className={`block w-full rounded-xl px-4 py-3 text-left text-sm ring-1 ${
                    answers[q.id] === o ? "bg-brand-500 font-medium text-white ring-brand-500" : "bg-white ring-slate-300"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          {q.type === "text" && (
            <textarea className={inputCls + " min-h-20"} value={String(answers[q.id] ?? "")} onChange={(e) => set(q.id, e.target.value)} />
          )}
        </fieldset>
      ))}
      <Button
        size="lg"
        className="w-full"
        disabled={missing.length > 0}
        onClick={() => {
          onSubmit(answers);
          setSent(true);
          window.scrollTo({ top: 0 });
        }}
      >
        {missing.length ? `Faltan ${missing.length} respuesta(s) obligatoria(s)` : "Enviar encuesta"}
      </Button>
    </div>
  );
}
