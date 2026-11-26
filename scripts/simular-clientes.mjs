#!/usr/bin/env node
/**
 * Simula testers que contestan la prueba de CLIENTES (guía «cliente») para probar la Mesa de control.
 *
 *   node scripts/simular-clientes.mjs                       # 4 testers contra http://localhost:3000
 *   node scripts/simular-clientes.mjs --testers 6 --ritmo 10
 *   ADMIN_PASSWORD=… node scripts/simular-clientes.mjs --nueva-encuesta "Prueba de Mesa"
 *   node scripts/simular-clientes.mjs --ayuda
 *
 * Correos qa+cliente-…@example.com. Ver scripts/simulador/README.md.
 */
import { correr, encuestaBase, leerOpciones, NOMBRES, sello } from "./simulador/comun.mjs";

const FALLAS = [
  { act: "C03", step: "2", severity: "medio", foto: true, description: "La Hawaiana mediana con orilla rellena sale en $180 y no en $156.", expected: "Ver $156." },
  { act: "C05", step: "3", severity: "medio", description: "El total del carrito no suma el envío; en el pago sí aparece.", expected: "El mismo total en carrito y pago." },
  { act: "C08", step: "3", severity: "medio", foto: true, order: true, description: "El repartidor se asignó, pero no se movió en el mapa durante 10 minutos.", expected: "Ver el avance del repartidor." },
  { act: "C12", step: "2", severity: "bajo", foto: true, description: "En el detalle del pedido el nombre largo de la pizza se corta y tapa el precio.", expected: "Que se lea completo." },
];
const AYUDA = { act: "C06", step: "3", description: "Al tocar «Pagar» la app se queda cargando y luego dice «Error del servidor». No puedo seguir.", expected: "Que se confirme el pago." };

const MEJORAS = ["Que el mapa del repartidor se mueva en tiempo real.", "Mostrar el envío desde el carrito.", "Todo fue claro.", "Avisar cuando no hay repartidores."];
const DISPOSITIVOS = [
  ["Samsung A14", "Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"],
  ["iPhone 13", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"],
  ["Motorola G54", "Mozilla/5.0 (Linux; Android 14; moto g54) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"],
];

const o = leerOpciones();
const s = sello();
await correr(o, (i, escenario) => {
  const nombre = `${NOMBRES[i % NOMBRES.length]} Sim ${s}-${i + 1}`;
  const email = `qa+cliente-${s}-${i + 1}@example.com`;
  const [device, ua] = DISPOSITIVOS[i % DISPOSITIVOS.length];
  return {
    guideId: "cliente",
    escenario,
    tester: { name: nombre, email, fields: { device, appEmail: email }, device: { userAgent: ua, screen: "390x844", lang: "es-MX", simulado: "sí" } },
    fallas: escenario === "ayuda" || escenario === "bloqueo" ? [AYUDA] : FALLAS,
    encuesta: (g, e) => encuestaBase(g, e, MEJORAS),
  };
});
