import "server-only";

const DEFAULT_SERVER_API_BASE_URL = "http://localhost:8000";

function getServerApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_SERVER_API_BASE_URL;
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export async function serverApiFetch<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T | null> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  try {
    const response = await fetch(`${getServerApiBaseUrl()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchCurrentUserRoleServer(token: string): Promise<string | null> {
  const payload = await serverApiFetch<{ role?: unknown }>("/auth/me", token, {
    method: "GET",
  });
  return typeof payload?.role === "string" ? payload.role : null;
}
