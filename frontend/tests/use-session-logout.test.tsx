import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const assignMock = vi.fn();
const logoutMock = vi.fn().mockResolvedValue({ message: "Successfully logged out" });
const logoutAdminSsoMock = vi.fn().mockResolvedValue({ redirect_url: "https://auth.example.com/logout?id_token_hint=server-side-id-token" });
const originalLocation = window.location;
const WORKSPACE_TABS_STORAGE_KEY = "workspace_tabs_state_v3";
const PATIENT_CACHE_KEY =
  "telemed.patient-workspace.detail.v2:user-a:patient-1";
const INVITEES_DRAFT_KEY = "month-calendar-popover-invitees:meeting-1";
const COMPOSER_DRAFT_KEY = "month-calendar-popover-composer:user-a";
const CREATE_EVENT_DRAFT_KEY = "meetings-create-event-draft:user-a";

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
    logoutAdminSso: logoutAdminSsoMock,
  };
});

describe("useSessionLogout", () => {
  function createWorkspaceTabsStorage(ownerUserId: string) {
    return JSON.stringify({
      [ownerUserId]: {
        tabs: [],
        recentWorkspaces: [],
        activeTabId: null,
        homeHref: "/patients",
        ownerUserId,
      },
    });
  }

  beforeEach(() => {
    replaceMock.mockReset();
    assignMock.mockReset();
    logoutMock.mockClear();
    logoutAdminSsoMock.mockClear();
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
    window.localStorage.setItem(
      WORKSPACE_TABS_STORAGE_KEY,
      createWorkspaceTabsStorage("user-a")
    );
    window.localStorage.setItem(
      PATIENT_CACHE_KEY,
      JSON.stringify({ version: 2, data: { patient: { id: "patient-1" } } })
    );
    window.localStorage.setItem(INVITEES_DRAFT_KEY, "invitee@example.com");
    window.sessionStorage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify({ patientId: "patient-1" }));
    window.sessionStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify({ patientId: "patient-1" }));

    const { getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: "logout" }));

    await waitFor(() => {
      expect(logoutAdminSsoMock).toHaveBeenCalledTimes(1);
      expect(assignMock).toHaveBeenCalledWith("https://auth.example.com/logout?id_token_hint=server-side-id-token");
    });
    expect(replaceMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().authSource).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY)).toBe(
      createWorkspaceTabsStorage("user-a")
    );
    expect(window.localStorage.getItem(PATIENT_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem(INVITEES_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(CREATE_EVENT_DRAFT_KEY)).toBeNull();
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
    window.localStorage.setItem(
      WORKSPACE_TABS_STORAGE_KEY,
      createWorkspaceTabsStorage("user-a")
    );
    window.localStorage.setItem(
      PATIENT_CACHE_KEY,
      JSON.stringify({ version: 2, data: { patient: { id: "patient-1" } } })
    );
    window.localStorage.setItem(INVITEES_DRAFT_KEY, "invitee@example.com");
    window.sessionStorage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify({ patientId: "patient-1" }));
    window.sessionStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify({ patientId: "patient-1" }));

    const { getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: "logout" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login");
      expect(logoutMock).toHaveBeenCalledWith("__cookie_session__");
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().authSource).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY)).toBe(
      createWorkspaceTabsStorage("user-a")
    );
    expect(window.localStorage.getItem(PATIENT_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem(INVITEES_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(CREATE_EVENT_DRAFT_KEY)).toBeNull();
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
    window.localStorage.setItem(
      WORKSPACE_TABS_STORAGE_KEY,
      createWorkspaceTabsStorage("user-a")
    );
    window.localStorage.setItem(
      PATIENT_CACHE_KEY,
      JSON.stringify({ version: 2, data: { patient: { id: "patient-1" } } })
    );
    window.localStorage.setItem(INVITEES_DRAFT_KEY, "invitee@example.com");
    window.sessionStorage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify({ patientId: "patient-1" }));
    window.sessionStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify({ patientId: "patient-1" }));

    const { getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: "logout" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login");
      expect(logoutMock).toHaveBeenCalledWith("__cookie_session__");
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().authSource).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY)).toBe(
      createWorkspaceTabsStorage("user-a")
    );
    expect(window.localStorage.getItem(PATIENT_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem(INVITEES_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(CREATE_EVENT_DRAFT_KEY)).toBeNull();
  });
});
