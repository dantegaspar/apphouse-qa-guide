export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Evita inyección de fórmulas al abrir en Excel/Sheets
    const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // BOM para que Excel respete los acentos
  return "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
