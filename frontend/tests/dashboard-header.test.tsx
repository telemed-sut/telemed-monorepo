import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetLanguage = vi.fn();

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
  setLanguage: mockSetLanguage,
};

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (
    selector: (state: typeof languageState) => unknown
  ) => selector(languageState),
}));

describe("DashboardHeader", () => {
  beforeEach(() => {
    languageState.language = "en";
    mockSetLanguage.mockReset();
  });

  it("renders TH/EN controls and updates the language preference", async () => {
    const { DashboardHeader } = await import("@/components/dashboard/header");

    render(<DashboardHeader />);

    expect(screen.getByRole("button", { name: "Switch language to Thai" })).toHaveTextContent("TH");
    expect(screen.getByRole("button", { name: "Switch language to English" })).toHaveTextContent("EN");

    fireEvent.click(screen.getByRole("button", { name: "Switch language to Thai" }));

    expect(mockSetLanguage).toHaveBeenCalledWith("th");
  });
});
