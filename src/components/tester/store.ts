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
  /**
   * Ronda (encuesta) en la que se registró la prueba. Cuando el admin abre «+ Nueva encuesta», la
   * prueba guardada deja de valer y el tester empieza otra sin borrar nada del navegador.
   * Las pruebas guardadas antes de que existieran las rondas no lo traen: se pregunta al servidor.
   */
  roundId?: number;
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
/** Copia de una prueba de una ronda anterior (no se borra: por si quedó algo sin enviar). */
const archiveKey = (guideId: string, round: number | string) => `apphouse-qa:${guideId}:ronda-${round}`;

function readStored(guideId: string): RunState | null {
  try {
    const raw = localStorage.getItem(storageKey(guideId));
    return raw ? (JSON.parse(raw) as RunState) : null;
  } catch {
    return null;
  }
}

/**
 * ¿Hay una prueba guardada en este navegador para la guía en la ronda activa? Una prueba de otra
 * ronda no cuenta; una sin ronda (de antes de las rondas) se cuenta como guardada.
 */
export function hasStoredRun(guideId: string, roundId?: number) {
  const s = readStored(guideId);
  if (!s) return false;
  return roundId === undefined || s.roundId === undefined || s.roundId === roundId;
}

/** Ronda de la prueba y ronda activa, tal como las informa el servidor en sus respuestas. */
export type RoundInfo = { roundId?: number; activeRoundId?: number };

function roundInfoOf(data: unknown): RoundInfo {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    roundId: typeof d.roundId === "number" ? d.roundId : undefined,
    activeRoundId: typeof d.activeRoundId === "number" ? d.activeRoundId : undefined,
  };
}

/**
 * Avisos de ronda de las llamadas directas (ayuda, archivos, terminar): `useRun` los escucha para
 * cerrar la prueba si el admin abrió una encuesta nueva.
 */
const roundListeners = new Set<(runId: string, info: RoundInfo) => void>();
export function reportRound(runId: string, data: unknown) {
  const info = roundInfoOf(data);
  if (info.activeRoundId === undefined) return;
  for (const fn of roundListeners) fn(runId, info);
}

function writeStored(guideId: string, s: RunState | null) {
  try {
    if (s) localStorage.setItem(storageKey(guideId), JSON.stringify(s));
    else localStorage.removeItem(storageKey(guideId));
  } catch {
    /* almacenamiento lleno o modo privado */
  }
}

/** Manda a su propia prueba todo lo que quedó en cola (sin reintentos). Devuelve lo que no se pudo enviar. */
async function sendOutbox(s: RunState): Promise<QAEvent[]> {
  let left = s.outbox ?? [];
  while (left.length) {
    const batch = left.slice(0, 100);
    try {
      const res = await fetch(`/api/runs/${s.runId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-run-token": s.token },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) break;
    } catch {
      break;
    }
    left = left.slice(batch.length);
  }
  return left;
}

/**
 * Aparta la prueba guardada (de otra ronda) para que el tester empiece de nuevo. Si le quedaban
 * cambios sin enviar, se intenta mandarlos a esa misma prueba antes de dejarla de lado.
 * Solo se quita del navegador si sigue siendo la guardada (otra pestaña pudo registrar otra).
 */
function archiveStored(guideId: string, s: RunState) {
  const key = archiveKey(guideId, s.roundId ?? "anterior");
  try {
    localStorage.setItem(key, JSON.stringify(s));
    if (readStored(guideId)?.runId === s.runId) localStorage.removeItem(storageKey(guideId));
  } catch {
    /* almacenamiento lleno o modo privado */
  }
  if (s.outbox?.length) {
    void sendOutbox(s).then((left) => {
      try {
        // La copia apartada se queda solo con lo que no se pudo enviar
        const raw = localStorage.getItem(key);
        const saved = raw ? (JSON.parse(raw) as RunState) : null;
        if (saved?.runId === s.runId) localStorage.setItem(key, JSON.stringify({ ...saved, outbox: left }));
      } catch {
        /* modo privado */
      }
    });
  }
}

/** Ronda de una prueba guardada y ronda activa: se pregunta al servidor (null si no se sabe). */
async function fetchRunRound(s: RunState): Promise<RoundInfo | null> {
  try {
    const res = await fetch(`/api/runs/${s.runId}/round`, { headers: { "x-run-token": s.token }, cache: "no-store" });
    if (!res.ok) return null;
    const info = roundInfoOf(await res.json());
    return info.roundId === undefined ? null : info;
  } catch {
    return null;
  }
}

/** Quita de la cola los eventos de un lote ya enviado (por contenido: la cola pudo llegar de otra pestaña). */
function withoutSent(outbox: QAEvent[], batch: QAEvent[]): QAEvent[] {
  const sent = batch.map((e) => JSON.stringify(e));
  return outbox.filter((e) => {
    const i = sent.indexOf(JSON.stringify(e));
    if (i === -1) return true;
    sent.splice(i, 1);
    return false;
  });
}

/** Al volver a la pestaña (focus y visibilitychange llegan juntos) se pregunta una sola vez. */
const ROUND_CHECK_MIN_MS = 3000;

/**
 * Estado de la corrida: vive en localStorage (el progreso sobrevive a recargas) y cada cambio
 * se encola en `outbox` y se envía al servidor. Si no hay red, se reintenta solo.
 *
 * Encuesta nueva: la ronda activa que manda la página es solo el valor inicial; manda la que
 * informa el servidor (en cada envío, cada 15 s y al volver a la pestaña). Si la prueba es de una
 * ronda anterior, se cierra en este navegador: lo pendiente se envía a su propia prueba, se aparta
 * y el tester ve el registro con un aviso (`roundClosed`).
 *
 * Varias pestañas de la misma guía comparten la prueba guardada: cada una sigue los cambios de las
 * otras (evento `storage`) y ninguna escribe encima la prueba de una encuesta anterior.
 */
export function useRun(guideId: string, roundId?: number) {
  const [state, setState] = useState<RunState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  /** La prueba se cerró porque el admin abrió una encuesta nueva (el registro muestra un aviso). */
  const [roundClosed, setRoundClosed] = useState(false);
  const stateRef = useRef<RunState | null>(null);
  const flushing = useRef<Promise<boolean> | null>(null);
  /** Ronda activa: la de la página al cargar; después, la que diga el servidor. */
  const activeRound = useRef<number | undefined>(roundId);
  const lastCheck = useRef(0);
  const checking = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const use = (s: RunState | null) => {
      if (cancelled) return;
      stateRef.current = s;
      setState(s);
      setLoaded(true);
    };
    const parsed = readStored(guideId);
    if (!parsed || roundId === undefined || parsed.roundId === roundId) {
      use(parsed);
    } else if (parsed.roundId !== undefined) {
      // Prueba de una encuesta anterior: se aparta y el tester empieza la de la ronda nueva
      archiveStored(guideId, parsed);
      use(null);
    } else {
      // Guardada antes de que existieran las rondas: el servidor dice a cuál pertenece
      void fetchRunRound(parsed).then((info) => {
        if (cancelled) return;
        if (info?.activeRoundId !== undefined) activeRound.current = info.activeRoundId;
        const active = info?.activeRoundId ?? roundId;
        if (info && info.roundId !== active) {
          archiveStored(guideId, { ...parsed, roundId: info.roundId });
          use(null);
          return;
        }
        // Misma ronda, o no se pudo saber (sin conexión): se vuelve a preguntar con la página abierta
        const next = info ? { ...parsed, roundId: info.roundId } : parsed;
        writeStored(guideId, next);
        use(next);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [guideId, roundId]);

  /** ¿`s` es de una encuesta anterior a la de `than` o a la ronda activa conocida? */
  const isOlder = useCallback((s: RunState, than?: RunState | null) => {
    if (s.roundId === undefined) return false;
    return s.roundId < Math.max(than?.roundId ?? -Infinity, activeRound.current ?? -Infinity);
  }, []);

  /** Toma el estado que dejó otra pestaña (sin volver a guardarlo: así no hay ida y vuelta). */
  const adopt = useCallback((s: RunState | null) => {
    stateRef.current = s;
    setState(s);
    if (s) setRoundClosed(false);
  }, []);

  /** Esta pestaña deja su prueba porque otra la reemplazó: lo pendiente se manda a su propia prueba. */
  const leave = useCallback(
    (s: RunState) => {
      if (isOlder(s)) archiveStored(guideId, s);
      else if (s.outbox.length) void sendOutbox(s);
    },
    [guideId, isOlder]
  );

  const commit = useCallback(
    (next: RunState | null) => {
      const prevRunId = stateRef.current?.runId;
      if (next && prevRunId) {
        const stored = readStored(guideId);
        // Otra pestaña guardó otra prueba (p. ej. registró la de la encuesta nueva): se sigue esa en
        // vez de escribirle encima la de esta pestaña. Si la guardada es de una encuesta anterior, gana esta.
        if (stored && stored.runId !== next.runId && stored.runId !== prevRunId && !isOlder(stored, next)) {
          leave(next);
          adopt(stored);
          return;
        }
      }
      stateRef.current = next;
      setState(next);
      if (next) setRoundClosed(false);
      writeStored(guideId, next);
    },
    [guideId, isOlder, leave, adopt]
  );

  /** Cierra la prueba de una encuesta anterior: se aparta (enviando lo pendiente) y se avisa. */
  const closeOldRound = useCallback(
    (s: RunState) => {
      if (stateRef.current?.runId !== s.runId) return;
      stateRef.current = null;
      setState(null);
      setRoundClosed(true);
      archiveStored(guideId, s);
    },
    [guideId]
  );

  /** Aplica lo que dijo el servidor sobre la ronda de la prueba `runId`. */
  const applyRound = useCallback(
    (runId: string, info: RoundInfo) => {
      if (info.activeRoundId !== undefined) activeRound.current = info.activeRoundId;
      const s = stateRef.current;
      if (!s || s.runId !== runId) return;
      const runRound = s.roundId ?? info.roundId;
      // Prueba guardada sin ronda (de antes de las rondas): ya se sabe a cuál pertenece
      if (s.roundId === undefined && info.roundId !== undefined) commit({ ...s, roundId: info.roundId });
      if (runRound !== undefined && info.activeRoundId !== undefined && runRound !== info.activeRoundId)
        closeOldRound(stateRef.current ?? s);
    },
    [commit, closeOldRound]
  );

  useEffect(() => {
    roundListeners.add(applyRound);
    return () => {
      roundListeners.delete(applyRound);
    };
  }, [applyRound]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (flushing.current) {
      await flushing.current;
    }
    let recovered = false;
    let info: { runId: string; round: RoundInfo } | undefined;
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
        // Mientras tanto la prueba se cerró o la reemplazó otra pestaña: no se toca la nueva
        if (stateRef.current?.runId !== s.runId) return true;
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
        info = { runId: s.runId, round: roundInfoOf(await res.json().catch(() => ({}))) };
        const cur = stateRef.current;
        if (cur?.runId !== s.runId) return true;
        commit({ ...cur, outbox: withoutSent(cur.outbox, batch) });
        setSyncError(false);
        // Lo pendiente se termina de enviar a esta misma prueba; la ronda se revisa al final
        return !stateRef.current || stateRef.current.outbox.length === 0 ? true : await run();
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
    if (info) applyRound(info.runId, info.round);
    return ok;
  }, [commit, guideId, applyRound]);

  /**
   * ¿Sigue activa la encuesta de esta prueba? Con cambios en cola se envían (la respuesta trae la
   * ronda); si no, se pregunta al servidor. También completa la ronda de las pruebas sin `roundId`.
   */
  const checkRound = useCallback(
    async (force = false) => {
      const s = stateRef.current;
      if (!s || checking.current) return;
      if (!force && Date.now() - lastCheck.current < ROUND_CHECK_MIN_MS) return;
      checking.current = true;
      lastCheck.current = Date.now();
      try {
        if (s.outbox.length) await flush();
        else {
          const info = await fetchRunRound(s);
          if (info) applyRound(s.runId, info);
        }
      } finally {
        checking.current = false;
      }
    },
    [flush, applyRound]
  );

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

  // Reintento automático y revisión de la ronda: cada 15 s (con la pestaña a la vista) y al volver a ella
  useEffect(() => {
    const retry = () => {
      if (stateRef.current?.outbox.length) void flush();
    };
    const tick = () => {
      if (stateRef.current?.outbox.length) void flush();
      else if (document.visibilityState === "visible") void checkRound(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkRound();
    };
    const onFocus = () => void checkRound();
    window.addEventListener("online", retry);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(tick, 15000);
    retry();
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [flush, checkRound, loaded]);

  // Otra pestaña de la misma guía cambió la prueba guardada: esta la sigue
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== localStorage || (e.key !== null && e.key !== storageKey(guideId))) return;
      let incoming: RunState | null = null;
      try {
        incoming = e.key && e.newValue ? (JSON.parse(e.newValue) as RunState) : null;
      } catch {
        return;
      }
      const mine = stateRef.current;
      if (incoming && mine && incoming.runId === mine.runId) {
        // Misma prueba: la otra pestaña tiene lo más reciente
        adopt(incoming);
        return;
      }
      if (incoming) {
        if (isOlder(incoming, mine)) {
          // Una pestaña vieja guardó la prueba de una encuesta anterior: se vuelve a dejar la de esta
          // (una sola vez: la pestaña vieja sigue a la nueva sin volver a escribir)
          if (mine) writeStored(guideId, mine);
          return;
        }
        // Otra pestaña registró otra prueba (o la recuperó): se sigue esa
        if (mine) leave(mine);
        adopt(incoming);
        return;
      }
      // La otra pestaña apartó la prueba (encuesta nueva o «Empezar otra prueba»)
      if (!mine) return;
      adopt(null);
      void (async () => {
        if (mine.outbox.length) await sendOutbox(mine);
        const info = await fetchRunRound(mine);
        if (info?.activeRoundId === undefined) return;
        activeRound.current = info.activeRoundId;
        if (info.roundId !== info.activeRoundId && !stateRef.current) setRoundClosed(true);
      })();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [guideId, adopt, leave, isOlder]);

  /** Aparta la prueba terminada y deja el navegador listo para registrar otra (otra persona). */
  const restart = useCallback(() => {
    const cur = stateRef.current;
    if (cur) archiveStored(guideId, { ...cur, roundId: cur.roundId ?? activeRound.current });
    stateRef.current = null;
    setState(null);
  }, [guideId]);

  /** Quita el aviso de encuesta nueva. */
  const dismissRoundClosed = useCallback(() => setRoundClosed(false), []);

  return { state, loaded, syncing, syncError, commit, update, flush, stateRef, restart, roundClosed, dismissRoundClosed };
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
  const data = (await res.json()) as { runId: string; token: string; roundId?: number };
  return { ...s, runId: data.runId, token: data.token, roundId: data.roundId ?? s.roundId, outbox: rebuildEvents(s) };
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
    // La respuesta trae la ronda: si el admin abrió una encuesta nueva, useRun cierra esta prueba
    reportRound(run.runId, data);
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
  let bmp: ImageBitmap | undefined;
  try {
    bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    // Libera ya el mapa de bits descomprimido (pesa decenas de MB en celulares sencillos)
    bmp.close();
    bmp = undefined;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    bmp?.close();
  }
}
