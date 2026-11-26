import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { buildMesaPayload, mesaGuideParam } from "@/lib/mesa-payload";
import { MesaLive } from "@/components/admin/MesaLive";

export const dynamic = "force-dynamic";

/**
 * Mesa de control. El servidor pinta la primera vista; después MesaLive consulta /api/admin/mesa con
 * TanStack Query (intervalo inteligente, reintentos y aviso si se pierde la conexión).
 */
export default async function MesaPage({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { guide } = await searchParams;
  return <MesaLive initial={buildMesaPayload(mesaGuideParam(guide))} />;
}
