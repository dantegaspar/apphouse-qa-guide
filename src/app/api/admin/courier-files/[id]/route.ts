import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getDb, UPLOAD_DIR } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { err } from "@/lib/http";
import { idError } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  const { id } = await params;
  if (idError(id)) return err("Archivo no encontrado", 404);
  const row = getDb().prepare("SELECT original_name, mime, path FROM courier_attachments WHERE id = ?").get(id) as
    | { original_name: string; mime: string; path: string }
    | undefined;
  if (!row) return err("Archivo no encontrado", 404);

  const root = path.resolve(/* turbopackIgnore: true */ UPLOAD_DIR);
  const abs = path.resolve(/* turbopackIgnore: true */ root, row.path);
  if (!abs.startsWith(root + path.sep)) return err("Ruta inválida", 400);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return err("Archivo no encontrado", 404);
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  const safeName = row.original_name.replace(/[^\w.\- ]+/g, "_") || "archivo";
  const headers: Record<string, string> = {
    "content-type": row.mime || "application/octet-stream",
    "content-length": String(stat.size),
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  const body = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream;
  return new Response(body, { headers });
}
