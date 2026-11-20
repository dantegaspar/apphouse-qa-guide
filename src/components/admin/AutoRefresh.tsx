"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Vuelve a cargar los datos del panel cada `seconds` segundos (mientras la pestaña está visible). */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    // Sin conexión no se refresca: Next haría una recarga completa y mostraría la página de error del navegador.
    const refresh = () => document.visibilityState === "visible" && navigator.onLine && router.refresh();
    const t = setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [router, seconds]);
  return null;
}
