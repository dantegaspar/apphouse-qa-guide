"use client";

import { createContext, useContext } from "react";

/**
 * Ronda que el admin tiene en pantalla (la que se pintó con esta página). Las descargas y el dictamen
 * con Claude la mandan al servidor para no usar otra ronda si alguien cambió la vista compartida
 * desde otra pestaña o computadora mientras esta página seguía abierta.
 */
const ViewRoundContext = createContext<number | null>(null);

export function ViewRoundProvider({ round, children }: { round: number; children: React.ReactNode }) {
  return <ViewRoundContext.Provider value={round}>{children}</ViewRoundContext.Provider>;
}

export const useViewRound = () => useContext(ViewRoundContext);

/** Agrega ?round=<id> a una URL relativa del panel (sin tocar los demás parámetros). */
export function withRoundParam(href: string, round: number | null): string {
  if (!round) return href;
  const [path, hash = ""] = href.split("#");
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}round=${round}${hash ? `#${hash}` : ""}`;
}
