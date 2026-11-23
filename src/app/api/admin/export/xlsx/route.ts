import ExcelJS from "exceljs";
import { isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { err, invalid } from "@/lib/http";
import { GUIDES } from "@/lib/guides";
import { idError } from "@/lib/validate";
import { buildExport, DATE_HEADERS, requestOrigin, type ExportKind } from "@/lib/export-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHEETS: { kind: ExportKind; name: string }[] = [
  { kind: "verdict", name: "Veredicto" },
  { kind: "cases", name: "Casos" },
  { kind: "insights", name: "Resumen" },
  { kind: "runs", name: "Pruebas" },
  { kind: "steps", name: "Pasos" },
  { kind: "activities", name: "Actividades" },
  { kind: "issues", name: "Fallas" },
  { kind: "survey", name: "Encuesta" },
  { kind: "help", name: "Ayuda" },
  { kind: "courier", name: "Repartidores" },
  { kind: "courier_issues", name: "Repartidores - fallas" },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const EXCEL_MAX_CELL = 32767;

export async function GET(req: Request) {
  if (!(await isAdmin())) return err("No autorizado", 401);

  // ?guide= opcional y de una guía conocida
  const guideId = new URL(req.url).searchParams.get("guide") || null;
  const guideErr = idError(guideId, { known: GUIDES.map((g) => g.id), required: false, label: "la guía" });
  if (guideErr) return invalid({ guide: guideErr });
  const origin = requestOrigin(req);
  const hasHelp = !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='help_requests'").get();

  const wb = new ExcelJS.Workbook();
  wb.creator = "AppHouse QA";
  wb.created = new Date();

  for (const { kind, name } of SHEETS) {
    if (kind === "help" && !hasHelp) continue;
    const { headers, rows } = buildExport(kind, origin, guideId);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    const dateCols = new Set(headers.flatMap((h, i) => (DATE_HEADERS.has(h) ? [i] : [])));

    ws.addRow(headers);
    for (const r of rows) {
      ws.addRow(
        r.map((v, i) => {
          if (v === null || v === undefined || v === "") return null;
          if (typeof v === "string") {
            if (dateCols.has(i) && ISO_DATE.test(v)) return new Date(v);
            // exceljs escribe strings como texto (nunca fórmula)
            return v.length > EXCEL_MAX_CELL ? v.slice(0, EXCEL_MAX_CELL) : v;
          }
          return v;
        }),
      );
    }

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
    headers.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      if (dateCols.has(i)) col.numFmt = "yyyy-mm-dd hh:mm";
      let max = h.length;
      for (const r of rows.slice(0, 200)) {
        const v = r[i];
        const len = v == null ? 0 : Math.max(...String(v).split("\n").map((l) => l.length));
        if (len > max) max = len;
      }
      col.width = dateCols.has(i) ? 18 : Math.min(60, Math.max(10, max + 2));
      if (!dateCols.has(i)) col.alignment = { vertical: "top", wrapText: true };
    });
    ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, headers.length) } };
  }

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="apphouse-qa-${date}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
