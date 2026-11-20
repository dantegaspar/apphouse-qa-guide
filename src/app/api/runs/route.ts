import crypto from "node:crypto";
import { getDb, now } from "@/lib/db";
import { getGuide } from "@/lib/guides";
import { sha256 } from "@/lib/auth";
import { cleanRecord, hasErrors, invalid, json, readJsonObject } from "@/lib/http";
import { TESTER_ROLES } from "@/lib/types";
import { collect, emailError, enumError, fieldsCheck, objectError, text, textError } from "@/lib/validate";

/**
 * Registra al tester y abre una corrida de la guía. Devuelve el token que el navegador guarda.
 *
 * Reglas: guideId obligatorio y de una guía conocida (404 si no existe); nombre 2–120; correo
 * válido (≤200); rol opcional de la lista (por omisión el de la guía); campos del tester según la
 * guía (obligatorios, tipo, pattern, maxLength; sin llaves desconocidas); device opcional: objeto
 * plano ≤30 datos, textos ≤500, ≤8 KB.
 */
export async function POST(req: Request) {
  const { body, res } = await readJsonObject(req, 32 * 1024);
  if (res) return res;

  const guideId = text(body.guideId);
  if (!guideId || guideId.length > 64) return invalid({ guideId: "Elige una guía." });
  const guide = getGuide(guideId);
  if (!guide) return invalid({ guideId: "La guía no existe." }, 404, "Guía no encontrada");

  const roles = Array.from(new Set([guide.role, ...TESTER_ROLES]));
  const role = text(body.role);
  const tester = fieldsCheck(body.fields, guide.tester.fields, "fields");
  const errors = {
    ...collect([
      ["name", textError(body.name, { min: 2, max: 120, required: true, label: "tu nombre y apellido" })],
      ["email", emailError(body.email, { required: true })],
      ["role", body.role === undefined || body.role === null || body.role === "" ? null : enumError(role, roles, { label: "tu rol" })],
      ["device", objectError(body.device, { maxKeys: 30, maxString: 500, maxBytes: 8 * 1024, label: "los datos del dispositivo" })],
    ]),
    ...tester.errors,
  };
  if (hasErrors(errors)) return invalid(errors);

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString("base64url");
  const ts = now();
  const device = { ...cleanRecord(body.device, 30, 500), ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "" };
  getDb()
    .prepare(
      `INSERT INTO runs (id, token_hash, guide_id, guide_version, name, email, role, tester_fields, device, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id, sha256(token), guide.id, guide.version, text(body.name), text(body.email).toLowerCase(), role || guide.role,
      JSON.stringify(tester.values), JSON.stringify(device), ts, ts
    );
  return json({ runId: id, token });
}
