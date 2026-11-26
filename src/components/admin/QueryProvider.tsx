"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Cliente de TanStack Query para el panel. Cada página decide su intervalo; aquí solo lo común:
 * no consultar con la pestaña oculta, volver a consultar al regresar a la pestaña o recuperar la red,
 * y sin reintentos internos (la Mesa espaciará sus consultas cuando fallen).
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true, refetchIntervalInBackground: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
