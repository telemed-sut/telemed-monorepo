import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardStore } from "@/store/dashboard-store";

const { mockLanguageState } = vi.hoisted(() => ({
  mockLanguageState: {
    language: "en" as "en" | "th",
  },
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (
    selector: (state: typeof mockLanguageState) => unknown
  ) => selector(mockLanguageState),
}));

describe("EmployeesTable localization", () => {
  beforeEach(() => {
    mockLanguageState.language = "en";
    useDashboardStore.setState({
      searchQuery: "",
      departmentFilter: "all",
      statusFilter: "all",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders visible employees table copy in Thai", async () => {
    mockLanguageState.language = "th";

    const { EmployeesTable } = await import("@/components/dashboard/employees-table");
    render(<EmployeesTable />);

    expect(screen.getByText("รายชื่อพนักงาน")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ค้นหาพนักงาน...")).toBeInTheDocument();
    expect(screen.getByText("ตัวกรอง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "นำเข้า" })).toBeInTheDocument();
    expect(screen.getByText("รหัสผู้ใช้")).toBeInTheDocument();
    expect(screen.getByText("ชื่อ")).toBeInTheDocument();
    expect(screen.getByText("อีเมล")).toBeInTheDocument();
    expect(screen.getByText("แผนก")).toBeInTheDocument();
    expect(screen.getByText("ตำแหน่งงาน")).toBeInTheDocument();
    expect(screen.getByText("วันที่เข้าร่วม")).toBeInTheDocument();
    expect(screen.getAllByText("สถานะ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ใช้งานอยู่").length).toBeGreaterThan(0);
    expect(screen.getByText(/แสดง 1 ถึง 8 จาก 50 รายการ/)).toBeInTheDocument();
  });
});
