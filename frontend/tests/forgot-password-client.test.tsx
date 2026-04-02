import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestPasswordResetMock = vi.fn();

vi.mock("@/lib/api", () => ({
  requestPasswordReset: requestPasswordResetMock,
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof languageStore) => unknown) => selector(languageStore),
}));

const languageStore = {
  language: "en" as const,
  setLanguage: vi.fn(),
};

describe("ForgotPasswordClientPage", () => {
  beforeEach(() => {
    requestPasswordResetMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a privacy-safe success message after submitting", async () => {
    requestPasswordResetMock.mockResolvedValue({
      message: "User exists and reset email has been sent.",
      reset_token: null,
    });

    const ForgotPasswordClientPage = (await import("@/app/forgot-password/forgot-password-client")).default;

    render(<ForgotPasswordClientPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "doctor@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(requestPasswordResetMock).toHaveBeenCalledWith("doctor@example.com");
    });

    expect(
      screen.getByText("If this email is in the system, we will send a reset link.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("User exists and reset email has been sent.")
    ).not.toBeInTheDocument();
  });

  it("hides the development token by default", async () => {
    requestPasswordResetMock.mockResolvedValue({
      message: "User exists and reset email has been sent.",
      reset_token: "dev-token-123",
    });

    const ForgotPasswordClientPage = (await import("@/app/forgot-password/forgot-password-client")).default;

    render(<ForgotPasswordClientPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "doctor@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(requestPasswordResetMock).toHaveBeenCalledWith("doctor@example.com");
    });

    expect(screen.queryByText("Development token")).not.toBeInTheDocument();
    expect(screen.queryByText("dev-token-123")).not.toBeInTheDocument();
  });
});
