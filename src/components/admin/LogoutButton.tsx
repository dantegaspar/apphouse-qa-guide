"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast, useConfirm } from "@/components/feedback";

export function LogoutButton() {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        const ok = await confirm({
          title: "¿Cerrar sesión?",
          message: "Para volver al panel tendrás que escribir la contraseña otra vez.",
          confirmLabel: "Cerrar sesión",
          cancelLabel: "Seguir aquí",
        });
        if (!ok) return;
        setBusy(true);
        try {
          const res = await fetch("/api/admin/logout", { method: "POST" });
          if (!res.ok) throw new Error(String(res.status));
          toast.info("Sesión cerrada", { id: "admin-login" });
          router.replace("/admin/login");
          router.refresh();
        } catch {
          setBusy(false);
          toast.error("No se pudo cerrar la sesión. Revisa tu conexión e intenta de nuevo.", { id: "admin-logout" });
        }
      }}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {busy ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
