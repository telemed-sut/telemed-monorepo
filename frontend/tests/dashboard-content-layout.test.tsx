import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDashboardState = vi.hoisted(() => ({
  showPatientStats: true,
  showPatientTable: true,
}));

const mockPatientsTable = vi.fn(
  ({
    showStats,
    showTable,
  }: {
    showStats?: boolean;
    showTable?: boolean;
  }) => (
    <div data-testid="patients-table-props">
      {String(showStats)}|{String(showTable)}
    </div>
  )
);

vi.mock("@/store/dashboard-store", () => ({
  useDashboardStore: (
    selector: (state: typeof mockDashboardState) => unknown
  ) => selector(mockDashboardState),
}));

vi.mock("@/components/dashboard/patients-table", () => ({
  PatientsTable: (props: { showStats?: boolean; showTable?: boolean }) =>
    mockPatientsTable(props),
}));

describe("dashboard content patient layout controls", () => {
  beforeEach(() => {
    mockDashboardState.showPatientStats = true;
    mockDashboardState.showPatientTable = true;
    mockPatientsTable.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("passes the patient layout visibility flags from the dashboard store", async () => {
    mockDashboardState.showPatientStats = false;
    mockDashboardState.showPatientTable = true;

    const { DashboardContent } = await import("@/components/dashboard/content");
    render(<DashboardContent />);

    expect(mockPatientsTable).toHaveBeenCalledTimes(1);
    expect(mockPatientsTable.mock.calls[0]?.[0]).toEqual({
      showStats: false,
      showTable: true,
    });
    expect(screen.getByTestId("patients-table-props")).toHaveTextContent(
      "false|true"
    );
  });
});
