import { create } from "zustand";
import { jwtDecode } from "jwt-decode";

/** Refresh token 5 minutes before expiry */
const REFRESH_BUFFER_SECONDS = 300;

interface AuthPayload {
  sub?: string; // user ID
  role?: string;
  exp?: number;
  [key: string]: unknown;
}

interface AuthState {
  token: string | null;
  role: string | null;
  userId: string | null;
  hydrated: boolean;
  setToken: (token: string) => void;
  clearToken: () => void;
  hydrate: () => Promise<void>;
  /** Returns seconds until token expires, or 0 if expired/missing */
  getTokenTTL: () => number;
  /** Returns true if the token will expire within REFRESH_BUFFER_SECONDS */
  isTokenExpiringSoon: () => boolean;
}

let hydratePromise: Promise<void> | null = null;

const getPayloadFromToken = (
  token: string | null
): { role: string | null; userId: string | null } => {
  if (!token) return { role: null, userId: null };
  try {
    const decoded = jwtDecode<AuthPayload>(token);
    return {
      role: decoded.role || null,
      userId: decoded.sub || null,
    };
  } catch {
    return { role: null, userId: null };
  }
};

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  role: null,
  userId: null,
  hydrated: false,
  setToken: (token) => {
    const { role, userId } = getPayloadFromToken(token);
    set({ token, role, userId, hydrated: true });
  },
  clearToken: () => {
    const activeToken = get().token ?? undefined;
    if (typeof window !== "undefined") {
      void import("@/lib/api")
        .then(({ logout }) => logout(activeToken))
        .catch(() => undefined);
    }
    set({ token: null, role: null, userId: null, hydrated: true });
  },
  hydrate: async () => {
    if (get().hydrated) return;
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      try {
        const { refreshToken } = await import("@/lib/api");
        const refreshed = await refreshToken();
        if (refreshed?.access_token) {
          const { role, userId } = getPayloadFromToken(refreshed.access_token);
          set({
            token: refreshed.access_token,
            role,
            userId,
            hydrated: true,
          });
          return;
        }
      } catch {
        // No valid session cookie or refresh failed.
      }

      set({ token: null, role: null, userId: null, hydrated: true });
    })().finally(() => {
      hydratePromise = null;
    });

    return hydratePromise;
  },
  getTokenTTL: () => {
    const { token } = get();
    if (!token) return 0;
    try {
      const decoded = jwtDecode<AuthPayload>(token);
      if (!decoded.exp) return 0;
      const now = Math.floor(Date.now() / 1000);
      return Math.max(decoded.exp - now, 0);
    } catch {
      return 0;
    }
  },
  isTokenExpiringSoon: () => {
    return get().getTokenTTL() < REFRESH_BUFFER_SECONDS;
  },
}));
