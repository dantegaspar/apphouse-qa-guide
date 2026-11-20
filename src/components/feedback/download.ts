"use client";

import { toast } from "./Toast";

export type DownloadOptions = {
  /** Nombre corto de lo que se descarga ("Excel", "CSV de Pasos"…). */
  label?: string;
  /** Texto mientras se prepara. Por defecto "Preparando {label}…". */
  preparing?: string;
  /** Texto al terminar. Por defecto "{label} descargado". */
  done?: string;
  /** Nombre de archivo si el servidor no manda Content-Disposition. */
  filename?: string;
};

function filenameFrom(res: Response, fallback: string) {
  const cd = res.headers.get("content-disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* usa el siguiente */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1] : fallback;
}

/**
 * Descarga un archivo con avisos de progreso: "Preparando…" → "Listo" (o error con "Reintentar").
 * Devuelve true si se descargó.
 */
export async function downloadFile(url: string, opts: DownloadOptions = {}): Promise<boolean> {
  const label = opts.label ?? "Archivo";
  const id = `download:${url}`;
  const retry = { label: "Reintentar", onClick: () => void downloadFile(url, opts) };
  toast.loading(opts.preparing ?? `Preparando ${label}…`, { id });
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) {
      toast.error("Tu sesión se cerró. Recarga la página y vuelve a entrar.", {
        id,
        title: "No se pudo descargar",
        action: { label: "Recargar", onClick: () => window.location.reload() },
      });
      return false;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error || `El servidor respondió con un error (${res.status}).`, { id, title: "No se pudo descargar", action: retry });
      return false;
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filenameFrom(res, opts.filename ?? "descarga");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    toast.success(opts.done ?? `${label} descargado`, { id, title: "Listo" });
    return true;
  } catch {
    toast.error("Sin conexión. Revisa tu internet e intenta de nuevo.", { id, title: "No se pudo descargar", action: retry });
    return false;
  }
}
