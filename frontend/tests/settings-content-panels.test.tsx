import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  mockListPasskeys,
  mockUpdateUser,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => {
  const mockSearchParams = { value: "panel=general" };
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
    mockListPasskeys: vi.fn(),
    mockUpdateUser: vi.fn(),
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

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchAccessProfile: mockFetchAccessProfile,
    fetch2FAStatus: mockFetch2FAStatus,
    fetchCurrentUser: mockFetchCurrentUser,
    fetchTrustedDevices: mockFetchTrustedDevices,
    updateUser: mockUpdateUser,
  };
});

vi.mock("@/lib/api-passkeys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-passkeys")>();
  return {
    ...actual,
    listPasskeys: mockListPasskeys,
  };
});

async function renderSettingsContent(
  props?: Partial<{
    presentation: "page" | "modal";
  }>,
) {
  const { SettingsContent } = await import("@/components/dashboard/settings-content");
  return render(<SettingsContent {...props} />);
}

describe("SettingsContent panels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-density");

    mockSearchParams.value = "panel=general";
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
      can_manage_security_operations: false,
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
    mockUpdateUser.mockResolvedValue({
      ...mockAuthState.currentUser,
      first_name: "Updated",
      last_name: "Doctor",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the security panel in both page and modal presentations", async () => {
    mockSearchParams.value = "panel=security";

    await renderSettingsContent();
    await waitFor(() => {
      expect(
        screen.getByText("Manage MFA, backup codes, and trusted devices."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Security/ })).toBeInTheDocument();

    cleanup();

    await renderSettingsContent({ presentation: "modal" });
    await waitFor(() => {
      expect(
        screen.getByText("Set the visual tone and daily workspace feel."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Security/ })).toBeInTheDocument();
  }, 15000);

  it("opens the account panel from navigation", async () => {
    const user = userEvent.setup();

    await renderSettingsContent();
    await user.click(await screen.findByRole("button", { name: /Account/ }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Edit your profile and review sign-in details, MFA status, and the current session in one place.",
        ),
      ).toBeInTheDocument();
    });
    expect(await screen.findByLabelText("First name")).toHaveValue("Test");
    expect(screen.getByLabelText("Last name")).toHaveValue("Doctor");
  }, 15000);

  it("applies and resets appearance from the general panel", async () => {
    await renderSettingsContent();

    fireEvent.click(await screen.findByRole("button", { name: /Warm/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("warm");
    expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
    expect(mockToastSuccess).toHaveBeenCalledWith("Appearance updated");

    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("clinical");
      expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Appearance reset to default");
  }, 15000);
});
