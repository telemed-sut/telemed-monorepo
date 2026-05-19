import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockFetchCurrentUser,
  mockStepUpAuth,
  mockSetSession,
  mockSetCurrentUser,
  mockClearToken,
  mockAuthState,
  mockLanguageState,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockFetchCurrentUser: vi.fn(),
  mockStepUpAuth: vi.fn(),
  mockSetSession: vi.fn(),
  mockSetCurrentUser: vi.fn(),
  mockClearToken: vi.fn(),
  mockAuthState: {
    token: "session-token",
    userId: null as string | null,
    currentUser: null as { email?: string | null } | null,
    authSource: "local",
    ssoProvider: null,
    setSession: vi.fn(),
    setCurrentUser: vi.fn(),
    clearToken: vi.fn(),
  },
  mockLanguageState: {
    language: "en" as const,
  },
  mockToastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchCurrentUser: mockFetchCurrentUser,
    stepUpAuth: mockStepUpAuth,
  };
});

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof mockLanguageState) => unknown) => selector(mockLanguageState),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: mockToastSuccess,
  },
}));

describe("SensitiveActionReauthDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.userId = null;
    mockAuthState.currentUser = null;
    mockAuthState.authSource = "local";
    mockAuthState.ssoProvider = null;
    mockAuthState.setSession = mockSetSession;
    mockAuthState.setCurrentUser = mockSetCurrentUser;
    mockAuthState.clearToken = mockClearToken;
    mockFetchCurrentUser.mockResolvedValue({
      id: "admin-user",
      email: "admin@example.com",
      auth_source: "local",
      sso_provider: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("blocks submit when the password is missing", async () => {
    const onOpenChange = vi.fn();
    const { SensitiveActionReauthDialog } = await import(
      "@/components/dashboard/sensitive-action-reauth-dialog"
    );

    render(
      <SensitiveActionReauthDialog
        open
        onOpenChange={onOpenChange}
      />
    );

    await waitFor(() => {
      expect(mockFetchCurrentUser).toHaveBeenCalledWith("session-token");
      expect(screen.getByDisplayValue("admin@example.com")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        "Use the same password you use to sign in as admin@example.com."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));

    expect(await screen.findByText("Please enter your password.")).toBeInTheDocument();
    expect(mockStepUpAuth).not.toHaveBeenCalled();
  });

  it("uses the live auth source and shows SSO guidance when the current session is SSO-backed", async () => {
    mockAuthState.authSource = "local";
    mockFetchCurrentUser.mockResolvedValue({
      id: "admin-user",
      email: "admin@example.com",
      auth_source: "sso",
      sso_provider: "Okta",
    });

    const onOpenChange = vi.fn();
    const { SensitiveActionReauthDialog } = await import(
      "@/components/dashboard/sensitive-action-reauth-dialog"
    );

    render(
      <SensitiveActionReauthDialog
        open
        onOpenChange={onOpenChange}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "This session is managed by Okta. Refresh your secure sign-in, then return and try again."
        )
      ).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Current account password")).not.toBeInTheDocument();
  });
});
