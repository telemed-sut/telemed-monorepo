import "server-only";

const DEFAULT_SERVER_API_BASE_URL = "http://127.0.0.1:8000";

function getServerApiBaseUrl(): string {
  const baseUrl =
    process.env.NEXT_SERVER_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    DEFAULT_SERVER_API_BASE_URL;

  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    return DEFAULT_SERVER_API_BASE_URL;
  }

  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export class ServerApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ServerApiError";
  }
}

function isFetchUnavailableError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
  );
}

export async function serverApiFetch<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T | null> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${getServerApiBaseUrl()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    if (isFetchUnavailableError(error)) {
      return null;
    }

    throw error;
  }

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new ServerApiError(
      response.status,
      `Server API request failed: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as T;
}

export async function fetchCurrentUserRoleServer(token: string): Promise<string | null> {
  const payload = await serverApiFetch<{ role?: unknown }>("/auth/me", token, {
    method: "GET",
  });
  return typeof payload?.role === "string" ? payload.role : null;
}

export interface CurrentUserSessionServer {
  role: string | null;
  mfaVerified: boolean;
}

function readJwtBooleanClaim(token: string, claim: string): boolean | null {
  try {
    const [, payloadSegment] = token.split(".");
    if (!payloadSegment) {
      return null;
    }

    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
    return typeof payload[claim] === "boolean" ? payload[claim] : null;
  } catch {
    return null;
  }
}

export async function fetchCurrentUserSessionServer(token: string): Promise<CurrentUserSessionServer | null> {
  const payload = await serverApiFetch<{ role?: unknown; mfa_verified?: unknown }>("/auth/me", token, {
    method: "GET",
  });
  if (typeof payload?.role !== "string") {
    return null;
  }

  const mfaVerifiedFromPayload =
    typeof payload.mfa_verified === "boolean" ? payload.mfa_verified : null;

  return {
    role: payload.role,
    mfaVerified: mfaVerifiedFromPayload ?? readJwtBooleanClaim(token, "mfa_verified") === true,
  };
}
