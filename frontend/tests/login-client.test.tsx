import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const setSessionMock = vi.fn();
const hydrateMock = vi.fn();
const loginRequestMock = vi.fn();
const loginWithPasskeyMock = vi.fn();
const startConditionalPasskeyLoginMock = vi.fn();
const browserSupportsConditionalPasskeyLoginMock = vi.fn();
const cancelPasskeyCeremonyMock = vi.fn();
const fetchAdminSsoStatusMock = vi.fn();
const getAuthErrorMessageMock = vi.fn(() => "Fallback auth error");
let mockSearchParamsString = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(mockSearchParamsString),
}));

vi.mock("@/lib/api", () => ({
  fetchAdminSsoStatus: fetchAdminSsoStatusMock,
  getAdminSsoLoginPath: vi.fn(() => "/api/auth/admin/sso/login?next=%2Fpatients"),
  getAuthErrorMessage: getAuthErrorMessageMock,
  login: loginRequestMock,
}));

vi.mock("@/lib/api-passkeys", () => ({
  browserSupportsConditionalPasskeyLogin: browserSupportsConditionalPasskeyLoginMock,
  cancelPasskeyCeremony: cancelPasskeyCeremonyMock,
  loginWithPasskey: loginWithPasskeyMock,
  isPasskeyCeremonyCancelled: vi.fn(() => false),
  startConditionalPasskeyLogin: startConditionalPasskeyLoginMock,
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
    loginWithPasskeyMock.mockReset();
    startConditionalPasskeyLoginMock.mockReset();
    browserSupportsConditionalPasskeyLoginMock.mockReset();
    cancelPasskeyCeremonyMock.mockReset();
    fetchAdminSsoStatusMock.mockReset();
    getAuthErrorMessageMock.mockReset();
    getAuthErrorMessageMock.mockReturnValue("Fallback auth error");
    mockSearchParamsString = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    browserSupportsConditionalPasskeyLoginMock.mockResolvedValue(false);
    startConditionalPasskeyLoginMock.mockResolvedValue({
      access_token: "passkey-token",
      user: {
        id: "passkey-user",
        email: "doctor@example.com",
      },
    });
    fetchAdminSsoStatusMock.mockResolvedValue({
      enabled: false,
      enforced_for_admin: false,
      provider_name: null,
      login_path: null,
    });
    authStore.hydrated = true;
    authStore.token = null;
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

  it("shows a clear message when a session refresh failed", async () => {
    mockSearchParamsString = "error=session_expired&reason=refresh_failed";

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    expect(
      await screen.findByText(
        "We couldn't refresh your session securely. Please sign in again."
      )
    ).toBeInTheDocument();
  });

  it("keeps the Passkey area minimal and leaves password as the fallback", async () => {
    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    expect(await screen.findByRole("button", { name: "Sign in with Passkey" })).toBeInTheDocument();
    expect(screen.getByText("Or use password")).toBeInTheDocument();
    expect(screen.queryByText("Use a Passkey already saved on this device.")).not.toBeInTheDocument();
  });

  it("uses browser autofill instead of a visible Passkey button when conditional UI is supported", async () => {
    browserSupportsConditionalPasskeyLoginMock.mockResolvedValueOnce(true);
    startConditionalPasskeyLoginMock.mockImplementation(() => new Promise(() => {}));

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    const emailInput = await screen.findByLabelText("Email address");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Sign in with Passkey" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Or use password")).not.toBeInTheDocument();
    expect(emailInput).toHaveAttribute("autocomplete", "username webauthn");
    await waitFor(() => {
      expect(startConditionalPasskeyLoginMock).toHaveBeenCalledTimes(1);
    });
  });

  it("waits for hydration before starting conditional passkey login", async () => {
    authStore.hydrated = false;
    browserSupportsConditionalPasskeyLoginMock.mockResolvedValueOnce(true);
    startConditionalPasskeyLoginMock.mockImplementation(() => new Promise(() => {}));

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    const { rerender } = render(<LoginClientPage />);

    expect(startConditionalPasskeyLoginMock).not.toHaveBeenCalled();

    authStore.hydrated = true;
    rerender(<LoginClientPage />);

    const emailInput = await screen.findByLabelText("Email address");

    await waitFor(() => {
      expect(emailInput).toHaveAttribute("autocomplete", "username webauthn");
    });
    await waitFor(() => {
      expect(startConditionalPasskeyLoginMock).toHaveBeenCalledTimes(1);
    });
  });

  it("silently ignores missing webauthn autofill input errors for conditional passkey login", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    browserSupportsConditionalPasskeyLoginMock.mockResolvedValueOnce(true);
    startConditionalPasskeyLoginMock.mockRejectedValueOnce(
      new Error(
        'No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected',
      ),
    );

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    await screen.findByLabelText("Email address");

    await waitFor(() => {
      expect(startConditionalPasskeyLoginMock).toHaveBeenCalledTimes(1);
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Passkey login failed. Please try again or use password."),
    ).not.toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it("falls back to the regular Passkey button when conditional passkey bootstrap fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    browserSupportsConditionalPasskeyLoginMock.mockResolvedValueOnce(true);
    startConditionalPasskeyLoginMock.mockRejectedValueOnce({
      status: 500,
      message: "Internal Server Error",
    });

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    await screen.findByLabelText("Email address");

    await waitFor(() => {
      expect(startConditionalPasskeyLoginMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in with Passkey" })).toBeInTheDocument();
    });

    expect(screen.getByText("Or use password")).toBeInTheDocument();
    expect(
      screen.queryByText("Passkey login failed. Please try again or use password."),
    ).not.toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("does not flash the Passkey button while conditional UI support is still being detected", async () => {
    browserSupportsConditionalPasskeyLoginMock.mockImplementationOnce(() => new Promise(() => {}));

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    expect(screen.queryByRole("button", { name: "Sign in with Passkey" })).not.toBeInTheDocument();
    expect(screen.queryByText("Or use password")).not.toBeInTheDocument();
  });

  it("only enables the continue button after email and password are both filled", async () => {
    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    const continueButton = await screen.findByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "doctor@example.com" },
    });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password123!" },
    });
    expect(continueButton).toBeEnabled();
  });

  it("shows a soft passkey guidance message without logging an error for unknown passkeys", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    loginWithPasskeyMock.mockRejectedValueOnce({
      code: "passkey_not_registered",
      message: "Passkey not recognized.",
    });

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    await screen.findByRole("button", { name: "Sign in with Passkey" });
    consoleErrorSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Passkey" }));

    expect(
      await screen.findByText(
        "That Passkey can't be used here anymore. Try again or use your password."
      )
    ).toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("shows informational guidance when an admin account is locked", async () => {
    loginRequestMock.mockRejectedValueOnce({
      status: 423,
      message: "Account temporarily locked.",
      detail: {
        code: "account_locked",
        message: "Account temporarily locked due to multiple failed login attempts.",
        retry_after_seconds: 120,
        recovery_options: ["wait", "contact_admin"],
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

    expect(await screen.findByText("Account temporarily locked")).toBeInTheDocument();
    expect(screen.getByText("Contact an admin for help unlocking this account.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Authenticator or backup code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByText("Confirm sign-in")).not.toBeInTheDocument();
  });

  it("shows recovery options for a locked clinical account without self-service unlock", async () => {
    loginRequestMock.mockRejectedValueOnce({
      status: 423,
      message: "Account temporarily locked.",
      detail: {
        code: "account_locked",
        message: "Account temporarily locked due to multiple failed login attempts.",
        retry_after_seconds: 60,
        recovery_options: ["wait", "forgot_password", "contact_admin"],
      },
    });

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "doctor@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Account temporarily locked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reset your password" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByText("Contact an admin for help unlocking this account.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Authenticator or backup code")).not.toBeInTheDocument();
  });

  it("clears credentials after logout while keeping conditional passkey UI available", async () => {
    window.sessionStorage.setItem(
      "telemed.login.reset-credentials-after-logout",
      String(Date.now()),
    );
    browserSupportsConditionalPasskeyLoginMock.mockResolvedValueOnce(true);
    startConditionalPasskeyLoginMock.mockImplementation(() => new Promise(() => {}));

    const LoginClientPage = (await import("@/app/login/login-client")).default;

    render(<LoginClientPage />);

    const emailInput = await screen.findByLabelText("Email address");
    const passwordInput = screen.getByLabelText("Password");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Sign in with Passkey" })).not.toBeInTheDocument();
    });
    expect(emailInput).toHaveAttribute("autocomplete", "username webauthn");
    expect(passwordInput).toHaveAttribute("autocomplete", "new-password");
    expect(emailInput).toHaveValue("");
    expect(passwordInput).toHaveValue("");
  });
});
