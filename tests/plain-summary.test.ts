import { describe, expect, it } from "vitest";
import { computeVerdict } from "@/lib/verdict";
import { buildPlainSummary, PLAIN_TASK } from "@/lib/plain-summary";
import { getGuide } from "@/lib/guides";
import { addIssue, addRun, readyScenario, resetDb, setActivity, setOrders } from "./helpers/seed";

/** Ningún texto del resumen ejecutivo debe llevar códigos de actividad (C08, E04-A…). */
const CODE = /\b[CE]\d{2}(-[A-D])?\b/;
const allText = (s: ReturnType<typeof buildPlainSummary>) =>
  [s.headline, s.why, ...s.moreReasons, ...s.figures.flatMap((f) => [f.label, f.value, f.detail]), ...s.problems.map((p) => p.task), s.notCounted ?? ""].join(" ");

describe("resumen ejecutivo en lenguaje llano", () => {
  it("todas las actividades de las guías tienen nombre llano", () => {
    for (const id of ["cliente", "establecimiento", "establecimiento-app"]) {
      for (const a of getGuide(id)!.activities) expect(PLAIN_TASK[a.id], a.id).toBeTruthy();
    }
  });

  it("con todo en orden dice Sí y el porqué con los pedidos", () => {
    const { round } = readyScenario();
    const s = buildPlainSummary(computeVerdict(round));
    expect(s.ready).toBe(true);
    expect(s.headline).toMatch(/^Sí/);
    expect(s.why).toContain("10 de 10 pedidos");
    expect(s.problems).toHaveLength(0);
    expect(allText(s)).not.toMatch(CODE);
  });

  it("sin pruebas completas no da veredicto", () => {
    const round = resetDb();
    const s = buildPlainSummary(computeVerdict(round));
    expect(s.ready).toBeNull();
    expect(s.why).toBe("Todavía no hay pruebas registradas.");
  });

  it("un hallazgo crítico abierto: No, explicado sin códigos, con a quién y a cuántos", () => {
    const { round, cliente } = readyScenario();
    addRun({ guideId: "cliente", name: "Cliente 2" });
    setActivity(cliente, "C08", "fail");
    addIssue(cliente, "C08", { severity: "critico", triage: "confirmada" });
    const v = computeVerdict(round);
    const s = buildPlainSummary(v, ["El botón de entregar no respondía."]);
    expect(v.ready).toBe(false);
    expect(s.ready).toBe(false);
    expect(s.why).toBe("Queda 1 problema grave sin resolver, de los que pueden perder pedidos o dinero.");
    const p = s.problems[0];
    expect(p).toMatchObject({ audience: "clientes", task: PLAIN_TASK.C08, affected: 1, of: 2, severity: "critico" });
    expect(s.courier.issues).toEqual(["El botón de entregar no respondía."]);
    expect(allText(s)).not.toMatch(CODE);
  });

  it("pedidos por debajo de la meta se explican con números", () => {
    const { round, est } = readyScenario();
    setOrders(est, 8, 2);
    const s = buildPlainSummary(computeVerdict(round));
    expect(s.ready).toBe(false);
    expect([s.why, ...s.moreReasons].join(" ")).toContain("Solo 8 de 10 pedidos de prueba (80 %)");
    expect(s.figures.find((f) => f.id === "pedidos")).toMatchObject({ value: "80 %", tone: "bad" });
  });

  it("la opinión (rapidez, fluidez, satisfacción, si la usarían) se muestra en llano y no cambia el resultado", () => {
    const { round } = readyScenario();
    const before = computeVerdict(round);
    addRun({ guideId: "cliente", name: "Cliente lento", umux: [7, 7], answers: { rapidez: 1, fluidez: 1, satisfaccion: 1, facilidad: 1, recomienda: 0, adopcion: "No" } });
    addRun({ guideId: "cliente", name: "Cliente rápido", umux: [7, 7], answers: { rapidez: 4, fluidez: 5, satisfaccion: 5, facilidad: 5, recomienda: 10, adopcion: "Sí" } });
    addRun({ guideId: "establecimiento", name: "Est. opinión", answers: { rapidez: 2, fluidez: 3, satisfaccion: 4, seguirPedidos: 5, configurar: 4, adopcion: "Tal vez" } });
    const v = computeVerdict(round);
    expect(v.ready).toBe(before.ready);
    expect(v.criteria.map((c) => [c.id, c.pass])).toEqual(before.criteria.map((c) => [c.id, c.pass]));
    const s = buildPlainSummary(v, [], { n: 2, avg: 4.5 });
    const cli = s.opinion.find((r) => r.audience === "clientes")!;
    expect(cli.speed.find((i) => i.id === "rapidez")).toMatchObject({ avg: 2.5, n: 2, word: "Regular", max: 5 });
    expect(cli.speed.find((i) => i.id === "fluidez")).toMatchObject({ avg: 3, word: "Regular" });
    expect(cli.general.find((i) => i.id === "recomienda")).toMatchObject({ avg: 5, max: 10 });
    expect(cli.adopcion).toEqual({ si: 1, talvez: 0, no: 1, n: 2 });
    const est = s.opinion.find((r) => r.audience === "establecimientos")!;
    expect(est.speed.find((i) => i.id === "rapidez")).toMatchObject({ avg: 2, word: "Lento", tone: "bad" });
    expect(est.general.map((i) => i.id)).toEqual(["satisfaccion", "seguirPedidos", "configurar"]);
    expect(s.opinion.find((r) => r.audience === "repartidores")!.speed[0]).toMatchObject({ word: "Muy rápido", n: 2 });
  });

  it("las preguntas nuevas existen en las tres encuestas", () => {
    for (const id of ["cliente", "establecimiento", "establecimiento-app"]) {
      const ids = getGuide(id)!.survey.questions.map((q) => q.id);
      for (const q of ["rapidez", "fluidez", "satisfaccion", "adopcion"]) expect(ids, `${id}:${q}`).toContain(q);
    }
  });
});
