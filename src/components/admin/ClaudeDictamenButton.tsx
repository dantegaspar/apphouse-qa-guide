"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Botón «Dictaminar con Claude»: tarda 1–3 minutos. */
export default function ClaudeDictamenButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/claude-dictamen", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "No se pudo hacer el dictamen");
      if (body.error) setError(body.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo hacer el dictamen");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy || disabled}
        className="rounded-lg bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        data-testid="claude-dictamen"
      >
        {busy ? "Claude está revisando… (1–3 min)" : "Dictaminar con Claude"}
      </button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  );
}
