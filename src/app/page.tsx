import Image from "next/image";
import Link from "next/link";
import { GUIDES } from "@/lib/guides";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <div className="flex flex-col items-center text-center">
        <Image src="/logo.png" alt="AppHouse" width={150} height={108} priority />
        <h1 className="mt-4 text-2xl font-bold">Guía de pruebas QA</h1>
        <p className="mt-2 text-slate-700">
          Elige tu guía. Te llevaremos paso a paso y podrás reportar cualquier falla con una captura.
        </p>
      </div>
      <ul className="mt-8 space-y-3">
        {GUIDES.filter((g) => !g.hidden).map((g, i) => (
          <li key={g.id} className="animate-pop" style={{ animationDelay: `${60 + i * 60}ms` }}>
            <Link
              href={`/g/${g.id}`}
              className="block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-500 active:scale-[0.98]"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-ink">{g.role}</div>
              <div className="mt-1 text-lg font-semibold">{g.title}</div>
              <div className="mt-1 text-sm text-slate-700">
                {g.activities.length} actividades · {g.activities.reduce((n, a) => n + a.steps.length, 0)} pasos
              </div>
            </Link>
          </li>
        ))}
        <li className="animate-pop" style={{ animationDelay: `${60 + GUIDES.filter((g) => !g.hidden).length * 60}ms` }}>
          <Link
            href="/repartidor"
            className="block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-500 active:scale-[0.98]"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-ink">Repartidor</div>
            <div className="mt-1 text-lg font-semibold">Encuesta para repartidores</div>
            <div className="mt-1 text-sm text-slate-700">6 preguntas con caritas · reporta fallas con una foto</div>
          </Link>
        </li>
      </ul>
    </main>
  );
}
