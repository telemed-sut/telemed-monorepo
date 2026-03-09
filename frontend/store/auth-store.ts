import { create } from "zustand";

import type { LoginResponse } from "@/lib/api";

/** Refresh token 5 minutes before expiry */
const REFRESH_BUFFER_SECONDS = 300;
const COOKIE_SESSION_TOKEN = "__cookie_session__";

interface AuthState {
  token: string | null;
  role: string | null;
  userId: string | null;
  hydrated: boolean;
  sessionExpiresAt: number | null;
  setSession: (response: LoginResponse) => void;
  clearToken: () => void;
  hydrate: () => Promise<void>;
  /** Returns seconds until token expires, or 0 if expired/missing */
  getTokenTTL: () => number;
  /** Returns true if the token will expire within REFRESH_BUFFER_SECONDS */
  isTokenExpiringSoon: () => boolean;
}

let hydratePromise: Promise<void> | null = null;

function getExpiryEpoch(expiresIn?: number): number | null {
  if (!Number.isFinite(expiresIn)) return null;
  const normalized = Math.max(0, Math.floor(expiresIn as number));
  return Date.now() + normalized * 1000;
}

function getSessionState(response: LoginResponse) {
  return {
    token: COOKIE_SESSION_TOKEN,
    role: response.user?.role ?? null,
    userId: response.user?.id ?? null,
    sessionExpiresAt: getExpiryEpoch(response.expires_in),
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  role: null,
  userId: null,
  hydrated: false,
  sessionExpiresAt: null,
  setSession: (response) => {
    set({ ...getSessionState(response), hydrated: true });
  },
  clearToken: () => {
    const activeToken = get().token ?? undefined;
    if (typeof window !== "undefined") {
      void import("@/lib/api")
        .then(({ logout }) => logout(activeToken))
        .catch(() => undefined);
    }
    set({
      token: null,
      role: null,
      userId: null,
      hydrated: true,
      sessionExpiresAt: null,
    });
  },
  hydrate: async () => {
    if (get().hydrated) return;
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      try {
        const { refreshToken } = await import("@/lib/api");
        const refreshed = await refreshToken();
        if (refreshed?.user) {
          set({ ...getSessionState(refreshed), hydrated: true });
          return;
        }
      } catch {
        // No valid session cookie or refresh failed.
      }

      set({
        token: null,
        role: null,
        userId: null,
        hydrated: true,
        sessionExpiresAt: null,
      });
    })().finally(() => {
      hydratePromise = null;
    });

    return hydratePromise;
  },
  getTokenTTL: () => {
    const { sessionExpiresAt } = get();
    if (!sessionExpiresAt) return 0;
    return Math.max(Math.floor((sessionExpiresAt - Date.now()) / 1000), 0);
  },
  isTokenExpiringSoon: () => {
    return get().getTokenTTL() < REFRESH_BUFFER_SECONDS;
  },
}));
