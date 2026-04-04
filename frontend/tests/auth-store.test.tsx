import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchCurrentUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("@/lib/api", () => ({
  fetchCurrentUser: fetchCurrentUserMock,
  refreshToken: refreshTokenMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

describe("auth store hydration", () => {
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
    window.localStorage.setItem(
      "telemed.auth.snapshot.v3",
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
    expect(state.sessionExpiresAt).toBeNull();
    expect(window.localStorage.getItem("telemed.auth.snapshot.v3")).toContain(
      "\"userId\":\"doctor-1\""
    );
  });

  it("skips remote auth probes when there is no known session snapshot", async () => {
    const { useAuthStore } = await import("@/store/auth-store");

    await useAuthStore.getState().hydrate();

    const state = useAuthStore.getState();
    expect(fetchCurrentUserMock).not.toHaveBeenCalled();
    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(state.hydrated).toBe(true);
    expect(state.token).toBeNull();
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
    });

    render(<Harness />);
    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe("__cookie_session__");
  });
});
