#!/usr/bin/env node
/**
 * Simula testers que contestan la prueba de ESTABLECIMIENTOS (panel web, o la app con --variante app)
 * para probar la Mesa de control.
 *
 *   node scripts/simular-establecimientos.mjs                     # 4 testers contra http://localhost:3000
 *   node scripts/simular-establecimientos.mjs --variante app --testers 2
 *   ADMIN_PASSWORD=… node scripts/simular-establecimientos.mjs --nueva-encuesta "Prueba de Mesa"
 *   node scripts/simular-establecimientos.mjs --ayuda
 *
 * Correos qa+establecimiento-…@example.com. Ver scripts/simulador/README.md.
 */
import { correr, encuestaBase, leerOpciones, NOMBRES, sello } from "./simulador/comun.mjs";

const FALLAS = [
  { act: "E02", step: "5", severity: "medio", description: "Al guardar el horario salió «Error 500»; a la segunda sí se guardó.", expected: "Que se guarde a la primera." },
  { act: "E04-B", step: "B5", severity: "bajo", foto: true, description: "La vista previa de la promoción 2x1 muestra el precio completo.", expected: "Ver el precio con el 2x1." },
  { act: "E07", step: "4", severity: "medio", foto: true, order: true, description: "Toqué «Marcar listo» y no pasó nada; al recargar el pedido seguía en preparación.", expected: "Que pase a «Listo para recoger»." },
  { act: "E10", step: "2", severity: "medio", order: true, description: "El pedido estuvo 20 minutos en «Buscando repartidor».", expected: "Asignación en menos de 5 minutos." },
];
const AYUDA = { act: "E05", step: "2", description: "Al tocar «Abrir sucursal» sale «No se pudo conectar con el servidor» y sigue cerrada. No puedo seguir.", expected: "Que la sucursal abra." };

const MEJORAS = ["Que el botón de listo avise si se guardó.", "Avisar cuando no hay repartidores conectados.", "Todo claro.", "Un sonido más fuerte para pedidos nuevos."];
const SUCURSALES = ["Sim Centro", "Sim Norte", "Sim Sur", "Sim Oriente", "Sim Poniente", "Sim Valle"];

const o = leerOpciones();
const app = o.variante === "app";
if (o.variante && !app) {
  console.error("--variante solo acepta «app».");
  process.exit(1);
}
const s = sello();
await correr(o, (i, escenario) => {
  const nombre = `${NOMBRES[(i + 5) % NOMBRES.length]} Sim ${s}-${i + 1}`;
  const email = `qa+establecimiento-${s}-${i + 1}@example.com`;
  const branch = SUCURSALES[i % SUCURSALES.length];
  const fields = app
    ? { branch, appEmail: email, device: i % 2 ? "iPhone 13" : "Samsung A54", system: i % 2 ? "iPhone" : "Android" }
    : { branch, panelEmail: email, device: i % 2 ? "Laptop" : "iPad", browser: i % 2 ? "Chrome" : "Safari" };
  const ua = app || i % 2 === 0
    ? "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
  return {
    guideId: app ? "establecimiento-app" : "establecimiento",
    escenario,
    tester: { name: nombre, email, fields, device: { userAgent: ua, screen: "1180x820", lang: "es-MX", simulado: "sí" } },
    fallas: escenario === "ayuda" || escenario === "bloqueo" ? [AYUDA] : FALLAS,
    encuesta: (g, e) => encuestaBase(g, e, MEJORAS),
  };
});
