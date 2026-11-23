"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityResult, Severity } from "@/lib/types";

/** Resultado de un paso: lo logré, no pude o «No me apareció» (pasos condicionales: terminado sin falla). */
export type Outcome = "ok" | "fail" | "na";

export type IssueAttachment = { id: string; name: string; size: number };
export type Issue = {
  id: string;
  activityId: string;
  stepId?: string;
  kind: "issue" | "evidence";
  description: string;
  expected: string;
  blocking: boolean;
  /** Severidad (alto / medio / bajo; antes bloqueante / mayor / menor); reportes viejos no la traen. */
  severity?: Severity;
  orderNumber: string;
  attachments: IssueAttachment[];
  createdAt: string;
};

export type ActivityState = {
  result?: ActivityResult;
  /** Resultado esperado: sí (true), no (false) o «No aplica» ("na", solo en los condicionales). */
  checks: Record<string, boolean | "na">;
  fields: Record<string, string>;
  notes: string;
  done: boolean;
};

export type QAEvent = { type: string; payload: Record<string, unknown> };

/** Actividad detenida por una falla que impide seguir. */
export type Blocked = {
  activityId: string;
  stepId?: string;
  issueId: string;
  /** Texto inicial (descripción del reporte) o el motivo enviado al guía. */
  reason: string;
  /** Id de la solicitud de ayuda en el servidor, una vez enviada. */
  helpId?: string;
  requestedAt?: string;
};

export type Tester = { name: string; email: string; role: string; fields: Record<string, string> };

export type RunState = {
  v: 1;
  guideVersion: string;
  runId: string;
  token: string;
  tester: Tester;
  prep: Record<string, boolean>;
  prepDone: boolean;
  steps: Record<string, Outcome>;
  activities: Record<string, ActivityState>;
  issues: Issue[];
  finish: Record<string, boolean>;
  survey: Record<string, string | number>;
  finished: boolean;
  outbox: QAEvent[];
  blocked?: Blocked;
  /** La prueba se terminó por un bloqueo (con la contraseña del guía). */
  ended?: { reason: string; at: string };
  /**
   * Casillas marcadas en los pasos de confirmación (`step.checkpoint`), por `stepKey` y número de
   * casilla. También viajan al servidor en el evento `step` (payload.checkpoint).
   */
  checkpoints?: Record<string, Record<string, boolean>>;
};

export const stepKey = (activityId: string, stepId: string) => `${activityId}:${stepId}`;
export const emptyActivity = (): ActivityState => ({ checks: {}, fields: {}, notes: "", done: false });

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const storageKey = (guideId: string) => `apphouse-qa:${guideId}`;

/** ¿Hay una corrida guardada en este navegador para la guía? */
export function hasStoredRun(guideId: string) {
  try {
    return Boolean(localStorage.getItem(storageKey(guideId)));
  } catch {
    return false;
  }
}

/**
 * Estado de la corrida: vive en localStorage (el progreso sobrevive a recargas) y cada cambio
 * se encola en `outbox` y se envía al servidor. Si no hay red, se reintenta solo.
 */
export function useRun(guideId: string) {
  const [state, setState] = useState<RunState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const stateRef = useRef<RunState | null>(null);
  const flushing = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(guideId));
      if (raw) {
        const parsed = JSON.parse(raw) as RunState;
        stateRef.current = parsed;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage solo existe en el cliente
        setState(parsed);
      }
    } catch {
      /* estado corrupto: se empieza de nuevo */
    }
     
    setLoaded(true);
  }, [guideId]);

  const commit = useCallback(
    (next: RunState | null) => {
      stateRef.current = next;
      setState(next);
      try {
        if (next) localStorage.setItem(storageKey(guideId), JSON.stringify(next));
        else localStorage.removeItem(storageKey(guideId));
      } catch {
        /* almacenamiento lleno o modo privado */
      }
    },
    [guideId]
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (flushing.current) {
      await flushing.current;
    }
    let recovered = false;
    const run = async (): Promise<boolean> => {
      const s = stateRef.current;
      if (!s || s.outbox.length === 0) return true;
      const batch = s.outbox.slice(0, 100);
      setSyncing(true);
      try {
        const res = await fetch(`/api/runs/${s.runId}/events`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-run-token": s.token },
          body: JSON.stringify({ events: batch }),
        });
        if ((res.status === 401 || res.status === 404) && !recovered) {
          recovered = true;
          // El servidor ya no conoce esta prueba (p. ej. se reinició su base de datos): se registra
          // otra vez con los mismos datos y se reenvía todo lo guardado en este navegador.
          const rec = await recoverRun(guideId, stateRef.current!);
          commit(rec);
          return await run();
        }
        if (!res.ok) {
          console.warn("[sync] el servidor respondió", res.status);
          throw new Error(String(res.status));
        }
        const cur = stateRef.current!;
        commit({ ...cur, outbox: cur.outbox.slice(batch.length) });
        setSyncError(false);
        return stateRef.current!.outbox.length === 0 ? true : await run();
      } catch {
        setSyncError(true);
        return false;
      } finally {
        setSyncing(false);
      }
    };
    flushing.current = run();
    const ok = await flushing.current;
    flushing.current = null;
    return ok;
  }, [commit, guideId]);

  /** Aplica un cambio local y encola los eventos para el servidor. */
  const update = useCallback(
    (fn: (s: RunState) => RunState, events: QAEvent[] = []) => {
      const cur = stateRef.current;
      if (!cur) return;
      const next = fn(cur);
      commit({ ...next, outbox: [...next.outbox, ...events] });
      if (events.length) void flush();
    },
    [commit, flush]
  );

  // Reintento automático
  useEffect(() => {
    const retry = () => {
      if (stateRef.current?.outbox.length) void flush();
    };
    window.addEventListener("online", retry);
    const t = setInterval(retry, 15000);
    retry();
    return () => {
      window.removeEventListener("online", retry);
      clearInterval(t);
    };
  }, [flush, loaded]);

  return { state, loaded, syncing, syncError, commit, update, flush, stateRef };
}

/**
 * Vuelve a registrar una prueba que el servidor ya no reconoce y arma de nuevo, desde el estado
 * guardado en el navegador, todos los eventos (preparación, pasos, fallas, actividades, cierre y
 * encuesta). Las capturas ya subidas al servidor anterior no se pueden recuperar.
 */
async function recoverRun(guideId: string, s: RunState): Promise<RunState> {
  let device: Record<string, string | number> = {};
  try {
    device = await detectDevice();
  } catch {
    /* sin datos del aparato */
  }
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      guideId,
      name: s.tester.name,
      email: s.tester.email,
      fields: s.tester.fields,
      device: { ...device, recoveredFrom: s.runId.slice(0, 36) },
    }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { runId: string; token: string };
  return { ...s, runId: data.runId, token: data.token, outbox: rebuildEvents(s) };
}

function rebuildEvents(s: RunState): QAEvent[] {
  const ev: QAEvent[] = [];
  if (Object.keys(s.prep ?? {}).length) ev.push({ type: "run", payload: { prep: s.prep } });
  for (const [k, outcome] of Object.entries(s.steps ?? {})) {
    const i = k.indexOf(":");
    const ticks = s.checkpoints?.[k];
    ev.push({ type: "step", payload: { activityId: k.slice(0, i), stepId: k.slice(i + 1), outcome, ...(ticks ? { checkpoint: ticks } : {}) } });
  }
  for (const issue of s.issues ?? []) ev.push({ type: "issue", payload: { ...issue, attachments: [] } });
  for (const [activityId, a] of Object.entries(s.activities ?? {})) {
    if (a.done) ev.push({ type: "activity", payload: { activityId, result: a.result, checks: a.checks, fields: a.fields, notes: a.notes } });
  }
  if (Object.keys(s.finish ?? {}).length) ev.push({ type: "run", payload: { finish: s.finish } });
  if (Object.keys(s.survey ?? {}).length) ev.push({ type: s.finished ? "survey" : "surveyDraft", payload: { answers: s.survey } });
  return ev;
}

const PHONE_QUERY = "(max-width: 767px)";

/** Teléfono: pantalla angosta o navegador de celular. Tabletas y computadoras cuentan como escritorio. */
export function isPhone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(PHONE_QUERY).matches || /Android.+Mobile|iPhone|iPod/.test(navigator.userAgent);
}

/** Llamada directa al servidor (sin cola): necesita conexión. Devuelve los datos o un mensaje de error. */
export async function callRun<T = Record<string, unknown>>(
  run: { runId: string; token: string },
  path: string,
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return { ok: false, error: "No hay conexión a internet. Conéctate y vuelve a intentarlo." };
  try {
    const res = await fetch(`/api/runs/${run.runId}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-run-token": run.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string }).error || "No se pudo completar. Inténtalo de nuevo." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "No hay conexión con el servidor. Revisa tu internet y vuelve a intentarlo." };
  }
}

/** Datos del dispositivo y navegador, detectados automáticamente. */
export async function detectDevice(): Promise<Record<string, string | number>> {
  const ua = navigator.userAgent;
  let os = "Desconocido";
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Android\s([\d.]+)/))) os = `Android ${m[1]}`;
  else if ((m = ua.match(/(?:iPhone|iPad|iPod).*?OS\s([\d_]+)/))) os = `iOS ${m[1].replace(/_/g, ".")}`;
  else if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) os = "iPadOS";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = "Otro";
  if ((m = ua.match(/SamsungBrowser\/([\d.]+)/))) browser = `Samsung Internet ${m[1]}`;
  else if ((m = ua.match(/EdgA?\/([\d.]+)/))) browser = `Edge ${m[1]}`;
  else if ((m = ua.match(/OPR\/([\d.]+)/))) browser = `Opera ${m[1]}`;
  else if ((m = ua.match(/FxiOS\/([\d.]+)|Firefox\/([\d.]+)/))) browser = `Firefox ${m[1] || m[2]}`;
  else if ((m = ua.match(/CriOS\/([\d.]+)/))) browser = `Chrome iOS ${m[1]}`;
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) browser = `Chrome ${m[1]}`;
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) browser = `Safari ${m[1]}`;
  if (/; wv\)/.test(ua) || /FBAN|FBAV|Instagram|WhatsApp/.test(ua)) browser += " (navegador interno)";

  let model = "";
  if ((m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/))) model = m[1].trim() === "K" ? "" : m[1].trim();
  type UAData = { getHighEntropyValues?: (h: string[]) => Promise<{ model?: string; platformVersion?: string }> };
  const uaData = (navigator as unknown as { userAgentData?: UAData }).userAgentData;
  if (uaData?.getHighEntropyValues) {
    try {
      const hv = await uaData.getHighEntropyValues(["model", "platformVersion"]);
      if (hv.model) model = hv.model;
    } catch {
      /* no disponible */
    }
  }
  return {
    os,
    browser,
    model,
    screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    touch: navigator.maxTouchPoints > 0 ? "sí" : "no",
    userAgent: ua.slice(0, 400),
  };
}

/** Reduce fotos grandes antes de subirlas (ahorra datos en el celular). */
export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 700 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
