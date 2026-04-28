import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof languageStore) => unknown) => selector(languageStore),
}));

const languageStore = {
  language: "en" as const,
  setLanguage: vi.fn(),
};

describe("AuthShell", () => {
  beforeEach(() => {
    languageStore.language = "en";
    languageStore.setLanguage.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders shared shell copy, content, and language controls", async () => {
    const { AuthShell } = await import("@/components/auth/auth-shell");

    render(
      <AuthShell
        title="Reset password"
        subtitle="Create a new password to continue."
        metaText="Your reset link is ready."
      >
        <div>Form content</div>
      </AuthShell>
    );

    expect(screen.getByText("Reset password")).toBeInTheDocument();
    expect(screen.getByText("Create a new password to continue.")).toBeInTheDocument();
    expect(screen.getByText("Your reset link is ready.")).toBeInTheDocument();
    expect(screen.getByText("Form content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ไทย" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ไทย" }));

    expect(languageStore.setLanguage).toHaveBeenCalledWith("th");
  });
});
