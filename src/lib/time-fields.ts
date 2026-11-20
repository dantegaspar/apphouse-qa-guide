/**
 * Horas, rangos de horas, «folio · hora» y días de la semana de los campos de la guía.
 * Sin dependencias: lo usan los selectores del tester (pickers.tsx), la validación del navegador
 * (validation.ts) y la del servidor (validate.ts), para que las reglas sean las mismas.
 *
 * Formatos que se guardan (texto plano, se ven igual en el panel y en Excel):
 * - "time":      "14:35" (24 h, lo que da <input type="time">)
 * - "timeRange": "14:00 a 17:00"
 * - "folioTime": "261120-0004 · 14:35"
 * - "days":      "Lun, Mar, Vie" (en orden de lunes a domingo)
 *
 * Por compatibilidad también se aceptan los valores escritos a mano en versiones anteriores
 * (12 h como «2:15 p.m.», «2:00 p.m. a 5:00 p.m.», «261120-0004, 3:25 p.m.»).
 */

/** Hora de 24 h (14:35, 14:35:00) o de 12 h escrita a mano (2:35 p.m., 2:35pm). */
export const ANY_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(?:([aApP])\.?\s?[mM]\.?)?$/;
/** Folio de pedido: 6 números, guion y 4 números (ej. 261120-0004). */
export const FOLIO_RE = /^#?\d{6}-\d{4}$/;

export const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
export const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

/** Minutos desde la medianoche, o null si no es una hora válida. */
export function timeMinutes(raw: string | undefined | null): number | null {
  const m = String(raw ?? "").trim().match(ANY_TIME_RE);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap && h <= 12) {
    if (ap === "a" && h === 12) h = 0;
    else if (ap === "p" && h < 12) h += 12;
  }
  return h * 60 + min;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" de 24 h para un <input type="time">, o "" si no se puede leer. */
export function toHHMM(raw: string | undefined | null): string {
  const t = timeMinutes(raw);
  return t === null ? "" : `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/** «3:14 p.m.» a partir de una hora (24 h o 12 h); "" si no se puede leer. */
export function format12h(raw: string | undefined | null): string {
  const t = timeMinutes(raw);
  if (t === null) return "";
  const h = Math.floor(t / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(t % 60)} ${h < 12 ? "a.m." : "p.m."}`;
}

/** Hora local actual como "HH:MM". */
export function nowHHMM(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- Rango de horas ---------- */

/** Separa «14:00 a 17:00» (o «2:00 p.m. a 5:00 p.m.», «14:00-17:00») en inicio y fin. */
export function splitRange(raw: string | undefined | null): { start: string; end: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { start: "", end: "" };
  // «a» como palabra (no la de «a.m.») o un guion
  const m = s.match(/^(.*?)\s*(?:(?<![\p{L}.])a(?![\p{L}.])|[-–—])\s*(.*)$/u);
  if (!m) return { start: s, end: "" };
  return { start: m[1].trim(), end: m[2].trim() };
}

export function joinRange(start: string, end: string): string {
  if (!start && !end) return "";
  return `${start} a ${end}`.trim();
}

/* ---------- Folio y hora ---------- */

/** Separa «261120-0004 · 14:35» (o «261120-0004, 3:25 p.m.») en folio y hora. */
export function splitFolioTime(raw: string | undefined | null): { folio: string; time: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { folio: "", time: "" };
  if (s.includes("·")) {
    const [folio, ...rest] = s.split("·");
    return { folio: folio.trim(), time: rest.join("·").trim() };
  }
  const m = s.match(/^(#?\d{6}-\d{4})\s*[,\-–—]?\s*(.*)$/);
  if (m) return { folio: m[1], time: m[2].trim() };
  return { folio: s, time: "" };
}

export function joinFolioTime(folio: string, time: string): string {
  if (!folio && !time) return "";
  return `${folio} · ${time}`.trim();
}

/**
 * Da formato al folio mientras se escribe: solo números y el guion después de los 6 primeros.
 * `prev` es el valor anterior (para no volver a poner el guion al borrarlo).
 */
export function formatFolioInput(next: string, prev = ""): string {
  const d = next.replace(/\D/g, "").slice(0, 10);
  if (d.length > 6) return `${d.slice(0, 6)}-${d.slice(6)}`;
  if (d.length === 6 && next.length > prev.length) return `${d}-`;
  return d;
}

/* ---------- Días ---------- */

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Índice 0–6 (lunes–domingo) de «Lun», «lunes», «mie», etc.; -1 si no es un día. */
function dayIndex(token: string): number {
  const t = fold(token.replace(/\.$/, ""));
  if (t.length < 3) return -1;
  return DAY_NAMES.findIndex((n) => fold(n).startsWith(t));
}

/** Días elegidos (abreviados, sin repetir, de lunes a domingo). `invalid` lista lo que no es un día. */
export function parseDays(raw: string | undefined | null): { days: (typeof DAYS)[number][]; invalid: string[] } {
  const tokens = String(raw ?? "")
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter((t) => t && fold(t) !== "y");
  const set = new Set<number>();
  const invalid: string[] = [];
  for (const t of tokens) {
    const i = dayIndex(t);
    if (i < 0) invalid.push(t);
    else set.add(i);
  }
  return { days: [...set].sort((a, b) => a - b).map((i) => DAYS[i]), invalid };
}

export function joinDays(days: readonly string[]): string {
  return DAYS.filter((d) => days.includes(d)).join(", ");
}

/* ---------- Errores (null si está bien; el valor vacío se revisa aparte) ---------- */

export function timeError(v: string): string | null {
  return timeMinutes(v) === null ? "Elige la hora y los minutos (o toca «Ahora»)." : null;
}

export function timeRangeError(v: string): string | null {
  const { start, end } = splitRange(v);
  if (!start) return "Elige la hora en que abre.";
  if (!end) return "Elige también la hora en que cierra.";
  const a = timeMinutes(start);
  const b = timeMinutes(end);
  if (a === null) return "Revisa la hora en que abre.";
  if (b === null) return "Revisa la hora en que cierra.";
  if (b <= a) return `La hora en que cierra (${format12h(end)}) debe ser después de la hora en que abre (${format12h(start)}).`;
  return null;
}

export function folioTimeError(v: string): string | null {
  const { folio, time } = splitFolioTime(v);
  if (!folio) return "Escribe el folio del pedido (ej. 261120-0004).";
  if (!FOLIO_RE.test(folio)) return "El folio debe tener 6 números, un guion y 4 números (ej. 261120-0004).";
  if (!time) return "Elige también la hora (o toca «Ahora»).";
  if (timeMinutes(time) === null) return "Revisa la hora.";
  return null;
}

export function daysError(v: string): string | null {
  const { days, invalid } = parseDays(v);
  if (invalid.length) return `«${invalid[0].slice(0, 20)}» no es un día. Elige los días con los botones.`;
  if (!days.length) return "Elige al menos un día.";
  return null;
}
