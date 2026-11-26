import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { adjustedWald, BUSINESS_RULE, computeVerdict, THRESHOLDS, umuxLite } from "@/lib/verdict";
import { addIssue, addRun, readyScenario, resetDb, setActivity, setOrders } from "./helpers/seed";

const crit = (v: ReturnType<typeof computeVerdict>, id: string) => v.criteria.find((c) => c.id === id)!;

describe("estadística", () => {
  it("Wald ajustado: sin datos no hay intervalo", () => {
    expect(adjustedWald(0, 0)).toBeNull();
  });

  it("Wald ajustado: 9 de 10 da un intervalo dentro de [0, 1] que contiene 0.9", () => {
    const [lo, hi] = adjustedWald(9, 10)!;
    // Agresti-Coull: ñ = 10 + 1.96² = 13.84; p̃ = (9 + 1.92) / 13.84 = 0.789; margen = 1.96·√(p̃(1−p̃)/ñ) = 0.215
    expect(lo).toBeCloseTo(0.574, 3);
    expect(hi).toBe(1); // se recorta a 1
    expect(lo).toBeLessThan(0.9);
  });

  it("UMUX-Lite → SUS en los extremos de la escala", () => {
    expect(umuxLite(7, 7)).toEqual({ raw: 100, sus: 87.9 });
    expect(umuxLite(1, 1).raw).toBe(0);
    expect(umuxLite(1, 1).sus).toBeCloseTo(22.9);
  });
});

describe("veredicto: caso base", () => {
  it("sin pruebas no está listo y lo explica", () => {
    const round = resetDb();
    const v = computeVerdict(round);
    expect(v.ready).toBe(false);
    expect(v.reasons[0]).toBe("Todavía no hay pruebas registradas.");
  });

  it("con todo en orden el veredicto es Sí", () => {
    const { round } = readyScenario();
    const v = computeVerdict(round);
    expect(v.ready).toBe(true);
    expect(v.override).toBeNull();
    expect(v.orders).toMatchObject({ total: 10, completed: 10, rate: 1 });
    expect(v.participants).toEqual({ clientes: 1, establecimientos: 1 });
  });
});

describe("base del cálculo (quién cuenta)", () => {
  it("excluye a quien no terminó, a quien tuvo problema de logística y a quien Mesa excluyó", () => {
    const { round } = readyScenario();
    addRun({ guideId: "cliente", status: "in_progress", name: "A medias" });
    addRun({ guideId: "cliente", status: "ended_blocked", name: "Bloqueado" });
    addRun({ guideId: "cliente", logistica: "No me asignaron repartidor", name: "Sin repartidor" });
    addRun({ guideId: "cliente", scope: "excluir", name: "Excluido" });
    const v = computeVerdict(round);
    expect(v.population.total).toBe(6);
    expect(v.population.valid).toBe(2);
    expect(v.population.counts).toEqual({ sin_terminar: 2, logistica: 1, mesa: 1 });
  });

  it("«Incluir» desde Mesa anula la exclusión por logística", () => {
    const { round } = readyScenario();
    addRun({ guideId: "cliente", logistica: "No me asignaron repartidor", scope: "incluir" });
    expect(computeVerdict(round).population.valid).toBe(3);
  });

  it("los excluidos no bajan los porcentajes: una actividad fallida de quien abandonó no cuenta", () => {
    const { round } = readyScenario();
    const quit = addRun({ guideId: "cliente", status: "in_progress" });
    setActivity(quit, "C05", "fail");
    const c05 = computeVerdict(round).activities.find((a) => a.id === "C05")!;
    expect(c05).toMatchObject({ executed: 1, allOk: 1, meets: true });
  });
});

describe("criterio 1: pedidos completados de punta a punta", () => {
  it(`pasa con exactamente ${THRESHOLDS.endToEnd * 100} % y falla debajo`, () => {
    const { round, est } = readyScenario();
    setOrders(est, 9, 1);
    expect(crit(computeVerdict(round), "punta_a_punta").pass).toBe(true);
    setOrders(est, 8, 2);
    const v = computeVerdict(round);
    expect(crit(v, "punta_a_punta").pass).toBe(false);
    expect(v.ready).toBe(false);
  });

  it("sin pedidos anotados no se puede dar el Sí", () => {
    const { round, est } = readyScenario();
    setActivity(est, "E07", "ok", {});
    const v = computeVerdict(round);
    expect(crit(v, "punta_a_punta")).toMatchObject({ pass: false, measured: "sin pedidos anotados en E07" });
    expect(v.ready).toBe(false);
  });

  it("descuenta los pedidos fallados que el dictamen clasificó como ajenos al desarrollo", () => {
    const { round, est } = readyScenario();
    setOrders(est, 8, 2);
    getDb()
      .prepare("INSERT INTO claude_dictamen (round_id, applied, created_at) VALUES (?, ?, ?)")
      .run(round, JSON.stringify({ orderAjenos: { [est]: 2 } }), new Date().toISOString());
    const v = computeVerdict(round);
    expect(v.orders).toMatchObject({ total: 8, completed: 8 });
    expect(crit(v, "punta_a_punta").pass).toBe(true);
  });

  it("hoja de pedidos: los rechazados a propósito (folio en E08) no cuentan; otro rechazado sí cuenta como no completado", () => {
    const { round, est } = readyScenario();
    const sheet = [
      ...Array.from({ length: 8 }, (_, i) => ({ folio: `#26112${i}-0001`, status: "Entregado" })),
      { folio: "#261199-0001", status: "Rechazado" },
      { folio: "#261198-0001", status: "Rechazado" },
    ];
    setActivity(est, "E07", "ok", { orderSheet: JSON.stringify(sheet) });
    setActivity(est, "E08", "ok", { rejectedFolio: "#261199-0001" });
    const v = computeVerdict(round);
    expect(v.orders).toMatchObject({ total: 9, completed: 8, intentional: 1 });
  });
});

describe("criterio 2: hallazgos críticos abiertos", () => {
  it("un crítico abierto (aunque sea de alguien que no terminó) impide el Sí", () => {
    const { round } = readyScenario();
    const quit = addRun({ guideId: "cliente", status: "in_progress" });
    addIssue(quit, "C05", { severity: "critico" });
    const v = computeVerdict(round);
    expect(v.openCritical).toBe(1);
    expect(crit(v, "hallazgos_criticos").pass).toBe(false);
    expect(v.ready).toBe(false);
  });

  it.each(["descartada", "externa", "no_es_falla", "duplicada", "corregida", "tester"])("un crítico con revisión «%s» ya no cuenta", (triage) => {
    const { round, cliente } = readyScenario();
    addIssue(cliente, "C05", { severity: "critico", triage });
    expect(computeVerdict(round).openCritical).toBe(0);
  });
});

describe("criterio 3: actividades que cumplen", () => {
  it("una actividad con falla ajena al desarrollo no cuenta para ese tester", () => {
    const { round, cliente } = readyScenario();
    setActivity(cliente, "C03", "fail");
    addIssue(cliente, "C03", { triage: "externa" });
    const v = computeVerdict(round);
    expect(v.population.externalActs).toBe(1);
    expect(v.activities.find((a) => a.id === "C03")!.executed).toBe(0);
  });

  it("con solo hallazgos bajos la actividad pasa con observaciones, pero no cuenta como «Todo salió bien»", () => {
    const { round, cliente } = readyScenario();
    setActivity(cliente, "C03", "fail");
    addIssue(cliente, "C03", { severity: "bajo" });
    const c03 = computeVerdict(round).guides.find((g) => g.guide.id === "cliente")!.cases.find((c) => c.id === "C03")!;
    expect(c03).toMatchObject({ passed: 1, passedWithNotes: 1, failed: 0, allOk: 0, meets: false });
  });

  it("regla de negocio: con pedidos ≥ 90 % y 0 críticos, una actividad que no cumple es informativa y el veredicto es Sí", () => {
    const { round, cliente } = readyScenario();
    setActivity(cliente, "C03", "fail");
    addIssue(cliente, "C03", { severity: "alto" });
    const v = computeVerdict(round);
    expect(crit(v, "actividades")).toMatchObject({ pass: false, informative: true });
    expect(v.override).toBe(BUSINESS_RULE.text);
    expect(v.ready).toBe(true);
  });

  it("la regla de negocio no aplica si los pedidos no llegan al 90 %", () => {
    const { round, cliente, est } = readyScenario();
    setActivity(cliente, "C03", "fail");
    addIssue(cliente, "C03", { severity: "alto" });
    setOrders(est, 8, 2);
    const v = computeVerdict(round);
    expect(crit(v, "actividades").informative).toBeUndefined();
    expect(v.override).toBeNull();
    expect(v.ready).toBe(false);
  });
});

describe("criterios por rol", () => {
  it("satisfacción: un SUS promedio menor a 68 impide el Sí", () => {
    const round = resetDb();
    addRun({ guideId: "cliente", umux: [3, 3] }); // SUS ≈ 33.7
    const est = addRun({ guideId: "establecimiento" });
    setOrders(est, 10, 0);
    const v = computeVerdict(round);
    const sat = v.guides.find((g) => g.guide.id === "cliente")!.criteria.find((c) => c.id === "satisfaccion")!;
    expect(sat.pass).toBe(false);
    expect(v.ready).toBe(false);
  });

  it("cobertura: si falta un caso crítico por ejecutar, no está listo", () => {
    const round = resetDb();
    addRun({ guideId: "cliente", okActivities: ["C01", "C02", "C03", "C04", "C06", "C07", "C08", "C09", "C10", "C11", "C12", "C13"] }); // sin C05
    const est = addRun({ guideId: "establecimiento" });
    setOrders(est, 10, 0);
    const v = computeVerdict(round);
    const cov = v.guides.find((g) => g.guide.id === "cliente")!.criteria.find((c) => c.id === "cobertura")!;
    expect(cov.pass).toBe(false);
    expect(cov.measured).toContain("C05");
  });

  it("el establecimiento junta panel web y app móvil en la misma muestra", () => {
    const round = resetDb();
    addRun({ guideId: "cliente" });
    const app = addRun({ guideId: "establecimiento-app" });
    setOrders(app, 10, 0);
    const v = computeVerdict(round);
    expect(v.participants.establecimientos).toBe(1);
    expect(v.guides.find((g) => g.guide.id === "establecimiento")!.finished).toBe(1);
    expect(v.ready).toBe(true);
  });
});

describe("repartidores", () => {
  it("su satisfacción es informativa: aunque sea baja no decide el veredicto", () => {
    const { round } = readyScenario();
    getDb()
      .prepare("INSERT INTO courier_feedback (id, token_hash, name, answers, created_at, updated_at, round_id) VALUES ('c1', 'x', 'Rep', ?, ?, ?, ?)")
      .run(JSON.stringify({ facil: 1, avisos: 1, general: 1 }), new Date().toISOString(), new Date().toISOString(), round);
    const v = computeVerdict(round);
    expect(v.courier.criterion?.informative).toBe(true);
    expect(v.ready).toBe(true);
  });
});
