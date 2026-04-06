import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/components/dashboard/patients-table", () => ({
  PatientsTable: (props: { showStats?: boolean; showTable?: boolean }) =>
    mockPatientsTable(props),
}));

describe("dashboard content patient layout controls", () => {
  beforeEach(() => {
    mockPatientsTable.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the patients table with its default visibility props", async () => {
    const { DashboardContent } = await import("@/components/dashboard/content");
    render(<DashboardContent />);

    expect(mockPatientsTable).toHaveBeenCalledTimes(1);
    expect(mockPatientsTable.mock.calls[0]?.[0]).toEqual({});
    expect(screen.getByTestId("patients-table-props")).toHaveTextContent(
      "undefined|undefined"
    );
  });
});
