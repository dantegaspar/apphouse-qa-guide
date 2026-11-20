import type { ReactNode } from "react";

/**
 * Gráficas sin dependencias para el panel de administración (componentes de servidor).
 * Paleta: estados (bien / falla / bloqueo) con la paleta de estado; una sola serie en azul.
 * Cada gráfica trae título, subtítulo, leyenda (≥ 2 series), descripción accesible,
 * tooltip nativo (title) por marca y una vista de tabla.
 */

export const COLORS = {
  series: "#2a78d6",
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  neutral: "#b4b2a9",
  track: "#f0efec",
} as const;

const nf = (n: number, d = 0) => n.toLocaleString("es-MX", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");

export function Empty({ children = "Aún no hay datos" }: { children?: ReactNode }) {
  return <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function ChartCard({
  title,
  subtitle,
  children,
  table,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  table?: { head: string[]; rows: (string | number)[][] };
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
      {table && table.rows.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-700">Ver tabla</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="text-slate-500">
                <tr>
                  {table.head.map((h, i) => (
                    <th key={h} className={`px-2 py-1 font-medium ${i ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={`px-2 py-1 ${j ? "text-right" : ""}`}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

export type Series = { name: string; color: string };

export function Legend({ series, className = "mb-3" }: { series: Series[]; className?: string }) {
  return (
    <ul className={`${className} flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600`} aria-label="Leyenda">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** Mini figura (stat tile). */
export function Kpi({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start gap-1.5 text-sm text-slate-600">
        {accent && <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />}
        <span className="leading-tight">{label}</span>
      </div>
      <div className="mt-1 text-3xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

type StackRow = { key: string; label: ReactNode; aria: string; values: number[] };

/** Barras horizontales apiladas. Etiqueta arriba de la barra (cabe en celular); total en la punta. */
export function StackedBars({ rows, series, max, unit = "" }: { rows: StackRow[]; series: Series[]; max?: number; unit?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
  return (
    <div>
      <Legend series={series} />
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const total = r.values.reduce((a, b) => a + b, 0);
          const desc = series.map((s, i) => `${s.name}: ${r.values[i]}`).join(", ");
          return (
            <li key={r.key} className="text-sm">
              <div className="mb-1 truncate text-slate-700">{r.label}</div>
              <div className="flex items-center gap-2" role="img" aria-label={`${r.aria}. ${desc}. Total ${total}${unit}`}>
                <div className="flex h-4 min-w-0 flex-1 items-stretch">
                  <div className="flex gap-[2px]" style={{ width: `${(total / top) * 100}%` }}>
                    {r.values.map((v, i) =>
                      v > 0 ? (
                        <div
                          key={i}
                          title={`${r.aria} · ${series[i].name}: ${v} (${pct(v, total)})`}
                          className="h-full min-w-[3px] last:rounded-r"
                          style={{ flexGrow: v, flexBasis: 0, background: series[i].color }}
                        />
                      ) : null
                    )}
                  </div>
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-slate-700">{total}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type BarRow = { key: string; label: ReactNode; aria: string; value: number; sub?: ReactNode };

/** Barras horizontales de una sola serie. */
export function Bars({ rows, color = COLORS.series, max, format = (n: number) => nf(n) }: { rows: BarRow[]; color?: string; max?: number; format?: (n: number) => string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="mb-1 flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-medium text-slate-800">{r.label}</span>
            {r.sub && <span className="truncate text-xs text-slate-500">{r.sub}</span>}
          </div>
          <div className="flex items-center gap-2" role="img" aria-label={`${r.aria}: ${format(r.value)}`} title={`${r.aria}: ${format(r.value)}`}>
            <div className="h-4 min-w-0 flex-1">
              {r.value > 0 && <div className="h-full min-w-[3px] rounded-r" style={{ width: `${(r.value / top) * 100}%`, background: color }} />}
            </div>
            <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-slate-700">{format(r.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

type Col = { key: string; label: string; value: number; color?: string; title?: string };

/**
 * Columnas verticales en SVG: el área de marcas se estira al ancho disponible
 * (las barras usan coordenadas en %), y las etiquetas van en HTML para no escalar el texto.
 */
export function Columns({
  cols,
  height = 140,
  aria,
  color = COLORS.series,
  labelEvery = 1,
}: {
  cols: Col[];
  height?: number;
  aria: string;
  color?: string;
  labelEvery?: number;
}) {
  const top = Math.max(1, ...cols.map((c) => c.value));
  const n = cols.length || 1;
  const slot = 100 / n;
  const bw = Math.min(slot * 0.72, slot - 0.6);
  const valueRoom = 16;
  const plot = height - valueRoom;
  const showValues = n <= 16;
  return (
    <figure role="img" aria-label={`${aria}. ${cols.map((c) => `${c.label}: ${c.value}`).join(", ")}`}>
      <svg width="100%" height={height} className="block overflow-visible" aria-hidden>
        <line x1="0" x2="100%" y1={height - 0.5} y2={height - 0.5} stroke="#d6d4ce" strokeWidth="1" />
        {cols.map((c, i) => {
          const h = c.value > 0 ? Math.max(2, (c.value / top) * (plot - 4)) : 0;
          const x = i * slot + (slot - bw) / 2;
          return (
            <g key={c.key}>
              <title>{c.title ?? `${c.label}: ${c.value}`}</title>
              {/* área de acierto más grande que la marca */}
              <rect x={`${i * slot}%`} y="0" width={`${slot}%`} height={height} fill="transparent" />
              {h > 0 && (
                <>
                  <rect x={`${x}%`} y={height - h - 1} width={`${bw}%`} height={h} rx="4" fill={c.color ?? color} />
                  {/* esquinas cuadradas en la base */}
                  <rect x={`${x}%`} y={height - Math.min(h, 4) - 1} width={`${bw}%`} height={Math.min(h, 4)} fill={c.color ?? color} />
                </>
              )}
              {showValues && c.value > 0 && (
                <text x={`${i * slot + slot / 2}%`} y={height - h - 5} textAnchor="middle" fontSize="11" fill="#52514e" className="tabular-nums">
                  {c.value}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[11px] text-slate-500 tabular-nums">
        {cols.map((c, i) => (
          <span key={c.key} className="min-w-0 flex-1 whitespace-nowrap text-center" style={{ visibility: i % labelEvery === 0 ? "visible" : "hidden" }}>
            {c.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Barra segmentada alta (parte de un todo) con la proporción dentro de cada bloque. */
export function SegmentedBar({ parts, aria }: { parts: { name: string; value: number; color: string; ink?: string }[]; aria: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex h-7 gap-[2px]" role="img" aria-label={`${aria}. ${parts.map((p) => `${p.name}: ${p.value} (${pct(p.value, total)})`).join(", ")}`}>
        {parts.map((p) =>
          p.value > 0 ? (
            <div
              key={p.name}
              title={`${p.name}: ${p.value} (${pct(p.value, total)})`}
              className="flex min-w-[4px] items-center overflow-hidden rounded px-2 text-xs font-semibold"
              style={{ flexGrow: p.value, flexBasis: 0, background: p.color, color: p.ink ?? "#fff" }}
            >
              {p.value / total >= 0.12 && <span className="whitespace-nowrap">{pct(p.value, total)}</span>}
            </div>
          ) : null
        )}
      </div>
      <Legend className="mt-2" series={parts.map((p) => ({ name: `${p.name} (${p.value})`, color: p.color }))} />
    </div>
  );
}

export const fmt = nf;
