import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/meetings",
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">Menu</button>,
}));

vi.mock("@/components/dashboard/dashboard-route-utils", () => ({
  getDashboardPageTitle: () => "Meetings",
}));

vi.mock("@/store/dashboard-store", () => ({
  useDashboardStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      showAlertBanner: true,
      showStatsCards: true,
      showChart: true,
      showTable: true,
      setShowAlertBanner: vi.fn(),
      setShowStatsCards: vi.fn(),
      setShowChart: vi.fn(),
      setShowTable: vi.fn(),
      resetLayout: vi.fn(),
      showPatientStats: true,
      showPatientTable: true,
      setShowPatientStats: vi.fn(),
      setShowPatientTable: vi.fn(),
      resetPatientsLayout: vi.fn(),
      showUserStats: true,
      showUserCharts: true,
      showUserTable: true,
      setShowUserStats: vi.fn(),
      setShowUserCharts: vi.fn(),
      setShowUserTable: vi.fn(),
      resetUsersLayout: vi.fn(),
    }),
}));

const languageState = {
  language: "en" as const,
  setLanguage: vi.fn(),
};

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (
    selector: (state: typeof languageState) => unknown
  ) => selector(languageState),
}));

describe("DashboardHeader", () => {
  beforeEach(() => {
    languageState.language = "en";
    languageState.setLanguage.mockReset();
  });

  it("renders the page title and keeps the language switcher in the header", async () => {
    const { DashboardHeader } = await import("@/components/dashboard/header");

    render(<DashboardHeader />);

    expect(screen.getByRole("heading", { name: "Meetings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /english/i })).toBeInTheDocument();
  });

  it("updates the language from the header switcher", async () => {
    const { DashboardHeader } = await import("@/components/dashboard/header");

    render(<DashboardHeader />);

    fireEvent.click(screen.getByRole("button", { name: /english/i }));
    fireEvent.click(screen.getByText("ไทย"));

    await waitFor(() => {
      expect(languageState.setLanguage).toHaveBeenCalledWith("th");
    });
  });
});
