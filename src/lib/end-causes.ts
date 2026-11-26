/**
 * Motivos por los que un tester ya no puede seguir con la prueba (ventana «Terminar la prueba»).
 * Ya no se pide la contraseña del guía: el tester elige el motivo y sigue a la encuesta final.
 * Los de logística sacan la prueba del cálculo del veredicto como «Problema de logística».
 */
export const END_CAUSES = [
  { id: "falla_app", label: "Una falla de la app no me deja seguir" },
  { id: "sin_repartidor", label: "No hay repartidor asignado a mi pedido", logistics: true },
  { id: "repartidor_sin_contacto", label: "No puedo comunicarme con el repartidor (no contesta o aparece sin conexión)", logistics: true },
  { id: "ajeno", label: "Un problema ajeno a la app (internet, servidor, no llegó el correo)" },
  { id: "tiempo", label: "Se acabó el tiempo de la prueba" },
  { id: "otro", label: "Otro motivo" },
] as const;

export type EndCause = (typeof END_CAUSES)[number]["id"];

export const endCause = (id: string | null | undefined) => END_CAUSES.find((c) => c.id === id);
export const isLogisticsCause = (id: string | null | undefined) => !!(endCause(id) as { logistics?: boolean } | undefined)?.logistics;
