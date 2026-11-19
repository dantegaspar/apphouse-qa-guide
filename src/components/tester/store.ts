"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityResult } from "@/lib/types";

export type Outcome = "ok" | "fail";

export type IssueAttachment = { id: string; name: string; size: number };
export type Issue = {
  id: string;
  activityId: string;
  stepId?: string;
  kind: "issue" | "evidence";
  description: string;
  expected: string;
  blocking: boolean;
  orderNumber: string;
  attachments: IssueAttachment[];
  createdAt: string;
};

export type ActivityState = {
  result?: ActivityResult;
  checks: Record<string, boolean>;
  fields: Record<string, string>;
  notes: string;
  done: boolean;
};

export type QAEvent = { type: string; payload: Record<string, unknown> };

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
};

export const stepKey = (activityId: string, stepId: string) => `${activityId}:${stepId}`;
export const emptyActivity = (): ActivityState => ({ checks: {}, fields: {}, notes: "", done: false });

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const storageKey = (guideId: string) => `apphouse-qa:${guideId}`;

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
        if (!res.ok) throw new Error(String(res.status));
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
  }, [commit]);

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
