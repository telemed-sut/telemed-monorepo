import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const resetPasswordMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/lib/api", () => ({
  resetPassword: resetPasswordMock,
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof languageStore) => unknown) => selector(languageStore),
}));

const languageStore = {
  language: "en" as const,
  setLanguage: vi.fn(),
};

describe("ResetPasswordClientPage", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    resetPasswordMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a success state before redirecting back to sign in", async () => {
    resetPasswordMock.mockResolvedValue({ message: "ok" });

    const ResetPasswordClientPage = (await import("@/app/reset-password/reset-password-client")).default;

    render(<ResetPasswordClientPage initialToken="reset-token-123" />);

    expect(screen.queryByLabelText("Reset token")).not.toBeInTheDocument();
    expect(screen.getByText("Reset link detected. You can set a new password below.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "NewPass123!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "NewPass123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(resetPasswordMock).toHaveBeenCalledWith("reset-token-123", "NewPass123!");
    });

    expect(screen.getByText("Password updated. Redirecting to sign in...")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login");
    }, { timeout: 2000 });
  });
});
