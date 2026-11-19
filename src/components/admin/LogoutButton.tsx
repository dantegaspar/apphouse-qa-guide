"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.replace("/admin/login");
        router.refresh();
      }}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      Cerrar sesión
    </button>
  );
}
