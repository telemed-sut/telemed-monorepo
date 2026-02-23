import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const AUTH_COOKIE_NAME = "access_token";

function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

async function fetchCurrentUserRole(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

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

  const role = await fetchCurrentUserRole(token);
  if (!role) {
    redirect("/login");
  }

  if (role !== "admin") {
    redirect("/overview");
  }

  return <>{children}</>;
}
