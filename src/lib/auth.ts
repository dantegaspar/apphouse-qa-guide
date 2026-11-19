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
