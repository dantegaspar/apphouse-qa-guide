import { describe, expect, it } from "vitest";
import { CALM_STEPS, ERROR_S, MESA_BASE_S, nextIntervalS, timeAgo } from "@/lib/mesa-shared";

describe("ritmo de consulta de la Mesa", () => {
  it("consulta cada 5 s mientras hay cambios", () => {
    expect(nextIntervalS({ calm: 0, fails: 0 })).toBe(MESA_BASE_S);
    expect(nextIntervalS({ calm: 5, fails: 0 })).toBe(5);
  });

  it("se espacia a 10 s y luego a 15 s cuando nada cambia", () => {
    expect(nextIntervalS({ calm: 6, fails: 0 })).toBe(10);
    expect(nextIntervalS({ calm: 17, fails: 0 })).toBe(10);
    expect(nextIntervalS({ calm: 18, fails: 0 })).toBe(15);
    expect(nextIntervalS({ calm: 500, fails: 0 })).toBe(Math.max(...CALM_STEPS.map((c) => c.s)));
  });

  it("si falla espera 5, 10, 20 y luego 30 s como máximo (aunque estuviera en calma)", () => {
    expect([1, 2, 3, 4, 5, 50].map((fails) => nextIntervalS({ calm: 20, fails }))).toEqual([5, 10, 20, 30, 30, 30]);
    expect(Math.max(...ERROR_S)).toBe(30);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-11-26T16:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  it.each([
    [0, "hace menos de 1 min"],
    [5, "hace 5 min"],
    [90, "hace 1 h 30 min"],
    [60 * 50, "hace 2 día(s)"],
  ])("%i min → %s", (min, text) => {
    expect(timeAgo(ago(min), now)).toBe(text);
  });
  it("una fecha futura no da tiempo negativo", () => {
    expect(timeAgo(ago(-10), now)).toBe("hace menos de 1 min");
  });
});
