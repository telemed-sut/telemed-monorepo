import { describe, expect, it } from "vitest";

import { getAuthErrorMessage, type ApiError } from "@/lib/api";

describe("getAuthErrorMessage", () => {
  it("maps login credential failures to a consistent localized message", () => {
    const error = Object.assign(new Error("Incorrect email or password"), {
      status: 401,
      detail: { code: "invalid_credentials" },
    }) as ApiError;

    expect(getAuthErrorMessage("en", error, "login")).toBe("Email or password is incorrect.");
    expect(getAuthErrorMessage("th", error, "login")).toBe("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  });

  it("maps invalid reset tokens to a privacy-safe reset message", () => {
    const error = Object.assign(new Error("Invalid or expired reset token"), {
      status: 400,
      detail: "Invalid or expired reset token",
    }) as ApiError;

    expect(getAuthErrorMessage("en", error, "reset-password")).toBe(
      "This reset link is invalid or has expired."
    );
    expect(getAuthErrorMessage("th", error, "forgot-password")).toBe(
      "ลิงก์รีเซ็ตนี้ไม่ถูกต้องหรือหมดอายุแล้ว"
    );
  });
});
