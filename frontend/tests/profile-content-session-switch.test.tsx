import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const fetchCurrentUserMock = vi.fn();
const updateUserMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    fetchCurrentUser: fetchCurrentUserMock,
    updateUser: updateUserMock,
  };
});

describe("ProfileContent session switching", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    fetchCurrentUserMock.mockReset();
    updateUserMock.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("rebinds the rendered profile when the authenticated user changes", async () => {
    const { useAuthStore } = await import("@/store/auth-store");
    const { ProfileContent } = await import("@/components/dashboard/profile-content");

    fetchCurrentUserMock.mockImplementation(async () => {
      return useAuthStore.getState().currentUser;
    });

    useAuthStore.setState({
      token: "__cookie_session__",
      role: "doctor",
      userId: "doctor-1",
      currentUser: {
        id: "doctor-1",
        email: "ppansiunn@gmail.com",
        first_name: "1x",
        last_name: "2b",
        role: "doctor",
        verification_status: "verified",
        mfa_verified: true,
        mfa_recent_for_privileged_actions: true,
        mfa_authenticated_at: "2026-04-09T14:00:00.000Z",
        auth_source: "local",
        sso_provider: null,
      },
      hydrated: true,
    });

    render(<ProfileContent />);

    expect(await screen.findByDisplayValue("ppansiunn@gmail.com")).toBeInTheDocument();

    act(() => {
      useAuthStore.setState({
        ...useAuthStore.getState(),
        role: "admin",
        userId: "admin-1",
        currentUser: {
          id: "admin-1",
          email: "admin@emedhelp.example.com",
          first_name: "System",
          last_name: "Admin",
          role: "admin",
          verification_status: "verified",
          mfa_verified: true,
          mfa_recent_for_privileged_actions: true,
          mfa_authenticated_at: "2026-04-09T14:05:00.000Z",
          auth_source: "local",
          sso_provider: null,
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("admin@emedhelp.example.com"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("ppansiunn@gmail.com")).not.toBeInTheDocument();
  });
});
