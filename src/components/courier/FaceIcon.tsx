import { Angry, Frown, Laugh, Meh, Smile, type LucideProps } from "lucide-react";

/**
 * Caritas de la encuesta de repartidores como iconos SVG (lucide-react) en lugar de emojis:
 * se ven igual en todos los celulares y toman el color de la escala.
 */
const ICONS = [Angry, Frown, Meh, Smile, Laugh] as const;

/** Color de cada carita, de 1 (rojo) a 5 (verde). Clases de Tailwind para el trazo. */
export const FACE_TONES = ["text-rose-600", "text-orange-500", "text-amber-500", "text-lime-600", "text-emerald-600"] as const;

/** Carita del valor 1–5 (se redondea; un promedio 3.6 muestra la carita 4). Sin valor: nada. */
export function FaceIcon({ value, colored = true, className = "", ...rest }: { value: number | null | undefined; colored?: boolean } & LucideProps) {
  if (!value) return null;
  const i = Math.min(5, Math.max(1, Math.round(value))) - 1;
  const Icon = ICONS[i];
  return <Icon aria-hidden strokeWidth={2} className={`inline-block shrink-0 ${colored ? FACE_TONES[i] : ""} ${className}`} {...rest} />;
}
