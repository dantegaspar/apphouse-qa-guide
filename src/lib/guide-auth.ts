import { checkGuidePassword, clientIp, createFailThrottle, guidePasswordConfigured } from "./auth";
import { err } from "./http";

const g = globalThis as unknown as { __guideThrottle?: ReturnType<typeof createFailThrottle> };
/** Compartido entre rutas: 8 intentos fallidos por minuto por IP. */
const throttle = (g.__guideThrottle ??= createFailThrottle(60_000, 8));

/**
 * Verifica la contraseña del guía (solo en el servidor). Devuelve una respuesta de error,
 * o null si la contraseña es correcta.
 */
export async function verifyGuidePassword(req: Request, password: unknown) {
  if (!guidePasswordConfigured()) return err("La contraseña del guía no está configurada en el servidor", 503);
  const ip = clientIp(req);
  if (throttle.isBlocked(ip)) return err("Demasiados intentos. Espera un minuto.", 429);
  if (!checkGuidePassword(typeof password === "string" ? password : "")) {
    throttle.fail(ip);
    await new Promise((r) => setTimeout(r, 800));
    return err("Contraseña del guía incorrecta", 401);
  }
  throttle.reset(ip);
  return null;
}
