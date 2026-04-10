import { render, screen } from "@testing-library/react";
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

  it("renders the page title without a duplicate language switcher", async () => {
    const { DashboardHeader } = await import("@/components/dashboard/header");

    render(<DashboardHeader />);

    expect(screen.getByRole("heading", { name: "Meetings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch language to Thai" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch language to English" })).not.toBeInTheDocument();
  });
});
