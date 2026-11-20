/** Encuesta para repartidores: preguntas y caritas (compartido entre cliente y servidor). */

export type CourierQuestion = { id: string; label: string; short: string };

export const COURIER_QUESTIONS: CourierQuestion[] = [
  { id: "facil", label: "¿Qué tan fácil fue usar la app?", short: "Fácil de usar" },
  { id: "avisos", label: "¿Te llegaron bien los avisos de pedidos nuevos?", short: "Avisos de pedidos" },
  { id: "direccion", label: "¿Fue fácil encontrar la dirección y llegar?", short: "Encontrar la dirección" },
  { id: "entregado", label: "¿Fue fácil marcar el pedido como entregado?", short: "Marcar entregado" },
  { id: "rapida", label: "¿La app funcionó rápido y sin trabarse?", short: "Rápida, sin trabarse" },
  { id: "general", label: "¿Qué tan contento estás con la app en general?", short: "Contento en general" },
];

/** Valor 1 (peor) a 5 (mejor). */
export const FACES = [
  { value: 1, emoji: "😡", label: "Muy mal" },
  { value: 2, emoji: "😕", label: "Mal" },
  { value: 3, emoji: "😐", label: "Regular" },
  { value: 4, emoji: "🙂", label: "Bien" },
  { value: 5, emoji: "😍", label: "Muy bien" },
] as const;

export const faceOf = (v: number | null | undefined) => (v ? FACES.find((f) => f.value === Math.round(v)) : undefined);

/** Ids que genera el navegador para la encuesta, los problemas y las fotos. */
export const COURIER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Tipos de foto que acepta la encuesta (subconjunto de imágenes de ALLOWED_MIME). */
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
