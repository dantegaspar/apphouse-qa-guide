import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createRound } from "@/lib/rounds";
import { buildComparison, defaultPair, loadComparison, numbersIn, unverifiedNumbers } from "@/lib/comparativa";
import { addIssue, addRun, resetDb, setActivity, setOrders } from "./helpers/seed";

/** Dos encuestas: en la primera C03 falla a un cliente y hay pedidos fallados; en la segunda todo sale bien. */
function twoRounds(opts: { secondFails?: boolean; skipC03?: boolean } = {}) {
  const r1 = resetDb();
  const c1 = addRun({ guideId: "cliente", name: "Cliente 1" });
  setActivity(c1, "C03", "fail");
  const bug = addIssue(c1, "C03", { severity: "medio", triage: "confirmada" });
  addIssue(c1, "C05", { severity: "bajo", triage: "tester" }); // reclasificado: no es bug del desarrollo
  const e1 = addRun({ guideId: "establecimiento", name: "Est 1" });
  setOrders(e1, 6, 4);
  const r2 = createRound().id;
  const c2 = addRun({ guideId: "cliente", name: "Cliente 2", ...(opts.skipC03 ? { okActivities: [] } : {}) });
  let bug2: string | null = null;
  if (opts.secondFails) {
    setActivity(c2, "C03", "fail");
    bug2 = addIssue(c2, "C03", { severity: "medio", triage: "confirmada" });
  }
  const e2 = addRun({ guideId: "establecimiento", name: "Est 2" });
  setOrders(e2, 10, 0);
  return { r1, r2, bug, bug2 };
}

describe("comparativa entre encuestas", () => {
  it("la encuesta anterior por omisión es la que está antes de la vista", () => {
    const { r1, r2 } = twoRounds();
    expect(defaultPair(r2)).toEqual({ base: r1, current: r2 });
    expect(defaultPair(r1).base).toBeNull();
  });

  it("calcula en código qué mejoró: pedidos, tarea y veredicto", () => {
    const { r1, r2 } = twoRounds();
    const f = buildComparison(r1, r2);
    const pedidos = f.metrics.find((m) => m.id === "pedidos")!;
    expect(pedidos.before).toBe("60 % (6 de 10)");
    expect(pedidos.after).toBe("100 % (10 de 10)");
    expect(pedidos.delta).toBe("+40 puntos");
    expect(pedidos.trend).toBe("mejoro");
    const c03 = f.activities.find((a) => a.id === "C03")!;
    expect(c03.trend).toBe("mejoro");
    expect(c03.deltaPts).toBe(100);
    expect(c03.fewPeople).toBe(true);
    expect(c03.sentence).not.toMatch(/C03/); // lenguaje llano, sin códigos
    expect(f.verdict).toEqual({ before: false, after: true });
  });

  it("un bug de la encuesta pasada que no se repitió cuenta como solucionado; los reclasificados no cuentan", () => {
    const { r1, r2, bug } = twoRounds();
    const f = buildComparison(r1, r2);
    expect(f.bugCounts).toEqual({ previous: 1, solved: 1, persist: 0, unverified: 0, new: 0 });
    expect(f.prevBugs[0].id).toBe(bug);
    expect(f.prevBugs[0].status).toBe("no_se_repitio");
    expect(f.prevBugs[0].retestedBy).toBe(1);
  });

  it("si nadie volvió a hacer la tarea, el bug queda sin verificar", () => {
    const { r1, r2 } = twoRounds({ skipC03: true });
    expect(buildComparison(r1, r2).prevBugs[0].status).toBe("sin_verificar");
  });

  it("sin Claude se compara por tarea; con el emparejamiento de Claude solo persiste lo que Claude dice", () => {
    const { r1, r2, bug, bug2 } = twoRounds({ secondFails: true });
    const porTarea = buildComparison(r1, r2);
    expect(porTarea.matchedBy).toBe("tarea");
    expect(porTarea.prevBugs[0].status).toBe("persiste");
    expect(porTarea.bugCounts.new).toBe(0);
    expect(porTarea.activities.find((a) => a.id === "C03")!.trend).toBe("igual");

    // Claude dice que el reporte nuevo es otro problema: el viejo no se repitió y el nuevo es nuevo.
    const otro = buildComparison(r1, r2, [{ anterior: bug, actuales: [], motivo: "Otra falla" }]);
    expect(otro.prevBugs[0].status).toBe("no_se_repitio");
    expect(otro.bugCounts).toMatchObject({ solved: 1, persist: 0, new: 1 });

    // Ids inventados se ignoran.
    const inventado = buildComparison(r1, r2, [{ anterior: bug, actuales: ["no-existe"], motivo: "x" }]);
    expect(inventado.prevBugs[0].sameAs).toEqual([]);

    const mismo = buildComparison(r1, r2, [{ anterior: bug, actuales: [bug2!], motivo: "Misma falla" }]);
    expect(mismo.prevBugs[0]).toMatchObject({ status: "persiste", sameAs: [bug2] });
  });

  it("la redacción guardada queda vieja cuando cambian los datos", () => {
    const { r1, r2 } = twoRounds();
    const { facts } = loadComparison(r1, r2);
    getDb()
      .prepare("INSERT INTO claude_comparativa (created_at, model, base_round, current_round, facts_hash, narrative) VALUES (?, 'm', ?, ?, ?, ?)")
      .run(new Date().toISOString(), r1, r2, facts.hash, JSON.stringify({ resumen: "ok", puntosClave: [], recomendaciones: [], notaSistemas: "" }));
    expect(loadComparison(r1, r2).stale).toBe(false);
    const c = addRun({ guideId: "cliente", name: "Otro" });
    setActivity(c, "C04", "fail");
    expect(loadComparison(r1, r2).stale).toBe(true);
  });

  it("avisa de cifras en el texto de Claude que no salen del cálculo", () => {
    expect(numbersIn("antes 60 %, ahora 9 de 10")).toEqual(["60", "9", "10"]);
    const data = { pedidos: "60 % (6 de 10)" };
    expect(unverifiedNumbers(["Los pedidos pasaron de 60 % a 6 de 10."], data)).toEqual([]);
    expect(unverifiedNumbers(["Mejoró 37 %."], data)).toEqual(["37"]);
  });
});
