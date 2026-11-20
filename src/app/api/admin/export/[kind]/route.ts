import { isAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { err } from "@/lib/http";
import { buildExport, EXPORT_KINDS, requestOrigin, type ExportKind } from "@/lib/export-rows";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await isAdmin())) return err("No autorizado", 401);
  const { kind } = await params;
  if (!EXPORT_KINDS.includes(kind as ExportKind)) return err("Tipo de exportación desconocido", 404);

  const guideId = new URL(req.url).searchParams.get("guide");
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
