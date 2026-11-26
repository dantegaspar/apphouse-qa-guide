/**
 * Simulador de testers para probar la Mesa de control. Lo usan simular-clientes.mjs y
 * simular-establecimientos.mjs. Habla con la misma API que la página del tester, así que lo que
 * hace se ve en vivo en /admin y en la Mesa (avance, fallas con foto, ayudas y encuesta final).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------- Opciones
const AYUDA = `
Opciones (también por variable de entorno):
  --url <url>            Servidor (QA_URL). Por omisión http://localhost:3000
  --testers <n>          Cuántos testers a la vez. Por omisión 4
  --ritmo <seg>          Segundos promedio por actividad (avance gradual). Por omisión 6
  --escenarios <lista>   Separados por coma; se reparten entre los testers en orden.
                         completa, fallas, no-me-toco, ayuda, bloqueo, abandona
                         Por omisión: todos, en ese orden
  --espera-ayuda <seg>   Cuánto espera un tester a que Mesa resuelva su ayuda. Por omisión 600
  --nueva-encuesta [nombre]  Abre una encuesta (ronda) nueva antes de empezar, para no mezclar
                         con datos reales. Pide ADMIN_PASSWORD.
  --variante app         Solo establecimientos: usa la guía de la app móvil
  --si                   Confirma que escribirás en un servidor que no es local
  --ayuda                Muestra esto

Variables: ADMIN_PASSWORD (para --nueva-encuesta), GUIDE_PASSWORD (el escenario «bloqueo»
termina la prueba con la contraseña del guía si Mesa no resuelve la ayuda a tiempo).
`;

export function leerOpciones(argv = process.argv.slice(2)) {
  const o = {
    url: process.env.QA_URL || "http://localhost:3000",
    testers: 4,
    ritmo: 6,
    escenarios: ["completa", "fallas", "no-me-toco", "ayuda", "bloqueo", "abandona"],
    esperaAyuda: 600,
    nuevaEncuesta: null,
    variante: "",
    si: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const sig = () => argv[++i];
    if (a === "--url") o.url = sig();
    else if (a === "--testers") o.testers = Math.max(1, Number(sig()) || 1);
    else if (a === "--ritmo") o.ritmo = Math.max(0, Number(sig()) || 0);
    else if (a === "--escenarios") o.escenarios = sig().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--espera-ayuda") o.esperaAyuda = Math.max(0, Number(sig()) || 0);
    else if (a === "--nueva-encuesta") o.nuevaEncuesta = argv[i + 1] && !argv[i + 1].startsWith("--") ? sig() : "";
    else if (a === "--variante") o.variante = sig();
    else if (a === "--si") o.si = true;
    else if (a === "--ayuda" || a === "-h" || a === "--help") {
      console.log(AYUDA);
      process.exit(0);
    } else {
      console.error(`Opción desconocida: ${a}\n${AYUDA}`);
      process.exit(1);
    }
  }
  o.url = o.url.replace(/\/+$/, "");
  const validos = ["completa", "fallas", "no-me-toco", "ayuda", "bloqueo", "abandona"];
  const malos = o.escenarios.filter((e) => !validos.includes(e));
  if (malos.length) {
    console.error(`Escenario desconocido: ${malos.join(", ")}. Usa: ${validos.join(", ")}`);
    process.exit(1);
  }
  const host = new URL(o.url).hostname;
  const local = ["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".localhost");
  if (!local && !o.si) {
    console.error(`Vas a escribir pruebas simuladas en ${host}. Si es lo que quieres, agrega --si (y de preferencia --nueva-encuesta).`);
    process.exit(1);
  }
  return o;
}

// ---------------------------------------------------------------- Utilidades
export const guia = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, "content/guides", `${id}.json`), "utf8"));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera alrededor de `seg` segundos (±50 %) para que el avance se vea gradual. */
export const pausa = (seg) => dormir(Math.round(seg * 1000 * (0.5 + Math.random())));
const azar = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hora = () => new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const log = (quien, msg) => console.log(`${hora()}  ${quien.padEnd(26)} ${msg}`);

async function api(o, ruta, { method = "POST", body, headers = {}, form } = {}) {
  const r = await fetch(o.url + ruta, {
    method,
    headers: form ? headers : { "content-type": "application/json", ...headers },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${ruta} → ${r.status} ${j.error ?? JSON.stringify(j).slice(0, 300)}`);
  if (j.rejected?.length) throw new Error(`${ruta}: eventos rechazados ${JSON.stringify(j.rejected).slice(0, 500)}`);
  return j;
}

/** Abre una encuesta (ronda) nueva con la contraseña del panel. */
export async function abrirEncuesta(o, nombre) {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) throw new Error("--nueva-encuesta necesita ADMIN_PASSWORD en el entorno.");
  const r = await fetch(o.url + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pass }) });
  if (!r.ok) throw new Error(`No se pudo entrar al panel (${r.status}).`);
  const cookie = (r.headers.getSetCookie?.() ?? [r.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
  const fecha = new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  const res = await api(o, "/api/admin/rounds", { headers: { cookie }, body: { action: "new", name: nombre || `Simulación ${fecha}` } });
  return res.round;
}

// Captura PNG pequeña (gris) para adjuntar a los reportes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR42mN8+/YtA6WAiYFKYNSQUUNGDRk1BAA9JQOhb2DqQwAAAABJRU5ErkJggg==",
  "base64"
);

// ---------------------------------------------------------------- Campos de cada actividad
let folioN = 1000 + Math.floor(Math.random() * 8000);
const folio = () => `#${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${String(folioN++).padStart(4, "0")}`;
const horaCampo = () => `${10 + Math.floor(Math.random() * 9)}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`;
const POR_ID = {
  ridersCount: "2", couriersCount: "2", ordersDelivered: () => String(4 + Math.floor(Math.random() * 4)), ordersFailed: "0", assignMinutes: () => String(1 + Math.floor(Math.random() * 5)),
  folio, rejectedFolio: () => `${folio()} · 13:05`, cancelledFolio: () => `${folio()} · 13:20`,
  codeMinutes: "1", hawaianaPrice: "$156", promoPrice: "$299", totals: "Subtotal $378, envío $35, total $413",
  orderCard: folio, orderCash: folio, orderBranch1: folio, orderBranch2: folio,
  deliveryCode: () => String(1000 + Math.floor(Math.random() * 9000)), finalStage: "Entregado", stageBefore: "En camino", stageAfter: "En camino",
};
// Facilidad de la actividad (SEQ, 1 a 7) cuando la guía la pregunta (guide.seq): baja si hubo falla.
const seqCampo = (g, falla) => (g.seq ? { seq: String(falla ? 3 + Math.floor(Math.random() * 2) : 5 + Math.floor(Math.random() * 3)) } : {});
function campos(act, extra = {}) {
  const out = { ...extra };
  for (const f of act.fields ?? []) {
    if (f.id in extra) { out[f.id] = extra[f.id]; continue; }
    let v = POR_ID[f.id];
    if (typeof v === "function") v = v();
    if (v === undefined && f.options?.length) v = f.options[0];
    if (v === undefined && (f.type === "time")) v = horaCampo();
    if (v === undefined && f.type === "timeRange") v = "10:00 a 22:00";
    if (v === undefined && f.type === "number") v = "3";
    if (v === undefined && f.required) v = "Sí";
    if (v !== undefined) out[f.id] = v;
  }
  return out;
}

// ---------------------------------------------------------------- Un tester
/**
 * Corre una prueba completa de un tester según su escenario:
 * - completa: todo «Todo salió bien».
 * - fallas: 2 actividades con falla (una con foto), una de severidad media y otra baja.
 * - no-me-toco: marca «No me tocó» en 2 actividades y en los pasos condicionales.
 * - ayuda: una falla que le impide seguir; pide ayuda y espera a que Mesa la resuelva.
 * - bloqueo: igual, pero si Mesa no la resuelve a tiempo, el guía termina la prueba (GUIDE_PASSWORD).
 * - abandona: se queda a la mitad, sin encuesta.
 */
export async function correrTester(o, { guideId, tester, escenario, fallas, encuesta }) {
  const g = guia(guideId);
  const quien = `${tester.name} (${escenario})`;
  const { runId, token, roundId } = await api(o, "/api/runs", {
    body: { guideId, name: tester.name, email: tester.email, fields: tester.fields, device: tester.device },
  });
  const H = { "x-run-token": token };
  log(quien, `registrado en la encuesta ${roundId ?? "?"} · ${g.activities.length} actividades`);
  const enviar = (events) => api(o, `/api/runs/${runId}/events`, { headers: H, body: { events } });
  await enviar([{ type: "run", payload: { prep: Object.fromEntries(g.prep.checklist.map((c) => [c.id, true])) } }]);

  const acts = g.activities;
  const mitad = Math.floor(acts.length / 2);
  const conFalla = escenario === "fallas" ? [azar(fallas.slice(0, 2)), azar(fallas.slice(2))] : [];
  const noMeToco = escenario === "no-me-toco" ? acts.filter((a) => !a.priority || a.priority !== "critica").slice(-3, -1).map((a) => a.id) : [];
  const bloqueante = escenario === "ayuda" || escenario === "bloqueo" ? fallas[0] : null;

  for (const [i, act] of acts.entries()) {
    if (escenario === "abandona" && i === mitad) {
      log(quien, `abandona en ${act.id} (no termina ni contesta la encuesta)`);
      return { runId, estado: "abandonada" };
    }
    await pausa(o.ritmo);
    if (noMeToco.includes(act.id)) {
      await enviar([{ type: "activity", payload: { activityId: act.id, result: "skipped", checks: {}, fields: {}, notes: "No me tocó en esta prueba." } }]);
      log(quien, `${act.id} · No me tocó`);
      continue;
    }
    const f = conFalla.find((x) => x.act === act.id) ?? (bloqueante?.act === act.id ? { ...bloqueante, severity: "alto", blocking: true } : null);
    const falla = f && act.steps.some((s) => s.id === f.step) ? f : f ? { ...f, step: act.steps[Math.min(1, act.steps.length - 1)].id } : null;
    const ev = [];
    for (const s of act.steps) {
      const outcome = falla?.step === s.id ? "fail" : s.conditional && (escenario === "no-me-toco" || Math.random() < 0.4) ? "na" : "ok";
      const p = { activityId: act.id, stepId: s.id, outcome };
      if (s.checkpoint?.items?.length) p.checkpoint = Object.fromEntries(s.checkpoint.items.map((_, k) => [String(k), outcome === "ok"]));
      ev.push({ type: "step", payload: p });
    }
    let issueId = null;
    if (falla) {
      issueId = "sim-" + crypto.randomUUID();
      ev.push({
        type: "issue",
        payload: { id: issueId, activityId: act.id, stepId: falla.step, kind: "issue", description: falla.description, expected: falla.expected ?? "", blocking: !!falla.blocking, severity: falla.severity ?? "medio", orderNumber: falla.order ? folio() : "" },
      });
    }
    await enviar(ev);
    if (issueId && (falla.foto || falla.blocking)) {
      const form = new FormData();
      form.append("issueId", issueId);
      form.append("file", new Blob([PNG], { type: "image/png" }), `captura-${act.id}.png`);
      await api(o, `/api/runs/${runId}/attachments`, { headers: H, form });
    }

    if (falla?.blocking) {
      log(quien, `${act.id} · falla que impide seguir → pide ayuda a Mesa`);
      await api(o, `/api/runs/${runId}/help`, { headers: H, body: { activityId: act.id, stepId: falla.step, issueId, reason: falla.description } });
      const fin = await esperarAyuda(o, runId, H, quien, escenario);
      if (fin === "terminada") return { runId, estado: "terminada por bloqueo" };
      if (fin === "sin-respuesta") return { runId, estado: "esperando ayuda (sin respuesta de Mesa)" };
    }

    const result = falla ? "issue" : "ok";
    const checks = {};
    act.expected.forEach((e, k) => {
      const cond = typeof e !== "string" && e.conditional;
      checks[String(k)] = falla && k === 0 ? false : cond && Math.random() < 0.3 ? "na" : true;
    });
    await enviar([{ type: "activity", payload: { activityId: act.id, result, checks, notes: falla ? "Reporté la falla." : "", fields: campos(act, seqCampo(g, !!falla)) } }]);
    log(quien, `${act.id} · ${falla ? `Tuvo alguna falla (${falla.severity ?? "medio"}${falla.foto || falla.blocking ? ", con foto" : ""})` : "Todo salió bien"}`);
  }

  await pausa(o.ritmo);
  await enviar([
    { type: "run", payload: { finish: Object.fromEntries(g.finish.checklist.map((c) => [c.id, true])) } },
    { type: "survey", payload: { answers: encuesta(g, escenario) } },
  ]);
  log(quien, "terminó y contestó la encuesta final");
  return { runId, estado: "terminada" };
}

async function esperarAyuda(o, runId, H, quien, escenario) {
  const limite = Date.now() + o.esperaAyuda * 1000;
  let avisado = false;
  while (Date.now() < limite) {
    await dormir(5000);
    const h = await api(o, `/api/runs/${runId}/help`, { method: "GET", headers: H });
    if (h.status === "ended_blocked") {
      log(quien, "Mesa terminó la prueba por bloqueo");
      return "terminada";
    }
    if (!h.open) {
      log(quien, "Mesa resolvió la ayuda → sigue con la prueba");
      return "resuelta";
    }
    if (!avisado) {
      log(quien, `esperando a que Mesa resuelva la ayuda (hasta ${o.esperaAyuda} s)…`);
      avisado = true;
    }
  }
  if (escenario === "bloqueo" && process.env.GUIDE_PASSWORD) {
    await api(o, `/api/runs/${runId}/end`, { headers: H, body: { password: process.env.GUIDE_PASSWORD, reason: "Simulación: el bloqueo no se resolvió a tiempo." } });
    log(quien, "nadie resolvió la ayuda: el guía termina la prueba por bloqueo");
    return "terminada";
  }
  log(quien, "nadie resolvió la ayuda: la prueba queda en pausa");
  return "sin-respuesta";
}

// ---------------------------------------------------------------- Encuesta final
export function encuestaBase(g, escenario, textos) {
  const q = Object.fromEntries(g.survey.questions.map((x) => [x.id, x]));
  const alto = escenario === "completa" || escenario === "no-me-toco";
  const ans = {
    umux1: alto ? 6 + Math.round(Math.random()) : 4 + Math.round(Math.random() * 2),
    umux2: alto ? 6 + Math.round(Math.random()) : 4 + Math.round(Math.random() * 2),
    logistica: q.logistica.options[escenario === "no-me-toco" && Math.random() < 0.5 ? 1 : 0],
    hardest: q.hardest && (alto ? q.hardest.options[q.hardest.options.length - 1] : azar(q.hardest.options.slice(0, -1))),
    guia: alto ? 6 + Math.round(Math.random()) : 4 + Math.round(Math.random() * 2),
    improve: azar(textos),
  };
  for (const k of Object.keys(ans)) if (!q[k]) delete ans[k];
  return ans;
}

// ---------------------------------------------------------------- Varios testers a la vez
export async function correr(o, crear) {
  console.log(`Servidor: ${o.url}`);
  const salud = await fetch(o.url + "/api/health").then((r) => r.ok).catch(() => false);
  if (!salud) throw new Error(`No responde ${o.url}/api/health. ¿Está corriendo el servidor?`);
  if (o.nuevaEncuesta !== null) {
    const r = await abrirEncuesta(o, o.nuevaEncuesta);
    console.log(`Encuesta nueva: «${r.name}» (id ${r.id}). Lo simulado queda ahí.`);
  }
  console.log(`${o.testers} testers · ritmo ~${o.ritmo} s por actividad · escenarios: ${o.escenarios.join(", ")}\n`);
  const tareas = Array.from({ length: o.testers }, (_, i) => {
    const escenario = o.escenarios[i % o.escenarios.length];
    return dormir(i * 1500).then(() => correrTester(o, crear(i, escenario))).catch((e) => ({ estado: `error: ${e.message}` }));
  });
  const res = await Promise.all(tareas);
  console.log("\nResumen:");
  res.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${o.escenarios[i % o.escenarios.length].padEnd(11)} ${r.estado}`));
  if (res.some((r) => r.estado.startsWith("error"))) process.exitCode = 1;
}

export const NOMBRES = ["Ana", "Luis", "Marta", "Jorge", "Sofía", "Diego", "Paola", "Ricardo", "Valeria", "Héctor", "Lucía", "Andrés"];
export const sello = () => crypto.randomBytes(2).toString("hex");
