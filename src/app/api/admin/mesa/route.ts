import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { buildMesaPayload, mesaGuideParam } from "@/lib/mesa-payload";

export const dynamic = "force-dynamic";

/** Datos en vivo de la Mesa de control (los consulta el navegador con TanStack Query). */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: { "cache-control": "no-store" } });
  const guideId = mesaGuideParam(new URL(req.url).searchParams.get("guide"));
  return NextResponse.json(buildMesaPayload(guideId), { headers: { "cache-control": "no-store" } });
}
