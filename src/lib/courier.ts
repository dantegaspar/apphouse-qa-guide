/** Encuesta para repartidores: preguntas y caritas (compartido entre cliente y servidor). */

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

export const COURIER_QUESTIONS: CourierQuestion[] = [
  { id: "facil", label: "¿Qué tan fácil fue usar la app?", short: "Fácil de usar", faces: EASY },
  {
    id: "avisos",
    label: "¿Te llegaron bien los avisos de pedidos nuevos?",
    short: "Avisos de pedidos",
    na: true,
    faces: ["Nunca", "Pocas veces", "A veces", "Casi siempre", "Siempre"],
  },
  { id: "direccion", label: "¿Fue fácil encontrar la dirección y llegar?", short: "Encontrar la dirección", faces: EASY, na: true },
  { id: "entregado", label: "¿Fue fácil marcar el pedido como entregado?", short: "Marcar entregado", faces: EASY, na: true },
  {
    id: "rapida",
    label: "¿La app funcionó rápido y sin trabarse?",
    short: "Rápida, sin trabarse",
    faces: ["Muy lenta", "Lenta", "Regular", "Rápida", "Muy rápida"],
  },
  {
    id: "general",
    label: "¿Qué tan contento estás con la app en general?",
    short: "Contento en general",
    faces: ["Nada contento", "Poco", "Regular", "Contento", "Muy contento"],
  },
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
