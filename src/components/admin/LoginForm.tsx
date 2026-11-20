"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/feedback";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        toast.success("Sesión iniciada. ¡Bienvenido!", { id: "admin-login" });
        router.replace("/admin");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      const msg = data.error || "No se pudo entrar";
      setError(msg);
      toast.error(res.status === 401 ? "Revisa la contraseña e intenta de nuevo." : msg, {
        id: "admin-login",
        title: res.status === 401 ? "Contraseña incorrecta" : "No se pudo entrar",
      });
    } catch {
      setError("Sin conexión. Intenta de nuevo.");
      toast.error("Revisa tu internet e intenta de nuevo.", { id: "admin-login", title: "Sin conexión" });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Contraseña</span>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-3 text-base outline-none focus:border-[#2F5DA8] focus:ring-2 focus:ring-[#2F5DA8]/30"
        />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-lg bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8] px-4 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
