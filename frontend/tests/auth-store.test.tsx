import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchCurrentUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const replaceMock = vi.fn();
const AUTH_SNAPSHOT_STORAGE_KEY = "telemed.auth.snapshot.v3";
const PATIENT_CACHE_KEY =
  "telemed.patient-workspace.detail.v2:doctor-1:patient-1";
const INVITEES_DRAFT_KEY = "month-calendar-popover-invitees:meeting-1";
const COMPOSER_DRAFT_KEY = "month-calendar-popover-composer:doctor-1";
const CREATE_EVENT_DRAFT_KEY = "meetings-create-event-draft:doctor-1";

vi.mock("@/lib/api", () => ({
  fetchCurrentUser: fetchCurrentUserMock,
  getLoginRedirectPath: vi.fn(
    (reason = "session_missing") => `/login?error=session_expired&reason=${reason}`,
  ),
  refreshToken: refreshTokenMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

describe("auth store hydration", () => {
  function seedProtectedDraftState() {
    window.localStorage.setItem(INVITEES_DRAFT_KEY, "invitee@example.com");
    window.sessionStorage.setItem(
      COMPOSER_DRAFT_KEY,
      JSON.stringify({
        dateKey: "2026-04-10",
        startHour: 9,
        startMinute: 0,
        endHour: 10,
        endMinute: 0,
        description: "Follow up",
        patientId: "patient-1",
        doctorId: "doctor-1",
        room: "Telemed",
        note: "Keep private",
      })
    );
    window.sessionStorage.setItem(
      CREATE_EVENT_DRAFT_KEY,
      JSON.stringify({
        selectedDateKey: "2026-04-10",
        startHour: 9,
        startMinute: 0,
        endHour: 10,
        endMinute: 0,
        patientId: "patient-1",
        doctorId: "doctor-1",
        description: "New consult",
        room: "Room 12",
        note: "Sensitive draft",
      })
    );
  }

  beforeEach(() => {
    fetchCurrentUserMock.mockReset();
    refreshTokenMock.mockReset();
    replaceMock.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("keeps a cookie-backed session and persists a local snapshot when /auth/me succeeds", async () => {
    window.sessionStorage.setItem(
      AUTH_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        token: "__cookie_session__",
        role: "doctor",
        userId: "doctor-1",
        mfaVerified: true,
        mfaRecentForPrivilegedActions: true,
        mfaAuthenticatedAt: "2026-03-30T01:00:00.000Z",
        authSource: "local",
        ssoProvider: null,
        sessionExpiresAt: null,
        lastVerifiedAt: Date.now() - 10 * 60 * 1000,
      })
    );
    fetchCurrentUserMock.mockResolvedValue({
      id: "doctor-1",
      email: "doctor@example.com",
      first_name: "Doctor",
      last_name: "Example",
      role: "doctor",
      mfa_verified: true,
      mfa_recent_for_privileged_actions: true,
      mfa_authenticated_at: "2026-03-30T01:00:00.000Z",
      auth_source: "local",
      sso_provider: null,
    });
    refreshTokenMock.mockRejectedValue(new Error("csrf blocked"));

    const { useAuthStore } = await import("@/store/auth-store");

    await useAuthStore.getState().hydrate();

    const state = useAuthStore.getState();
    expect(fetchCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(state.hydrated).toBe(true);
    expect(state.token).toBe("__cookie_session__");
    expect(state.role).toBe("doctor");
    expect(state.userId).toBe("doctor-1");
    expect(state.currentUser?.email).toBe("doctor@example.com");
    expect(state.sessionExpiresAt).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY)).toContain(
      "\"userId\":\"doctor-1\""
    );
  });

  it("treats a persisted snapshot as an auth candidate until remote validation succeeds", async () => {
    window.sessionStorage.setItem(
      AUTH_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        token: "__cookie_session__",
        role: "doctor",
        userId: "doctor-1",
        mfaVerified: true,
        mfaRecentForPrivilegedActions: true,
        mfaAuthenticatedAt: "2026-03-30T01:00:00.000Z",
        authSource: "local",
        ssoProvider: null,
        sessionExpiresAt: null,
        lastVerifiedAt: Date.now(),
      })
    );
    fetchCurrentUserMock.mockImplementation(() => new Promise(() => undefined));

    const { useAuthStore } = await import("@/store/auth-store");

    void useAuthStore.getState().hydrate();
    await Promise.resolve();

    expect(useAuthStore.getState().hydrated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("skips remote auth probes when there is no known session snapshot", async () => {
    const { useAuthStore } = await import("@/store/auth-store");

    await useAuthStore.getState().hydrate();

    const state = useAuthStore.getState();
    expect(fetchCurrentUserMock).not.toHaveBeenCalled();
    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(state.hydrated).toBe(true);
    expect(state.token).toBeNull();
    expect(state.currentUser).toBeNull();
  });

  it("clears persisted auth and protected cache when remote revalidation fails", async () => {
    window.sessionStorage.setItem(
      AUTH_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        token: "__cookie_session__",
        role: "doctor",
        userId: "doctor-1",
        mfaVerified: true,
        mfaRecentForPrivilegedActions: true,
        mfaAuthenticatedAt: "2026-03-30T01:00:00.000Z",
        authSource: "local",
        ssoProvider: null,
        sessionExpiresAt: null,
        lastVerifiedAt: Date.now(),
      })
    );
    window.localStorage.setItem(
      PATIENT_CACHE_KEY,
      JSON.stringify({
        version: 2,
        data: {
          patient: { id: "patient-1", first_name: "Jane" },
          patientCachedAt: Date.now(),
          meetings: [],
          meetingsTotal: 0,
          meetingsCachedAt: Date.now(),
        },
      })
    );
    seedProtectedDraftState();
    fetchCurrentUserMock.mockRejectedValue(new Error("session missing"));
    refreshTokenMock.mockRejectedValue(new Error("refresh failed"));

    const { useAuthStore } = await import("@/store/auth-store");

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().hydrated).toBe(true);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PATIENT_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem(INVITEES_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(CREATE_EVENT_DRAFT_KEY)).toBeNull();
  });

  it("replaces the in-memory current user when a new session is set", async () => {
    const { useAuthStore } = await import("@/store/auth-store");

    useAuthStore.getState().setSession({
      access_token: "__cookie_session__",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id: "admin-1",
        email: "admin@emedhelp.example.com",
        first_name: "System",
        last_name: "Admin",
        role: "admin",
        mfa_verified: true,
        mfa_recent_for_privileged_actions: true,
        mfa_authenticated_at: "2026-03-30T01:00:00.000Z",
        auth_source: "local",
        sso_provider: null,
      },
    });

    useAuthStore.getState().setSession({
      access_token: "__cookie_session__",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id: "doctor-1",
        email: "ppansiunn@gmail.com",
        first_name: "1x",
        last_name: "2b",
        role: "doctor",
        mfa_verified: true,
        mfa_recent_for_privileged_actions: true,
        mfa_authenticated_at: "2026-03-30T01:00:00.000Z",
        auth_source: "local",
        sso_provider: null,
      },
    });

    const state = useAuthStore.getState();
    expect(state.userId).toBe("doctor-1");
    expect(state.role).toBe("doctor");
    expect(state.currentUser?.email).toBe("ppansiunn@gmail.com");
    expect(state.currentUser?.id).toBe("doctor-1");
  });

  it("clears protected drafts when clearToken runs", async () => {
    const { useAuthStore } = await import("@/store/auth-store");

    seedProtectedDraftState();
    useAuthStore.setState({
      token: "__cookie_session__",
      role: "doctor",
      userId: "doctor-1",
      hydrated: true,
    });

    useAuthStore.getState().clearToken();

    expect(window.localStorage.getItem(INVITEES_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(CREATE_EVENT_DRAFT_KEY)).toBeNull();
  });

  it("clears protected drafts when clearSessionState runs", async () => {
    const { useAuthStore } = await import("@/store/auth-store");

    seedProtectedDraftState();
    useAuthStore.setState({
      token: "__cookie_session__",
      role: "doctor",
      userId: "doctor-1",
      hydrated: true,
    });

    useAuthStore.getState().clearSessionState();

    expect(window.localStorage.getItem(INVITEES_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(CREATE_EVENT_DRAFT_KEY)).toBeNull();
  });

  it("clears protected drafts when the authenticated user switches", async () => {
    const { useAuthStore } = await import("@/store/auth-store");

    useAuthStore.getState().setSession({
      access_token: "__cookie_session__",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id: "admin-1",
        email: "admin@emedhelp.example.com",
        first_name: "System",
        last_name: "Admin",
        role: "admin",
        mfa_verified: true,
        mfa_recent_for_privileged_actions: true,
        mfa_authenticated_at: "2026-03-30T01:00:00.000Z",
        auth_source: "local",
        sso_provider: null,
      },
    });
    seedProtectedDraftState();

    useAuthStore.getState().setSession({
      access_token: "__cookie_session__",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id: "doctor-1",
        email: "ppansiunn@gmail.com",
        first_name: "1x",
        last_name: "2b",
        role: "doctor",
        mfa_verified: true,
        mfa_recent_for_privileged_actions: true,
        mfa_authenticated_at: "2026-03-30T01:00:00.000Z",
        auth_source: "local",
        sso_provider: null,
      },
    });

    expect(window.localStorage.getItem(INVITEES_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(CREATE_EVENT_DRAFT_KEY)).toBeNull();
  });

  it("does not force logout when a cookie-backed session has no known expiry yet", async () => {
    const { useAuthStore } = await import("@/store/auth-store");
    const { useTokenRefresh } = await import("@/hooks/use-token-refresh");

    function Harness() {
      useTokenRefresh();
      return null;
    }

    useAuthStore.setState({
      token: "__cookie_session__",
      role: "doctor",
      userId: "doctor-1",
      mfaVerified: true,
      mfaRecentForPrivilegedActions: true,
      mfaAuthenticatedAt: "2026-03-30T01:00:00.000Z",
      authSource: "local",
      ssoProvider: null,
      hydrated: true,
      sessionExpiresAt: null,
      lastVerifiedAt: Date.now(),
    });

    render(<Harness />);
    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe("__cookie_session__");
  });

  it("routes expired tokens to login with a reason code", async () => {
    const { useAuthStore } = await import("@/store/auth-store");
    const { useTokenRefresh } = await import("@/hooks/use-token-refresh");

    function Harness() {
      useTokenRefresh();
      return null;
    }

    useAuthStore.setState({
      token: "__cookie_session__",
      role: "admin",
      userId: "admin-1",
      mfaVerified: true,
      mfaRecentForPrivilegedActions: true,
      mfaAuthenticatedAt: "2026-03-30T01:00:00.000Z",
      authSource: "local",
      ssoProvider: null,
      hydrated: true,
      sessionExpiresAt: Date.now() - 1_000,
      lastVerifiedAt: Date.now(),
    });

    render(<Harness />);
    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(replaceMock).toHaveBeenCalledWith(
      "/login?error=session_expired&reason=token_expired",
    );
  });
});
