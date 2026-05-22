import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { fetchCurrentUserSessionServer } from "@/app/server-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

const AUTH_COOKIE_NAME = "access_token";
const SIDEBAR_COOKIE_NAME = "sidebar_state";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    redirect("/login");
  }

  const session = await fetchCurrentUserSessionServer(token);
  if (!session) {
    redirect("/login");
  }

  const sidebarDefaultOpen =
    cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return (
    <DashboardShell
      serverRole={session.role}
      sidebarDefaultOpen={sidebarDefaultOpen}
    >
      {children}
    </DashboardShell>
  );
}
