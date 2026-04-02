import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const setSessionMock = vi.fn();
const hydrateMock = vi.fn();
const loginRequestMock = vi.fn();
const fetchAdminSsoStatusMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  fetchAdminSsoStatus: fetchAdminSsoStatusMock,
  getAdminSsoLoginPath: vi.fn(() => "/api/auth/admin/sso/login?next=%2Fpatients"),
  login: loginRequestMock,
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: typeof authStore) => unknown) => selector(authStore),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof languageStore) => unknown) => selector(languageStore),
}));

const authStore = {
  token: null,
  hydrate: hydrateMock,
  hydrated: true,
  setSession: setSessionMock,
};

const languageStore = {
  language: "en" as const,
  setLanguage: vi.fn(),
};

describe("LoginClientPage", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    setSessionMock.mockReset();
    hydrateMock.mockReset();
    loginRequestMock.mockReset();
    fetchAdminSsoStatusMock.mockReset();
    fetchAdminSsoStatusMock.mockResolvedValue({
      enabled: false,
      enforced_for_admin: false,
      provider_name: null,
      login_path: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("resets the 2FA challenge when switching to another account", async () => {
    loginRequestMock
      .mockRejectedValueOnce({
        status: 401,
        message: "Unable to sign in. Please try again.",
        detail: {
          code: "two_factor_required",
          message: "Two-factor verification code is required.",
          trusted_device_days: 7,
        },
      })
      .mockResolvedValueOnce({
        access_token: "token-2",
        user: {
          id: "user-2",
          email: "doctor@example.com",
        },
      });

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Confirm sign-in")).toBeInTheDocument();
    });

    expect(screen.getByText("Continue sign-in")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use another account" }));

    await waitFor(() => {
      expect(screen.getByText("Welcome Back")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "doctor@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "DoctorPass123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(loginRequestMock).toHaveBeenNthCalledWith(
        2,
        "doctor@example.com",
        "DoctorPass123!",
        "",
        true
      );
    });
    expect(setSessionMock).toHaveBeenCalledWith({
      access_token: "token-2",
      user: {
        id: "user-2",
        email: "doctor@example.com",
      },
    });
    expect(replaceMock).toHaveBeenCalledWith("/patients");
  });

  it("keeps the setup key hidden until the user explicitly reveals it", async () => {
    loginRequestMock.mockRejectedValueOnce({
      status: 401,
      message: "Unable to sign in. Please try again.",
      detail: {
        code: "two_factor_required",
        message: "Two-factor verification code is required.",
        provisioning_uri: "otpauth://totp/Telemed%20Admin:admin@example.com?secret=SECRET123&issuer=Telemed%20Admin",
      },
    });

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show setup key" })).toBeInTheDocument();
    });

    expect(screen.queryByText(/Setup key:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SECRET123/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show setup key" }));

    expect(screen.getByText("Setup key: SECRET123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide setup key" }));

    expect(screen.queryByText("Setup key: SECRET123")).not.toBeInTheDocument();
  });
});
