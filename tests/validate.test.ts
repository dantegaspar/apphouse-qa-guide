import { describe, expect, it } from "vitest";
import { courierAnswerError, courierRatingError, emailError, fieldDefError, parseOrders, surveyAnswerError, textError } from "@/lib/validate";
import type { FieldDef, SurveyQuestion } from "@/lib/types";

describe("datos del tester", () => {
  it("nombre: obligatorio, con mínimo y máximo de letras", () => {
    const opts = { min: 2, max: 10, required: true, label: "tu nombre" };
    expect(textError("", opts)).toBe("Escribe tu nombre.");
    expect(textError(" A ", opts)).toMatch(/al menos 2 letras/);
    expect(textError("Ana", opts)).toBeNull();
    expect(textError("Nombre muy largo", opts)).toMatch(/máximo 10 caracteres/);
  });

  it("correo: acepta nombre@dominio y rechaza lo demás", () => {
    expect(emailError("ana@example.com", { required: true })).toBeNull();
    expect(emailError("ana@", { required: true })).toMatch(/nombre@correo\.com/);
    expect(emailError("", { required: true })).toBe("Escribe tu correo.");
    expect(emailError("")).toBeNull();
  });
});

describe("hoja de pedidos", () => {
  const def = { id: "orderSheet", label: "Hoja de pedidos", type: "orders", required: true } as FieldDef;

  it("acepta un arreglo o el JSON de un arreglo", () => {
    expect(parseOrders([{ folio: "1" }])).toHaveLength(1);
    expect(parseOrders('[{"folio":"1"}]')).toHaveLength(1);
    expect(parseOrders("no es json")).toBeNull();
    expect(parseOrders('{"folio":"1"}')).toBeNull();
  });

  it("exige al menos un pedido con folio y estados de la lista", () => {
    expect(fieldDefError(def, [{ folio: "#261126-0001", status: "Entregado" }])).toBeNull();
    expect(fieldDefError(def, [{ folio: "", status: "Entregado" }])).toMatch(/al menos un pedido con su folio/);
    expect(fieldDefError(def, [{ folio: "1", status: "Perdido" }])).toMatch(/elige el estado/);
    expect(fieldDefError(def, [{ folio: "1", otro: "x" }])).toMatch(/dato desconocido/);
  });
});

describe("encuesta final", () => {
  const scale = { id: "umux1", type: "scale", label: "x", min: 1, max: 7, required: true } as SurveyQuestion;
  const choice = { id: "logistica", type: "choice", label: "x", options: ["Sí", "No"], required: true } as SurveyQuestion;

  it("escala: dentro del rango", () => {
    expect(surveyAnswerError(scale, 7)).toBeNull();
    expect(surveyAnswerError(scale, 8)).not.toBeNull();
    expect(surveyAnswerError(scale, "")).toBe("Contesta esta pregunta.");
    expect(surveyAnswerError(scale, "", { partial: true })).toBeNull();
  });

  it("opción: solo de la lista", () => {
    expect(surveyAnswerError(choice, "Sí")).toBeNull();
    expect(surveyAnswerError(choice, "Tal vez")).toBe("Elige una de las opciones.");
  });
});

describe("encuesta de repartidores", () => {
  it("caritas 1–5 y «No me tocó» solo donde se permite", () => {
    expect(courierAnswerError(3)).toBeNull();
    expect(courierAnswerError(0)).toBe("Toca una carita.");
    expect(courierAnswerError("na")).toBe("Toca una carita.");
    expect(courierAnswerError("na", true)).toBeNull();
  });

  it("calificación: entero del 0 al 10, obligatoria", () => {
    expect(courierRatingError(0)).toBeNull();
    expect(courierRatingError(10)).toBeNull();
    expect(courierRatingError(11)).toMatch(/0 al 10/);
    expect(courierRatingError(7.5)).toMatch(/0 al 10/);
    expect(courierRatingError(undefined)).toMatch(/0 al 10/);
  });
});
