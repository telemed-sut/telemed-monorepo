import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";

const AUTH_COOKIE_NAME = "access_token";

function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(
      Buffer.from(normalized, "base64").toString("utf8")
    ) as { exp?: number };

    if (!payload.exp) return true;
    return payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token || isJwtExpired(token)) {
    redirect("/login");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
