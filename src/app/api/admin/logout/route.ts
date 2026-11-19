import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  (await cookies()).set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return json({ ok: true });
}
