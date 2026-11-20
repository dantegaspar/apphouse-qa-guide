import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";

export const ADMIN_COOKIE = "qa_admin";
const SESSION_HOURS = 12;

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function secret() {
  const pw = process.env.ADMIN_PASSWORD || "";
  return process.env.SESSION_SECRET || sha256("qa-guide:" + pw);
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function checkPassword(input: string) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  const a = Buffer.from(sha256(input));
  const b = Buffer.from(sha256(pw));
  return crypto.timingSafeEqual(a, b);
}

/** Contraseña del guía de la prueba (GUIDE_PASSWORD; si no está, se usa ADMIN_PASSWORD). */
function guidePassword() {
  return process.env.GUIDE_PASSWORD || process.env.ADMIN_PASSWORD || "";
}

export function guidePasswordConfigured() {
  return Boolean(guidePassword());
}

export function checkGuidePassword(input: string) {
  const pw = guidePassword();
  if (!pw) return false;
  const a = Buffer.from(sha256(input));
  const b = Buffer.from(sha256(pw));
  return crypto.timingSafeEqual(a, b);
}

/** Limita intentos fallidos por clave (IP) dentro de una ventana de tiempo. En memoria. */
export function createFailThrottle(windowMs: number, maxFails: number) {
  const fails = new Map<string, number[]>();
  const recent = (key: string) => (fails.get(key) ?? []).filter((x) => Date.now() - x < windowMs);
  return {
    isBlocked: (key: string) => recent(key).length >= maxFails,
    fail: (key: string) => {
      const r = recent(key);
      r.push(Date.now());
      fails.set(key, r);
    },
    reset: (key: string) => {
      fails.delete(key);
    },
  };
}

export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

export function makeSessionValue() {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const sig = crypto.createHmac("sha256", secret()).update(`admin:${exp}`).digest("hex");
  return { value: `${exp}.${sig}`, maxAge: SESSION_HOURS * 3600 };
}

export function verifySessionValue(v: string | undefined) {
  if (!v || !adminConfigured()) return false;
  const [expStr, sig] = v.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update(`admin:${exp}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function isAdmin() {
  const jar = await cookies();
  return verifySessionValue(jar.get(ADMIN_COOKIE)?.value);
}

/** Valida el token del tester (cabecera x-run-token) contra la corrida. */
export function checkRunToken(runId: string, token: string | null) {
  if (!token) return false;
  const row = getDb().prepare("SELECT token_hash FROM runs WHERE id = ?").get(runId) as
    | { token_hash: string }
    | undefined;
  if (!row) return false;
  const a = Buffer.from(row.token_hash);
  const b = Buffer.from(sha256(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
