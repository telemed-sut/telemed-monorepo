import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fetchCurrentUserRoleServer } from "@/app/server-api";

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

  const role = await fetchCurrentUserRoleServer(token);
  if (!role) {
    redirect("/login");
  }

  if (role !== "admin") {
    redirect("/overview");
  }

  return <>{children}</>;
}
