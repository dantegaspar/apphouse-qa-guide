"use client";

/** Abre el diálogo de impresión del navegador, donde se elige «Guardar como PDF». */
export function PrintButton({ label = "Descargar PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-[#2F5DA8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264d8c] print:hidden"
    >
      {label}
    </button>
  );
}
