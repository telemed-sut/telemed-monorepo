import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockPush,
  mockBack,
  mockSearchParams,
  mockSearchParamsObject,
  mockToastDismiss,
  mockToastError,
  mockToastSuccess,
  mockFetchAccessProfile,
  mockFetch2FAStatus,
  mockFetchCurrentUser,
  mockFetchTrustedDevices,
  mockDisable2FA,
  mockReset2FA,
  mockVerify2FA,
  mockCreateUserInvite,
  mockListPasskeys,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => {
  const mockSearchParams = { value: "panel=security" };
  const mockSearchParamsObject = {
    get: (key: string) => new URLSearchParams(mockSearchParams.value).get(key),
    toString: () => mockSearchParams.value,
  };

  return {
    mockReplace: vi.fn(),
    mockPush: vi.fn(),
    mockBack: vi.fn(),
    mockSearchParams,
    mockSearchParamsObject,
    mockToastDismiss: vi.fn(),
    mockToastError: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockFetchAccessProfile: vi.fn(),
    mockFetch2FAStatus: vi.fn(),
    mockFetchCurrentUser: vi.fn(),
    mockFetchTrustedDevices: vi.fn(),
    mockDisable2FA: vi.fn(),
    mockReset2FA: vi.fn(),
    mockVerify2FA: vi.fn(),
    mockCreateUserInvite: vi.fn(),
    mockListPasskeys: vi.fn(),
    mockAuthState: {
      token: "settings-token",
      userId: "doctor-1",
      role: "doctor",
      hydrated: true,
      currentUser: {
        id: "doctor-1",
        email: "doctor@example.com",
        first_name: "Test",
        last_name: "Doctor",
        role: "doctor",
        verification_status: "verified",
        two_factor_enabled: true,
        mfa_verified: true,
        mfa_recent_for_privileged_actions: true,
        mfa_authenticated_at: "2026-04-17T03:30:00.000Z",
        auth_source: "local",
        sso_provider: null,
      },
      ssoProvider: null,
      mfaVerified: true,
      mfaAuthenticatedAt: "2026-04-17T03:30:00.000Z",
      clearToken: vi.fn(),
      setCurrentUser: vi.fn(),
      getTokenTTL: vi.fn(() => 1800),
    },
    mockLanguageState: {
      language: "en" as const,
    },
  };
});

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    back: mockBack,
  }),
  useSearchParams: () => mockSearchParamsObject,
}));

vi.mock("@/hooks/use-session-logout", () => ({
  useSessionLogout: () => vi.fn(),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof mockLanguageState) => unknown) => selector(mockLanguageState),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    dismiss: mockToastDismiss,
    error: mockToastError,
    success: mockToastSuccess,
  },
}));

vi.mock("@/components/dashboard/sensitive-action-reauth-dialog", () => ({
  SensitiveActionReauthDialog: ({
    open,
    actionLabel,
  }: {
    open: boolean;
    actionLabel?: string;
  }) => (open ? <div data-testid="sensitive-reauth-dialog">{actionLabel ?? "reauth"}</div> : null),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchAccessProfile: mockFetchAccessProfile,
    fetch2FAStatus: mockFetch2FAStatus,
    fetchCurrentUser: mockFetchCurrentUser,
    fetchTrustedDevices: mockFetchTrustedDevices,
    disable2FA: mockDisable2FA,
    reset2FA: mockReset2FA,
    verify2FA: mockVerify2FA,
    createUserInvite: mockCreateUserInvite,
  };
});

vi.mock("@/lib/api-passkeys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-passkeys")>();
  return {
    ...actual,
    listPasskeys: mockListPasskeys,
  };
});

async function renderSettingsContent() {
  const { SettingsContent } = await import("@/components/dashboard/settings-content");
  return render(<SettingsContent />);
}

describe("SettingsContent validation toasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSearchParams.value = "panel=security";
    mockAuthState.userId = "doctor-1";
    mockAuthState.role = "doctor";
    mockAuthState.currentUser = {
      id: "doctor-1",
      email: "doctor@example.com",
      first_name: "Test",
      last_name: "Doctor",
      role: "doctor",
      verification_status: "verified",
      two_factor_enabled: true,
      mfa_verified: true,
      mfa_recent_for_privileged_actions: true,
      mfa_authenticated_at: "2026-04-17T03:30:00.000Z",
      auth_source: "local",
      sso_provider: null,
    };
    mockAuthState.ssoProvider = null;
    mockAuthState.mfaVerified = true;
    mockAuthState.mfaAuthenticatedAt = "2026-04-17T03:30:00.000Z";

    mockFetchCurrentUser.mockResolvedValue(mockAuthState.currentUser);
    mockFetchAccessProfile.mockResolvedValue({
      has_privileged_access: false,
      access_class: null,
      access_class_revealed: false,
      can_manage_privileged_admins: false,
      can_manage_security_recovery: false,
      can_bootstrap_privileged_roles: false,
    });
    mockFetch2FAStatus.mockResolvedValue({
      required: false,
      enabled: true,
      setup_required: false,
      issuer: "Telemed",
      account_email: "doctor@example.com",
      provisioning_uri: null,
      trusted_device_days: 7,
    });
    mockFetchTrustedDevices.mockResolvedValue({
      items: [],
      total: 0,
    });
    mockListPasskeys.mockResolvedValue({
      items: [],
      total: 0,
    });
    mockDisable2FA.mockResolvedValue(undefined);
    mockReset2FA.mockResolvedValue({
      required: false,
      enabled: false,
      setup_required: true,
      issuer: "Telemed",
      account_email: "doctor@example.com",
      provisioning_uri: "otpauth://totp/Telemed:doctor@example.com?secret=ABC123&issuer=Telemed",
      trusted_device_days: 7,
    });
    mockVerify2FA.mockResolvedValue({
      message: "Two-factor authentication verified successfully.",
    });
    mockCreateUserInvite.mockResolvedValue({
      invite_url: "https://example.com/invite",
      expires_at: "2026-04-18T03:30:00.000Z",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the missing disable-code toast only once until the field changes", async () => {
    const view = await renderSettingsContent();

    const disableButton = await screen.findByRole("button", { name: "Disable 2FA" });
    fireEvent.click(disableButton);
    fireEvent.click(disableButton);

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Please enter current 2FA code to disable",
      expect.objectContaining({
        id: "settings-disable-2fa-required",
        onDismiss: expect.any(Function),
        onAutoClose: expect.any(Function),
      }),
    );
    expect(mockDisable2FA).not.toHaveBeenCalled();

    const disableCodeInput = view.container.querySelector("#two_fa_disable_code");
    expect(disableCodeInput).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(disableCodeInput as HTMLInputElement, {
      target: { value: "123456" },
    });

    expect(mockToastDismiss).toHaveBeenCalledWith("settings-disable-2fa-required");

    fireEvent.change(disableCodeInput as HTMLInputElement, {
      target: { value: "" },
    });
    fireEvent.click(disableButton);

    expect(mockToastError).toHaveBeenCalledTimes(2);
  }, 15000);

  it("dedupes the admin invite validation toast for repeated empty-reason clicks", async () => {
    mockSearchParams.value = "panel=admin";
    mockAuthState.userId = "admin-1";
    mockAuthState.role = "admin";
    mockAuthState.currentUser = {
      id: "admin-1",
      email: "admin@example.com",
      first_name: "System",
      last_name: "Admin",
      role: "admin",
      verification_status: "verified",
      two_factor_enabled: true,
      mfa_verified: true,
      mfa_recent_for_privileged_actions: true,
      mfa_authenticated_at: "2026-04-17T03:30:00.000Z",
      auth_source: "local",
      sso_provider: null,
    };
    mockFetchCurrentUser.mockResolvedValue(mockAuthState.currentUser);
    mockFetchAccessProfile.mockResolvedValue({
      has_privileged_access: true,
      access_class: "privileged",
      access_class_revealed: true,
      can_manage_privileged_admins: true,
      can_manage_security_recovery: true,
      can_bootstrap_privileged_roles: false,
    });

    const view = await renderSettingsContent();

    const onboardingTrigger = await screen.findByRole("button", {
      name: /Admin Onboarding/i,
    });
    fireEvent.click(onboardingTrigger);

    const emailInput = view.container.querySelector("#new_admin_email");
    expect(emailInput).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(emailInput as HTMLInputElement, {
      target: { value: "new-admin@example.com" },
    });

    const generateButton = await screen.findByRole("button", {
      name: "Generate admin invite",
    });
    fireEvent.click(generateButton);
    fireEvent.click(generateButton);

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Please enter reason with at least 8 characters",
      expect.objectContaining({
        id: "settings-admin-invite-reason-required",
      }),
    );
    expect(mockCreateUserInvite).not.toHaveBeenCalled();

    const reasonInput = view.container.querySelector("#admin_invite_reason");
    expect(reasonInput).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(reasonInput as HTMLInputElement, {
      target: { value: "ticket-1234" },
    });

    await waitFor(() => {
      expect(mockToastDismiss).toHaveBeenCalledWith(
        "settings-admin-invite-reason-required",
      );
    });
  }, 15000);

  it("opens the sensitive reauth dialog once when reset 2FA requires recent MFA", async () => {
    mockFetch2FAStatus.mockResolvedValue({
      required: false,
      enabled: false,
      setup_required: false,
      issuer: "Telemed",
      account_email: "doctor@example.com",
      provisioning_uri: null,
      trusted_device_days: 7,
    });
    mockReset2FA.mockRejectedValue(new Error("recent multi-factor verification required"));

    await renderSettingsContent();

    const resetButton = await screen.findByRole("button", { name: "Reset 2FA" });
    fireEvent.click(resetButton);
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(screen.getByTestId("sensitive-reauth-dialog")).toHaveTextContent("Reset 2FA");
    });

    expect(screen.getAllByTestId("sensitive-reauth-dialog")).toHaveLength(1);
    expect(mockReset2FA).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  }, 15000);

  it("shows the invalid 2FA error toast only once until the code changes", async () => {
    mockVerify2FA.mockRejectedValue(
      Object.assign(new Error("Invalid two-factor authentication code"), {
        status: 400,
        detail: { code: "invalid_two_factor_code" },
      }),
    );

    await renderSettingsContent();
    const verifyInput = await screen.findByLabelText("2FA Verification Code");
    fireEvent.change(verifyInput, {
      target: { value: "123456" },
    });

    const verifyButton = await screen.findByRole("button", { name: "Verify 2FA" });
    fireEvent.click(verifyButton);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(verifyButton);

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Authenticator code or backup code is incorrect.",
      expect.objectContaining({
        id: "settings-verify-2fa-invalid",
      }),
    );

    fireEvent.change(verifyInput, {
      target: { value: "654321" },
    });

    expect(mockToastDismiss).toHaveBeenCalledWith("settings-verify-2fa-invalid");
  }, 15000);
});
