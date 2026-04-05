import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockFetchCurrentUser,
  mockStepUpAuth,
  mockSetSession,
  mockClearToken,
  mockAuthState,
  mockLanguageState,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockFetchCurrentUser: vi.fn(),
  mockStepUpAuth: vi.fn(),
  mockSetSession: vi.fn(),
  mockClearToken: vi.fn(),
  mockAuthState: {
    token: "session-token",
    authSource: "local",
    ssoProvider: null,
    setSession: vi.fn(),
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
    mockAuthState.authSource = "local";
    mockAuthState.ssoProvider = null;
    mockAuthState.setSession = mockSetSession;
    mockAuthState.clearToken = mockClearToken;
    mockFetchCurrentUser.mockResolvedValue({
      email: "admin@example.com",
      auth_source: "local",
      sso_provider: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("allows users to trust the device for future secure actions after an OTP challenge", async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    mockStepUpAuth
      .mockRejectedValueOnce({
        detail: {
          code: "two_factor_required",
        },
      })
      .mockResolvedValueOnce({
        access_token: "fresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          email: "admin@example.com",
          mfa_verified: true,
        },
      });

    const { SensitiveActionReauthDialog } = await import(
      "@/components/dashboard/sensitive-action-reauth-dialog"
    );

    render(
      <SensitiveActionReauthDialog
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />
    );

    await waitFor(() => {
      expect(mockFetchCurrentUser).toHaveBeenCalledWith("session-token");
      expect(screen.getByDisplayValue("admin@example.com")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Current account password"), {
      target: { value: "TestPass123" },
    });
    const form = screen.getByRole("button", { name: "Continue securely" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() =>
      expect(mockStepUpAuth).toHaveBeenCalledWith(
        "TestPass123",
        "",
        false,
        "session-token",
      )
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Authenticator or backup code")).toBeInTheDocument()
    );

    expect(
      screen.getByText(
        "Password confirmed. Step 2 of 2: enter the current code from your authenticator app or a backup code to finish."
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "Use the current 6-digit code from your authenticator app, or one of your backup codes from Security settings."
      )
    ).toBeInTheDocument();

    expect(
      screen.getByRole("checkbox", { name: "Trust this device for secure actions" })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Trust this device for secure actions" })
    );
    fireEvent.change(screen.getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Verify code and continue" }).closest("form")!);

    await waitFor(() =>
      expect(mockStepUpAuth).toHaveBeenLastCalledWith(
        "TestPass123",
        "123456",
        true,
        "session-token",
      )
    );

    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: "fresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        email: "admin@example.com",
        mfa_verified: true,
      },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalled();
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
        "Use the same password you use to sign in as admin@example.com. This is not the OTP or verification code."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));

    expect(await screen.findByText("Please enter your password.")).toBeInTheDocument();
    expect(mockStepUpAuth).not.toHaveBeenCalled();
  });

  it("uses the live auth source and shows SSO guidance when the current session is SSO-backed", async () => {
    mockAuthState.authSource = "local";
    mockFetchCurrentUser.mockResolvedValue({
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
