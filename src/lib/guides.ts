import cliente from "../../content/guides/cliente.json";
import establecimiento from "../../content/guides/establecimiento.json";
import establecimientoApp from "../../content/guides/establecimiento-app.json";
import type { Guide } from "./types";

/** Registro de guías. Para agregar una guía nueva, crea su JSON en content/guides y agrégala aquí. */
export const GUIDES: Guide[] = [cliente as Guide, establecimiento as Guide, establecimientoApp as Guide];

export function getGuide(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}
