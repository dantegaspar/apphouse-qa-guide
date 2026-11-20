"use client";

import { useEffect, useRef, useState } from "react";
import { Banner } from "./Banner";
import { IconOffline } from "./icons";
import { toast } from "./Toast";
import { useOnlineStatus } from "./useOnlineStatus";

export type ConnectionBannerProps = {
  /** Texto mientras no hay conexión. */
  offlineMessage?: string;
  /** Aviso (toast) al volver la conexión. `null` = no avisar. */
  onlineMessage?: string | null;
};

export const DEFAULT_OFFLINE_MESSAGE = "Sin conexión: tus respuestas se guardan y se enviarán al volver la señal.";

function OfflineBar({ message }: { message: string }) {
  // Vive solo mientras no hay conexión: al volver a desconectarse empieza otra vez expandido.
  const [minimized, setMinimized] = useState(false);
  return (
    <div
      data-testid="connection-banner"
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-center px-2 sm:px-4"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      {minimized ? (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="pointer-events-auto inline-flex min-h-9 items-center gap-1.5 rounded-full bg-slate-800 px-3 text-sm font-semibold text-white shadow-lg ring-1 ring-slate-900/20 transition-[opacity,transform] duration-200 starting:-translate-y-3 starting:opacity-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40"
          aria-label="Sin conexión. Toca para ver el detalle"
        >
          <IconOffline className="h-4 w-4" />
          Sin conexión
        </button>
      ) : (
        <Banner
          tone="offline"
          compact
          onClose={() => setMinimized(true)}
          className="pointer-events-auto w-full max-w-xl shadow-lg transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none starting:-translate-y-4 starting:opacity-0"
        >
          {message}
        </Banner>
      )}
    </div>
  );
}

/**
 * Muestra un banner fijo arriba cuando el navegador pierde la conexión y un aviso
 * "Conexión recuperada" cuando vuelve. Ya está montado en el layout raíz.
 */
export function ConnectionBanner({ offlineMessage = DEFAULT_OFFLINE_MESSAGE, onlineMessage = "Conexión recuperada" }: ConnectionBannerProps) {
  const online = useOnlineStatus();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      toast.dismiss("connection");
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      if (onlineMessage) toast.success(onlineMessage, { id: "connection" });
    }
  }, [online, onlineMessage]);

  return online ? null : <OfflineBar message={offlineMessage} />;
}
