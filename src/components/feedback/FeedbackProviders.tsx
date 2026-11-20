"use client";

import type { ReactNode } from "react";
import { ConfirmProvider } from "./Confirm";
import { ConnectionBanner } from "./ConnectionBanner";
import { ToastProvider } from "./Toast";

/** Monta avisos, diálogo de confirmación y banner de conexión. Se usa una vez en src/app/layout.tsx. */
export function FeedbackProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        {children}
        <ConnectionBanner />
      </ConfirmProvider>
    </ToastProvider>
  );
}
