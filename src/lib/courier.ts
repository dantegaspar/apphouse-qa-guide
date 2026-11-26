/** Encuesta para repartidores: preguntas, caritas y calificación 0–10 (compartido entre cliente y servidor). */

/**
 * `faces`: etiqueta de cada carita (1 = peor … 5 = mejor) que responde a lo que se pregunta.
 * `na`: la pregunta depende de haber tenido un pedido, así que admite «No me tocó» (se guarda como
 * COURIER_NA y no cuenta en los promedios).
 */
export type CourierQuestion = { id: string; label: string; short: string; faces: [string, string, string, string, string]; na?: boolean };

/** Valor guardado cuando el repartidor elige «No me tocó / No llegué a esta parte». */
export const COURIER_NA = "na";
export const COURIER_NA_LABEL = "No me tocó / No llegué a esta parte";
/** Respuesta guardada de una pregunta: carita 1–5 o «no aplica». */
export type CourierAnswer = number | typeof COURIER_NA;

const EASY: CourierQuestion["faces"] = ["Muy difícil", "Difícil", "Regular", "Fácil", "Muy fácil"];

/**
 * Preguntas en el orden en que el repartidor vive la prueba (avisos → camino → entrega → app → en general).
 * Los ids no cambian entre rondas: las respuestas viejas siguen contando igual en el panel y en el veredicto.
 */
export const COURIER_QUESTIONS: CourierQuestion[] = [
  {
    id: "avisos",
    label: "Cuando te asignaron un pedido, ¿te llegó el aviso al celular?",
    short: "Aviso de pedido",
    na: true,
    faces: ["Nunca", "Pocas veces", "A veces", "Casi siempre", "Siempre"],
  },
  {
    id: "direccion",
    label: "¿Qué tan fácil fue ver la dirección del cliente y llegar con el mapa?",
    short: "Dirección y mapa",
    faces: EASY,
    na: true,
  },
  {
    id: "entregado",
    label: "Al entregar, ¿qué tan fácil fue poner el código del cliente y marcar «Entregado»?",
    short: "Código y entregado",
    faces: EASY,
    na: true,
  },
  {
    id: "facil",
    label: "¿Qué tan fácil fue saber qué botón tocar en cada paso (aceptar, recoger, entregar)?",
    short: "Botones claros",
    faces: EASY,
  },
  {
    id: "rapida",
    label: "¿La app respondió rápido, sin trabarse ni cerrarse sola?",
    short: "Rápida, sin trabarse",
    faces: ["Muy lenta", "Lenta", "Regular", "Rápida", "Muy rápida"],
  },
  {
    id: "general",
    label: "En general, ¿qué tan contento quedaste con la app?",
    short: "Contento en general",
    faces: ["Nada contento", "Poco", "Regular", "Contento", "Muy contento"],
  },
];

/**
 * Calificación de 0 a 10 al final de la encuesta («¿la recomendarías?»). Se guarda en `answers` con
 * este id, pero NO es parte de COURIER_QUESTIONS: no entra al promedio de caritas ni al veredicto.
 */
export const COURIER_RATING = {
  id: "recomienda",
  label: "Del 0 al 10, ¿qué tanto le recomendarías esta app a otro repartidor?",
  short: "Recomendaría (0–10)",
  low: "Nada",
  high: "Muchísimo",
  min: 0,
  max: 10,
} as const;

/** Valor 1 (peor) a 5 (mejor). El dibujo de cada carita está en src/components/courier/FaceIcon.tsx. */
export const FACES = [
  { value: 1, label: "Muy mal" },
  { value: 2, label: "Mal" },
  { value: 3, label: "Regular" },
  { value: 4, label: "Bien" },
  { value: 5, label: "Muy bien" },
] as const;

/**
 * Código de error (409, `{ error, code }`) cuando la encuesta es de una ronda que ya no está activa:
 * ya no se edita ni se le agregan problemas o fotos.
 */
export const ROUND_CLOSED = "round_closed";
export const ROUND_CLOSED_MESSAGE = "Se abrió una nueva encuesta. Esta ya no se puede cambiar.";

/** Ids que genera el navegador para la encuesta, los problemas y las fotos. */
export const COURIER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Tipos de foto que acepta la encuesta (subconjunto de imágenes de ALLOWED_MIME). */
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

/** Tipo de una foto por su extensión, para cuando el navegador deja `File.type` vacío (algunos Android y HEIC). */
export function guessPhotoMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] ?? "";
}
