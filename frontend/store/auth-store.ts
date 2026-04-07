import { create } from "zustand";

import type { LoginResponse, UserMe } from "@/lib/api";
import { clearPatientWorkspaceCache } from "@/lib/patient-workspace-cache";
import { clearWorkspaceTabsState } from "@/store/workspace-tabs-store";

/** Refresh token 5 minutes before expiry */
const REFRESH_BUFFER_SECONDS = 300;
const COOKIE_SESSION_TOKEN = "__cookie_session__";
const AUTH_SNAPSHOT_STORAGE_KEY = "telemed.auth.snapshot.v3";
const LEGACY_AUTH_SNAPSHOT_STORAGE_KEY = "telemed.auth.snapshot";
const PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY = "telemed.auth.snapshot.v2";
const AUTH_SNAPSHOT_REVALIDATE_AFTER_MS = 5 * 60 * 1000;
const AUTH_SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface PersistedAuthSnapshot {
  token: string | null;
  role: string | null;
  userId: string | null;
  mfaVerified: boolean;
  mfaRecentForPrivilegedActions: boolean;
  mfaAuthenticatedAt: string | null;
  authSource: string | null;
  ssoProvider: string | null;
  sessionExpiresAt: number | null;
  lastVerifiedAt: number | null;
}

interface AuthState {
  token: string | null;
  role: string | null;
  userId: string | null;
  mfaVerified: boolean;
  mfaRecentForPrivilegedActions: boolean;
  mfaAuthenticatedAt: string | null;
  authSource: string | null;
  ssoProvider: string | null;
  hydrated: boolean;
  sessionExpiresAt: number | null;
  lastVerifiedAt: number | null;
  setSession: (response: LoginResponse) => void;
  clearToken: () => void;
  clearSessionState: () => void;
  hydrate: () => Promise<void>;
  /** Returns seconds until token expires, or 0 if expired/missing */
  getTokenTTL: () => number;
  /** Returns true if the token will expire within REFRESH_BUFFER_SECONDS */
  isTokenExpiringSoon: () => boolean;
}

let hydratePromise: Promise<void> | null = null;

function getEmptyAuthState() {
  return {
    token: null,
    role: null,
    userId: null,
    mfaVerified: false,
    mfaRecentForPrivilegedActions: false,
    mfaAuthenticatedAt: null,
    authSource: null,
    ssoProvider: null,
    sessionExpiresAt: null,
    lastVerifiedAt: null,
  };
}

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
    mfaRecentForPrivilegedActions: Boolean(response.user?.mfa_recent_for_privileged_actions),
    mfaAuthenticatedAt: response.user?.mfa_authenticated_at ?? null,
    authSource: response.user?.auth_source ?? "local",
    ssoProvider: response.user?.sso_provider ?? null,
    sessionExpiresAt: getExpiryEpoch(response.expires_in),
    lastVerifiedAt: Date.now(),
  };
}

function getCookieSessionState(user: UserMe) {
  return {
    token: COOKIE_SESSION_TOKEN,
    role: user.role ?? null,
    userId: user.id ?? null,
    mfaVerified: Boolean(user.mfa_verified),
    mfaRecentForPrivilegedActions: Boolean(user.mfa_recent_for_privileged_actions),
    mfaAuthenticatedAt: user.mfa_authenticated_at ?? null,
    authSource: user.auth_source ?? "local",
    ssoProvider: user.sso_provider ?? null,
    sessionExpiresAt: null,
    lastVerifiedAt: Date.now(),
  };
}

function persistAuthSnapshot(snapshot: PersistedAuthSnapshot | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!snapshot?.token) {
    window.sessionStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(
    AUTH_SNAPSHOT_STORAGE_KEY,
    JSON.stringify(snapshot)
  );
  window.localStorage.removeItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
}

function readPersistedAuthSnapshot(): PersistedAuthSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw =
    window.sessionStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY) ??
    window.localStorage.getItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedAuthSnapshot;
    const verifiedAt = parsed.lastVerifiedAt ?? 0;

    if (!parsed.token || Date.now() - verifiedAt > AUTH_SNAPSHOT_RETENTION_MS) {
      window.sessionStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
      window.localStorage.removeItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
      return null;
    }

    const sanitized: PersistedAuthSnapshot = {
      token: parsed.token,
      role: parsed.role ?? null,
      userId: parsed.userId ?? null,
      mfaVerified: Boolean(parsed.mfaVerified),
      mfaRecentForPrivilegedActions: Boolean(parsed.mfaRecentForPrivilegedActions),
      mfaAuthenticatedAt: parsed.mfaAuthenticatedAt ?? null,
      authSource: parsed.authSource ?? "local",
      ssoProvider: parsed.ssoProvider ?? null,
      sessionExpiresAt: parsed.sessionExpiresAt ?? null,
      lastVerifiedAt: parsed.lastVerifiedAt ?? verifiedAt,
    };

    window.sessionStorage.setItem(AUTH_SNAPSHOT_STORAGE_KEY, JSON.stringify(sanitized));
    window.localStorage.removeItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return sanitized;
  } catch {
    window.sessionStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return null;
  }
}

function clearProtectedClientState() {
  persistAuthSnapshot(null);
  clearWorkspaceTabsState();
  clearPatientWorkspaceCache();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  role: null,
  userId: null,
  mfaVerified: false,
  mfaRecentForPrivilegedActions: false,
  mfaAuthenticatedAt: null,
  authSource: null,
  ssoProvider: null,
  hydrated: false,
  sessionExpiresAt: null,
  lastVerifiedAt: null,
  setSession: (response) => {
    const nextState = { ...getSessionState(response), hydrated: true };
    persistAuthSnapshot(nextState);
    set(nextState);
  },
  clearToken: () => {
    const activeToken = get().token ?? undefined;
    if (typeof window !== "undefined") {
      void import("@/lib/api")
        .then(({ logout }) => logout(activeToken))
        .catch(() => undefined);
    }
    clearProtectedClientState();
    set({
      ...getEmptyAuthState(),
      hydrated: true,
    });
  },
  clearSessionState: () => {
    clearProtectedClientState();
    set({
      ...getEmptyAuthState(),
      hydrated: true,
    });
  },
  hydrate: async () => {
    const persistedSnapshot = readPersistedAuthSnapshot();
    const currentState = get();
    const hasKnownSession = Boolean(persistedSnapshot?.token || currentState.token);

    if (!hasKnownSession) {
      if (!currentState.hydrated) {
        set({
          ...getEmptyAuthState(),
          hydrated: true,
        });
      }
      return;
    }

    if (
      currentState.hydrated &&
      currentState.token &&
      currentState.lastVerifiedAt &&
      Date.now() - currentState.lastVerifiedAt < AUTH_SNAPSHOT_REVALIDATE_AFTER_MS
    ) {
      return;
    }
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      try {
        const { fetchCurrentUser, refreshToken } = await import("@/lib/api");

        try {
          const currentUser = await fetchCurrentUser();
          if (currentUser) {
            const nextState = { ...getCookieSessionState(currentUser), hydrated: true };
            persistAuthSnapshot(nextState);
            set(nextState);
            return;
          }
        } catch {
          // Fall back to refresh-only hydration when /auth/me is unavailable.
        }

        const refreshed = await refreshToken();
        if (refreshed?.user) {
          const nextState = { ...getSessionState(refreshed), hydrated: true };
          persistAuthSnapshot(nextState);
          set(nextState);
          return;
        }
      } catch {
        // No valid session cookie or refresh failed.
      }

      clearProtectedClientState();
      set({
        ...getEmptyAuthState(),
        hydrated: true,
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
