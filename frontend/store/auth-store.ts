import { create } from "zustand";

import type { LoginResponse, UserMe } from "@/lib/api";

/** Refresh token 5 minutes before expiry */
const REFRESH_BUFFER_SECONDS = 300;
const COOKIE_SESSION_TOKEN = "__cookie_session__";

interface AuthState {
  token: string | null;
  role: string | null;
  userId: string | null;
  mfaVerified: boolean;
  isSuperAdmin: boolean;
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
    mfaVerified: Boolean(response.user?.mfa_verified),
    isSuperAdmin: Boolean(response.user?.is_super_admin),
    sessionExpiresAt: getExpiryEpoch(response.expires_in),
  };
}

function getCookieSessionState(user: UserMe) {
  return {
    token: COOKIE_SESSION_TOKEN,
    role: user.role ?? null,
    userId: user.id ?? null,
    mfaVerified: Boolean(user.mfa_verified),
    isSuperAdmin: Boolean(user.is_super_admin),
    sessionExpiresAt: null,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  role: null,
  userId: null,
  mfaVerified: false,
  isSuperAdmin: false,
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
      mfaVerified: false,
      isSuperAdmin: false,
      hydrated: true,
      sessionExpiresAt: null,
    });
  },
  hydrate: async () => {
    if (get().hydrated) return;
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      try {
        const { fetchCurrentUser, refreshToken } = await import("@/lib/api");

        try {
          const currentUser = await fetchCurrentUser();
          if (currentUser) {
            set({ ...getCookieSessionState(currentUser), hydrated: true });

            try {
              const refreshed = await refreshToken();
              if (refreshed?.user) {
                set({ ...getSessionState(refreshed), hydrated: true });
              }
            } catch {
              // Cookie session is already valid for this route; keep it even if
              // refresh is temporarily unavailable (for example on an alternate
              // host/origin used during QA).
            }

            return;
          }
        } catch {
          // Fall back to refresh-only hydration when /auth/me is unavailable.
        }

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
        mfaVerified: false,
        isSuperAdmin: false,
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
