import { create } from "zustand";

import type { LoginResponse, UserMe } from "@/lib/api-types";
import { clearPatientWorkspaceCache } from "@/lib/patient-workspace-cache";
import { clearProtectedClientStorage } from "@/lib/protected-client-state";
import {
  clearPersistedWorkspaceTabs,
  clearWorkspaceTabsState,
} from "@/store/workspace-tabs-store";

/** Refresh token 5 minutes before expiry */
const REFRESH_BUFFER_SECONDS = 300;
const COOKIE_SESSION_TOKEN = "__cookie_session__";
const AUTH_SNAPSHOT_STORAGE_KEY = "telemed.auth.snapshot.v3";
const REFRESH_MUTEX_STORAGE_KEY = "telemed.auth.refresh_mutex";
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
  currentUser: UserMe | null;
  mfaVerified: boolean;
  mfaRecentForPrivilegedActions: boolean;
  mfaAuthenticatedAt: string | null;
  authSource: string | null;
  ssoProvider: string | null;
  hydrated: boolean;
  sessionExpiresAt: number | null;
  lastVerifiedAt: number | null;
  setSession: (response: LoginResponse) => void;
  setCurrentUser: (user: UserMe | null) => void;
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
    currentUser: null,
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
    currentUser: response.user ?? null,
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
    currentUser: user,
    mfaVerified: Boolean(user.mfa_verified),
    mfaRecentForPrivilegedActions: Boolean(user.mfa_recent_for_privileged_actions),
    mfaAuthenticatedAt: user.mfa_authenticated_at ?? null,
    authSource: user.auth_source ?? "local",
    ssoProvider: user.sso_provider ?? null,
    sessionExpiresAt: null,
    lastVerifiedAt: Date.now(),
  };
}

function createPersistedSnapshot(state: {
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
}): PersistedAuthSnapshot | null {
  // We no longer persist the raw token (JWT) to localStorage for security.
  // Instead, we persist a static placeholder "__cookie_session__" to indicate
  // that a session exists in the HttpOnly cookie. This allows other tabs to 
  // know they should attempt hydration via /me without exposing the real token to XSS.
  if (!state.userId || !state.token) {
    return null;
  }

  return {
    token: COOKIE_SESSION_TOKEN,
    role: state.role,
    userId: state.userId,
    mfaVerified: state.mfaVerified,
    mfaRecentForPrivilegedActions: state.mfaRecentForPrivilegedActions,
    mfaAuthenticatedAt: state.mfaAuthenticatedAt,
    authSource: state.authSource,
    ssoProvider: state.ssoProvider,
    sessionExpiresAt: state.sessionExpiresAt,
    lastVerifiedAt: state.lastVerifiedAt,
  };
}

function persistAuthSnapshot(snapshot: PersistedAuthSnapshot | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!snapshot?.userId || !snapshot?.token) {
    window.localStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
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
    window.localStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY) ??
    window.localStorage.getItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedAuthSnapshot;
    const verifiedAt = parsed.lastVerifiedAt ?? 0;

    if (!parsed.token || Date.now() - verifiedAt > AUTH_SNAPSHOT_RETENTION_MS) {
      window.localStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
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

    window.localStorage.setItem(AUTH_SNAPSHOT_STORAGE_KEY, JSON.stringify(sanitized));
    window.localStorage.removeItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return sanitized;
  } catch {
    window.localStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(PREVIOUS_AUTH_SNAPSHOT_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return null;
  }
}

function clearProtectedClientState() {
  persistAuthSnapshot(null);
  clearWorkspaceTabsState();
  clearPersistedWorkspaceTabs();
  clearPatientWorkspaceCache();
  clearProtectedClientStorage();
}

function shouldClearProtectedStateForUserSwitch(
  previousUserId: string | null,
  nextUserId: string | null
) {
  return Boolean(previousUserId && nextUserId && previousUserId !== nextUserId);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  role: null,
  userId: null,
  currentUser: null,
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
    if (shouldClearProtectedStateForUserSwitch(get().userId, nextState.userId)) {
      clearProtectedClientState();
    }
    persistAuthSnapshot(createPersistedSnapshot(nextState));
    set(nextState);
  },
  setCurrentUser: (user) => {
    set((state) => {
      const nextState = user
        ? {
            ...state,
            currentUser: user,
            role: user.role ?? state.role,
            userId: user.id ?? state.userId,
            mfaVerified: Boolean(user.mfa_verified),
            mfaRecentForPrivilegedActions: Boolean(user.mfa_recent_for_privileged_actions),
            mfaAuthenticatedAt: user.mfa_authenticated_at ?? null,
            authSource: user.auth_source ?? state.authSource ?? "local",
            ssoProvider: user.sso_provider ?? null,
            lastVerifiedAt: Date.now(),
          }
        : {
            ...state,
            currentUser: null,
          };

      if (shouldClearProtectedStateForUserSwitch(state.userId, nextState.userId)) {
        clearProtectedClientState();
      }
      persistAuthSnapshot(createPersistedSnapshot(nextState));
      return nextState;
    });
  },
  clearToken: () => {
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
  /**
   * Initializes the auth state from persistence or server.
   * If a persisted snapshot exists, it hydrates immediately to avoid flicker,
   * then optionally re-verifies with the server.
   */
  hydrate: async () => {
    const persistedSnapshot = readPersistedAuthSnapshot();
    const currentState = get();
    
    // Hydrate from localStorage first if available to provide immediate UI state
    if (persistedSnapshot && !currentState.hydrated) {
       set({
         ...currentState,
         ...persistedSnapshot,
         hydrated: true,
       });
    }

    const hasKnownSession = Boolean(persistedSnapshot?.token || currentState.token);

    if (!hasKnownSession) {
      if (!get().hydrated) {
        set({
          ...getEmptyAuthState(),
          hydrated: true,
        });
      }
      return;
    }

    // Skip re-verification if recently verified
    if (
      get().hydrated &&
      get().token &&
      get().lastVerifiedAt &&
      Date.now() - get().lastVerifiedAt < AUTH_SNAPSHOT_REVALIDATE_AFTER_MS
    ) {
      return;
    }
    
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      // Phase 2 Mutex: Prevent concurrent refreshes from multiple tabs
      const acquireLock = () => {
        const now = Date.now();
        const lock = window.localStorage.getItem(REFRESH_MUTEX_STORAGE_KEY);
        if (lock) {
          try {
            const { ts } = JSON.parse(lock);
            // Lock is considered stale after 15 seconds
            if (now - ts < 15000) return false;
          } catch {
             return true;
          }
        }
        window.localStorage.setItem(REFRESH_MUTEX_STORAGE_KEY, JSON.stringify({ ts: now }));
        return true;
      };

      const releaseLock = () => {
        window.localStorage.removeItem(REFRESH_MUTEX_STORAGE_KEY);
      };

      try {
        const { fetchCurrentUser, refreshToken } = await import("@/lib/api-auth");

        try {
          // Attempt to fetch user using the HttpOnly cookie
          const currentUser = await fetchCurrentUser();
          if (currentUser) {
            const nextState = { ...getCookieSessionState(currentUser), hydrated: true };
            if (shouldClearProtectedStateForUserSwitch(get().userId, nextState.userId)) {
              clearProtectedClientState();
            }
            persistAuthSnapshot(createPersistedSnapshot(nextState));
            set(nextState);
            return;
          }
        } catch {
          // Fall back to refresh-only hydration when /auth/me is unavailable.
        }

        // Try to acquire lock for refresh if /me failed
        if (!acquireLock()) {
          // Wait a bit and check if another tab already succeeded
          await new Promise(resolve => setTimeout(resolve, 1000));
          const freshSnapshot = readPersistedAuthSnapshot();
          if (freshSnapshot?.token) {
            set({ ...getEmptyAuthState(), ...freshSnapshot, hydrated: true });
            return;
          }
        }

        try {
          const refreshed = await refreshToken();
          if (refreshed?.user) {
            const nextState = { ...getSessionState(refreshed), hydrated: true };
            if (shouldClearProtectedStateForUserSwitch(get().userId, nextState.userId)) {
              clearProtectedClientState();
            }
            persistAuthSnapshot(createPersistedSnapshot(nextState));
            set(nextState);
            return;
          }
        } finally {
          releaseLock();
        }
      } catch {
        // No valid session cookie or refresh failed.
      }

      // If all attempts fail, the user is definitely not logged in.
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

// Cross-tab synchronization logic
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === AUTH_SNAPSHOT_STORAGE_KEY) {
      // Something changed in another tab (Login or Logout)
      // Re-hydrate the state to match the new reality
      void useAuthStore.getState().hydrate();
    }
  });
}
