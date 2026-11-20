import { isAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { err, invalid } from "@/lib/http";
import { GUIDES } from "@/lib/guides";
import { idError } from "@/lib/validate";
import { buildExport, EXPORT_KINDS, requestOrigin, type ExportKind } from "@/lib/export-rows";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  const { kind } = await params;
  // Reglas: kind de EXPORT_KINDS (404 si no); ?guide= opcional y de una guía conocida (400 si no)
  if (!EXPORT_KINDS.includes(kind as ExportKind)) return invalid({ kind: "Tipo de exportación desconocido." }, 404, "Tipo de exportación desconocido");

  const guideId = new URL(req.url).searchParams.get("guide") || null;
  const guideErr = idError(guideId, { known: GUIDES.map((g) => g.id), required: false, label: "la guía" });
  if (guideErr) return invalid({ guide: guideErr });
  const { headers, rows } = buildExport(kind as ExportKind, requestOrigin(req), guideId);

  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="apphouse-qa-${kind}-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
