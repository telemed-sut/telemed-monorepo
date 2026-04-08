import { describe, expect, it } from "vitest";

import { getErrorMessage } from "@/lib/api-client";

describe("getErrorMessage", () => {
  it("returns normalized English copy when the UI language is English", () => {
    const error = Object.assign(new Error("access denied"), { status: 403 });

    expect(getErrorMessage(error, undefined, "en")).toBe("Access denied");
  });

  it("returns localized Thai copy when the UI language is Thai", () => {
    const error = Object.assign(new Error("access denied"), { status: 403 });

    expect(getErrorMessage(error, undefined, "th")).toBe("คุณไม่มีสิทธิ์ทำรายการนี้");
  });

  it("falls back to English copy when a Thai backend message reaches an English UI", () => {
    expect(getErrorMessage("คุณไม่มีสิทธิ์ทำรายการนี้", undefined, "en")).toBe("Access denied");
  });
});
