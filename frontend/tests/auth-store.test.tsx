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
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("keeps a cookie-backed session when /auth/me succeeds but refresh fails", async () => {
    fetchCurrentUserMock.mockResolvedValue({
      id: "doctor-1",
      email: "doctor@example.com",
      first_name: "Doctor",
      last_name: "Example",
      role: "doctor",
      mfa_verified: true,
      is_super_admin: false,
    });
    refreshTokenMock.mockRejectedValue(new Error("csrf blocked"));

    const { useAuthStore } = await import("@/store/auth-store");

    await useAuthStore.getState().hydrate();

    const state = useAuthStore.getState();
    expect(fetchCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    expect(state.hydrated).toBe(true);
    expect(state.token).toBe("__cookie_session__");
    expect(state.role).toBe("doctor");
    expect(state.userId).toBe("doctor-1");
    expect(state.sessionExpiresAt).toBeNull();
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
      isSuperAdmin: false,
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
