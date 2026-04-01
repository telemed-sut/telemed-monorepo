import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const assignMock = vi.fn();
const logoutMock = vi.fn().mockResolvedValue({ message: "Successfully logged out" });
const originalLocation = window.location;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    logout: logoutMock,
  };
});

describe("useSessionLogout", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    assignMock.mockReset();
    logoutMock.mockClear();
    window.localStorage.clear();
    window.sessionStorage.clear();
    delete (window as { location?: Location }).location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: assignMock,
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as { location?: Location }).location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.resetModules();
  });

  it("federates logout for SSO-backed sessions", async () => {
    const { useAuthStore } = await import("@/store/auth-store");
    const { useSessionLogout } = await import("@/hooks/use-session-logout");

    function Harness() {
      const logout = useSessionLogout();
      return <button onClick={logout}>logout</button>;
    }

    useAuthStore.setState({
      authSource: "sso",
      token: "__cookie_session__",
      hydrated: true,
    });

    const { getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: "logout" }));

    expect(assignMock).toHaveBeenCalledWith("/api/auth/admin/sso/logout");
    expect(replaceMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().authSource).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("routes local sessions to /login and revokes the backend session", async () => {
    const { useAuthStore } = await import("@/store/auth-store");
    const { useSessionLogout } = await import("@/hooks/use-session-logout");

    function Harness() {
      const logout = useSessionLogout();
      return <button onClick={logout}>logout</button>;
    }

    useAuthStore.setState({
      authSource: "local",
      token: "__cookie_session__",
      hydrated: true,
    });

    const { getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: "logout" }));

    expect(replaceMock).toHaveBeenCalledWith("/login");
    expect(assignMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledWith("__cookie_session__");
    });
    expect(useAuthStore.getState().authSource).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("routes unknown sessions to /login and revokes the backend session", async () => {
    const { useAuthStore } = await import("@/store/auth-store");
    const { useSessionLogout } = await import("@/hooks/use-session-logout");

    function Harness() {
      const logout = useSessionLogout();
      return <button onClick={logout}>logout</button>;
    }

    useAuthStore.setState({
      authSource: null,
      token: "__cookie_session__",
      hydrated: true,
    });

    const { getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: "logout" }));

    expect(replaceMock).toHaveBeenCalledWith("/login");
    expect(assignMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledWith("__cookie_session__");
    });
    expect(useAuthStore.getState().authSource).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });
});
