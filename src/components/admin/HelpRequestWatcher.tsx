"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/feedback";

export type HelpSummary = { id: string; tester: string; where: string };

/**
 * Compara las solicitudes de ayuda abiertas entre una actualización automática y la siguiente
 * (router.refresh conserva este componente) y avisa con un toast cuando llega una NUEVA.
 * No suena: solo el aviso visual y el anuncio para lectores de pantalla.
 */
export function HelpRequestWatcher({ open }: { open: HelpSummary[] }) {
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    const ids = new Set(open.map((h) => h.id));
    const prev = known.current;
    known.current = ids;
    if (!prev) return; // primera carga: lo que ya estaba no es "nuevo"
    const fresh = open.filter((h) => !prev.has(h.id));
    if (!fresh.length) return;
    const goToList = {
      label: "Ver solicitudes",
      onClick: () => document.getElementById("ayuda")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    };
    toast.warning(
      fresh.length === 1 ? `${fresh[0].tester} pide ayuda en ${fresh[0].where}.` : `${fresh.map((h) => h.tester).join(", ")} piden ayuda.`,
      {
        id: "help-new",
        title: fresh.length === 1 ? "Nueva solicitud de ayuda" : `${fresh.length} solicitudes de ayuda nuevas`,
        action: goToList,
        duration: 15000,
      },
    );
  }, [open]);

  return null;
}
