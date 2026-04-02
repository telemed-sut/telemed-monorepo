import { create } from "zustand";

import type { LoginResponse, UserMe } from "@/lib/api";
import { clearWorkspaceTabsState } from "@/store/workspace-tabs-store";

/** Refresh token 5 minutes before expiry */
const REFRESH_BUFFER_SECONDS = 300;
const COOKIE_SESSION_TOKEN = "__cookie_session__";
const AUTH_SNAPSHOT_STORAGE_KEY = "telemed.auth.snapshot.v2";
const LEGACY_AUTH_SNAPSHOT_STORAGE_KEY = "telemed.auth.snapshot";
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
  privilegedRoles: string[];
  canManagePrivilegedAdmins: boolean;
  canManageSecurityRecovery: boolean;
  canBootstrapPrivilegedRoles: boolean;
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
  privilegedRoles: string[];
  canManagePrivilegedAdmins: boolean;
  canManageSecurityRecovery: boolean;
  canBootstrapPrivilegedRoles: boolean;
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
    privilegedRoles: response.user?.privileged_roles ?? [],
    canManagePrivilegedAdmins: Boolean(response.user?.can_manage_privileged_admins),
    canManageSecurityRecovery: Boolean(response.user?.can_manage_security_recovery),
    canBootstrapPrivilegedRoles: Boolean(response.user?.can_bootstrap_privileged_roles),
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
    privilegedRoles: user.privileged_roles ?? [],
    canManagePrivilegedAdmins: Boolean(user.can_manage_privileged_admins),
    canManageSecurityRecovery: Boolean(user.can_manage_security_recovery),
    canBootstrapPrivilegedRoles: Boolean(user.can_bootstrap_privileged_roles),
    sessionExpiresAt: null,
    lastVerifiedAt: Date.now(),
  };
}

function persistAuthSnapshot(snapshot: PersistedAuthSnapshot | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!snapshot?.token) {
    window.localStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    AUTH_SNAPSHOT_STORAGE_KEY,
    JSON.stringify(snapshot)
  );
  window.sessionStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
}

function readPersistedAuthSnapshot(): PersistedAuthSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw =
    window.localStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY) ??
    window.sessionStorage.getItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedAuthSnapshot;
    const verifiedAt = parsed.lastVerifiedAt ?? 0;

    if (!parsed.token || Date.now() - verifiedAt > AUTH_SNAPSHOT_RETENTION_MS) {
      window.localStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
      window.sessionStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
      return null;
    }

    window.localStorage.setItem(AUTH_SNAPSHOT_STORAGE_KEY, JSON.stringify(parsed));
    window.sessionStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return parsed;
  } catch {
    window.localStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_AUTH_SNAPSHOT_STORAGE_KEY);
    return null;
  }
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
  privilegedRoles: [],
  canManagePrivilegedAdmins: false,
  canManageSecurityRecovery: false,
  canBootstrapPrivilegedRoles: false,
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
    persistAuthSnapshot(null);
    clearWorkspaceTabsState();
    set({
      token: null,
      role: null,
      userId: null,
      mfaVerified: false,
      mfaRecentForPrivilegedActions: false,
      mfaAuthenticatedAt: null,
      authSource: null,
      ssoProvider: null,
      privilegedRoles: [],
      canManagePrivilegedAdmins: false,
      canManageSecurityRecovery: false,
      canBootstrapPrivilegedRoles: false,
      hydrated: true,
      sessionExpiresAt: null,
      lastVerifiedAt: null,
    });
  },
  clearSessionState: () => {
    persistAuthSnapshot(null);
    clearWorkspaceTabsState();
    set({
      token: null,
      role: null,
      userId: null,
      mfaVerified: false,
      mfaRecentForPrivilegedActions: false,
      mfaAuthenticatedAt: null,
      authSource: null,
      ssoProvider: null,
      privilegedRoles: [],
      canManagePrivilegedAdmins: false,
      canManageSecurityRecovery: false,
      canBootstrapPrivilegedRoles: false,
      hydrated: true,
      sessionExpiresAt: null,
      lastVerifiedAt: null,
    });
  },
  hydrate: async () => {
    const persistedSnapshot = readPersistedAuthSnapshot();
    const currentState = get();
    const hasKnownSession = Boolean(persistedSnapshot?.token || currentState.token);

    if (!currentState.hydrated && persistedSnapshot?.token) {
      set({
        token: persistedSnapshot.token,
        role: persistedSnapshot.role,
        userId: persistedSnapshot.userId,
        mfaVerified: persistedSnapshot.mfaVerified,
        mfaRecentForPrivilegedActions: persistedSnapshot.mfaRecentForPrivilegedActions ?? false,
        mfaAuthenticatedAt: persistedSnapshot.mfaAuthenticatedAt ?? null,
        authSource: persistedSnapshot.authSource ?? "local",
        ssoProvider: persistedSnapshot.ssoProvider ?? null,
        privilegedRoles: persistedSnapshot.privilegedRoles ?? [],
        canManagePrivilegedAdmins: persistedSnapshot.canManagePrivilegedAdmins ?? false,
        canManageSecurityRecovery: persistedSnapshot.canManageSecurityRecovery ?? false,
        canBootstrapPrivilegedRoles: persistedSnapshot.canBootstrapPrivilegedRoles ?? false,
        hydrated: true,
        sessionExpiresAt: persistedSnapshot.sessionExpiresAt,
        lastVerifiedAt: persistedSnapshot.lastVerifiedAt,
      });
    }

    if (!hasKnownSession) {
      if (!currentState.hydrated) {
        set({
          token: null,
          role: null,
          userId: null,
          mfaVerified: false,
          mfaRecentForPrivilegedActions: false,
          mfaAuthenticatedAt: null,
          authSource: null,
          ssoProvider: null,
          privilegedRoles: [],
          canManagePrivilegedAdmins: false,
          canManageSecurityRecovery: false,
          canBootstrapPrivilegedRoles: false,
          hydrated: true,
          sessionExpiresAt: null,
          lastVerifiedAt: null,
        });
      }
      return;
    }

    const nextState = get();
    if (
      nextState.hydrated &&
      nextState.token &&
      nextState.lastVerifiedAt &&
      Date.now() - nextState.lastVerifiedAt < AUTH_SNAPSHOT_REVALIDATE_AFTER_MS
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

      persistAuthSnapshot(null);
      set({
        token: null,
        role: null,
        userId: null,
        mfaVerified: false,
        mfaRecentForPrivilegedActions: false,
        mfaAuthenticatedAt: null,
        authSource: null,
        ssoProvider: null,
        privilegedRoles: [],
        canManagePrivilegedAdmins: false,
        canManageSecurityRecovery: false,
        canBootstrapPrivilegedRoles: false,
        hydrated: true,
        sessionExpiresAt: null,
        lastVerifiedAt: null,
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
