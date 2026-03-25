import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fetchCurrentUserSessionServer } from "@/app/server-api";

const AUTH_COOKIE_NAME = "access_token";

export default async function AdminLayout({
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

  if (session.role !== "admin") {
    redirect("/overview");
  }

  if (!session.mfaVerified) {
    redirect("/login");
  }

  return <>{children}</>;
}
