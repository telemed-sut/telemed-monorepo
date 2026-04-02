import { describe, expect, it } from "vitest";

import { getLocalizedDashboardErrorMessage } from "@/components/dashboard/dashboard-error-message";

describe("getLocalizedDashboardErrorMessage", () => {
  it("falls back to English copy when the UI is English and the API message is Thai", () => {
    expect(
      getLocalizedDashboardErrorMessage(
        new Error("ไม่พบข้อมูลผู้ใช้ที่ต้องการ"),
        "en",
        "Failed to load patients",
        "โหลดข้อมูลผู้ป่วยไม่สำเร็จ"
      )
    ).toBe("Failed to load patients");
  });

  it("maps access errors to a consistent English label", () => {
    expect(
      getLocalizedDashboardErrorMessage(
        Object.assign(new Error("คุณไม่มีสิทธิ์ทำรายการนี้"), { status: 403 }),
        "en",
        "Save failed",
        "บันทึกไม่สำเร็จ"
      )
    ).toBe("Access denied");
  });

  it("keeps Thai copy localized for Thai UI", () => {
    expect(
      getLocalizedDashboardErrorMessage(
        new Error("permission denied"),
        "th",
        "Delete failed",
        "ลบข้อมูลไม่สำเร็จ"
      )
    ).toBe("คุณไม่มีสิทธิ์ทำรายการนี้");
  });
});
