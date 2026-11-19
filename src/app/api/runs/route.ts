import crypto from "node:crypto";
import { getDb, now } from "@/lib/db";
import { getGuide } from "@/lib/guides";
import { sha256 } from "@/lib/auth";
import { cleanRecord, err, json, str } from "@/lib/http";

/** Registra al tester y abre una corrida de la guía. Devuelve el token que el navegador guarda. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return err("JSON inválido");
  const guide = getGuide(str(body.guideId, 64));
  if (!guide) return err("Guía no encontrada", 404);
  const name = str(body.name, 120);
  const email = str(body.email, 200).toLowerCase();
  const role = str(body.role, 80) || guide.role;
  if (!name) return err("Falta el nombre");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Correo inválido");

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString("base64url");
  const ts = now();
  const device = { ...cleanRecord(body.device, 30, 500), ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "" };
  getDb()
    .prepare(
      `INSERT INTO runs (id, token_hash, guide_id, guide_version, name, email, role, tester_fields, device, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, sha256(token), guide.id, guide.version, name, email, role, JSON.stringify(cleanRecord(body.fields)), JSON.stringify(device), ts, ts);
  return json({ runId: id, token });
}
