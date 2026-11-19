import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminConfigured, checkPassword, makeSessionValue } from "@/lib/auth";
import { err, json } from "@/lib/http";

export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_FAILS = 10;
const fails = new Map<string, number[]>();

export async function POST(req: Request) {
  if (!adminConfigured()) return err("ADMIN_PASSWORD no está configurada en el servidor", 503);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const t = Date.now();
  const recent = (fails.get(ip) ?? []).filter((x) => t - x < WINDOW_MS);
  if (recent.length >= MAX_FAILS) return err("Demasiados intentos. Espera un minuto.", 429);

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!checkPassword(password)) {
    recent.push(t);
    fails.set(ip, recent);
    await new Promise((r) => setTimeout(r, 1000));
    return err("Contraseña incorrecta", 401);
  }
  fails.delete(ip);
  const { value, maxAge } = makeSessionValue();
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
  (await cookies()).set(ADMIN_COOKIE, value, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge });
  return json({ ok: true });
}
