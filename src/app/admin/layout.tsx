import { isAdmin } from "@/lib/auth";
import { activeRoundId, defaultRoundName, listRounds, roundCounts, viewRoundId } from "@/lib/rounds";
import { RoundSwitcher } from "@/components/admin/RoundSwitcher";

export const dynamic = "force-dynamic";

/** Barra de rondas de encuestas arriba de todas las páginas del panel (no sale al imprimir). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) return children;
  const rounds = listRounds();
  const counts = roundCounts();
  const active = activeRoundId();
  return (
    <>
      <RoundSwitcher
        rounds={rounds.map((r) => ({ ...r, ...(counts.get(r.id) ?? { runs: 0, couriers: 0, open: 0 }) }))}
        view={viewRoundId()}
        active={active}
        nextName={defaultRoundName(active + 1)}
      />
      {children}
    </>
  );
}
