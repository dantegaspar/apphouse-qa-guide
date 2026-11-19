import { redirect } from "next/navigation";
import { adminConfigured, isAdmin } from "@/lib/auth";
import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");
  const configured = adminConfigured();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="rounded-2xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
        <div className="mb-5 h-1.5 w-16 rounded-full bg-gradient-to-r from-[#2F5DA8] to-[#3BA3A8]" />
        <h1 className="text-xl font-bold text-slate-900">Panel de administración</h1>
        <p className="mb-5 mt-1 text-sm text-slate-600">Guía de pruebas AppHouse</p>
        {configured ? (
          <LoginForm />
        ) : (
          <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            El panel está desactivado porque falta la variable de entorno <code className="font-mono font-semibold">ADMIN_PASSWORD</code>.
            Defínela en el servidor (por ejemplo en <code className="font-mono">.env.local</code>) y reinicia la aplicación.
          </div>
        )}
      </div>
    </main>
  );
}
