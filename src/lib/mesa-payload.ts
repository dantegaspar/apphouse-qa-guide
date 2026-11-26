import crypto from "node:crypto";
import { getGuide, GUIDES } from "./guides";
import { guideShortTitle, loadMesa, loadOpenHelp, loadOtherRoundsActivity, qaTiles, type MesaRow, type OtherRoundActivity, type QaTile } from "./admin-data";
import { viewRoundId } from "./rounds";
import type { HelpSummary } from "@/components/admin/HelpRequestWatcher";

/** Solicitud de ayuda abierta en otra ronda (la tabla de la Mesa es solo de la ronda a la vista). */
export type MesaOtherHelp = { id: string; runId: string; tester: string; where: string; createdAt: string; roundId: number };

/**
 * Todo lo que pinta la Mesa de control, listo para JSON. Lo arma el servidor para la primera carga
 * (sin parpadeo) y lo vuelve a entregar /api/admin/mesa en cada consulta del navegador.
 */
export type MesaPayload = {
  /** Hora del servidor de estos datos (ms). */
  at: number;
  /** Huella de los datos sin la hora: si no cambia, el navegador alarga el intervalo. */
  sig: string;
  /** Ronda a la vista en el servidor (si otra persona la cambió, la página se vuelve a pintar). */
  round: number;
  guideId: string | null;
  rows: MesaRow[];
  tiles: QaTile[];
  guides: { id: string; title: string; shortTitle: string }[];
  otherRounds: OtherRoundActivity[];
  otherHelp: MesaOtherHelp[];
  /** Solicitudes de ayuda abiertas (de esta ronda y de otras) para el aviso de «nueva solicitud». */
  openHelp: HelpSummary[];
};

const whereOf = (guideId: string, activityId: string) => {
  const act = getGuide(guideId)?.activities.find((a) => a.id === activityId);
  return act ? `${act.id} ${act.title}` : activityId || "la guía";
};

export function buildMesaPayload(guideId: string | null): MesaPayload {
  const { rows, at } = loadMesa(guideId);
  const otherRounds = loadOtherRoundsActivity(at);
  const otherHelpRows = loadOpenHelp().rows.filter((h) => h.other_round);
  const otherHelp = otherHelpRows.map((h) => ({
    id: h.id,
    runId: h.run_id,
    tester: h.tester,
    where: whereOf(h.guide_id, h.activity_id),
    createdAt: h.created_at,
    roundId: h.round_id,
  }));
  const data = {
    round: viewRoundId(),
    guideId,
    rows,
    tiles: rows.length ? qaTiles(rows) : [],
    guides: GUIDES.map((g) => ({ id: g.id, title: g.title, shortTitle: guideShortTitle(g.id) })),
    otherRounds,
    otherHelp,
    openHelp: [
      ...rows.filter((r) => r.openHelp).map((r) => ({ id: r.openHelp!.id, tester: r.run.name, where: whereOf(r.run.guide_id, r.openHelp!.activity_id) })),
      ...otherHelpRows.map((h) => ({ id: h.id, tester: h.tester, where: `${whereOf(h.guide_id, h.activity_id)} («${h.round_name}»)` })),
    ],
  };
  const sig = crypto.createHash("sha1").update(JSON.stringify(data)).digest("base64url");
  return { at, sig, ...data };
}

/** ?guide= válido o null (todas las guías). */
export const mesaGuideParam = (g: string | null | undefined) => (g && getGuide(g) ? g : null);
