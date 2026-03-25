/**
 * Tests for user form validation logic and license/verification helpers
 * used in UsersTable component.
 */
import { describe, it, expect } from "vitest";
import { CLINICAL_ROLES } from "@/lib/api";

// ── isClinicalRole (replicated from users-table.tsx) ──────────

function isClinicalRole(role: string): boolean {
  return CLINICAL_ROLES.has(role);
}

describe("isClinicalRole", () => {
  it("doctor is clinical", () => expect(isClinicalRole("doctor")).toBe(true));
  it("admin is NOT clinical", () => expect(isClinicalRole("admin")).toBe(false));
  it("medical_student is NOT clinical", () => expect(isClinicalRole("medical_student")).toBe(false));
});

// ── License expiry helpers (replicated from users-table.tsx) ──

function isLicenseExpiringSoon(expiryStr?: string | null): boolean {
  if (!expiryStr) return false;
  const expiry = new Date(expiryStr);
  const now = new Date();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return expiry.getTime() - now.getTime() < thirtyDays && expiry.getTime() > now.getTime();
}

function isLicenseExpired(expiryStr?: string | null): boolean {
  if (!expiryStr) return false;
  return new Date(expiryStr).getTime() < Date.now();
}

describe("isLicenseExpired", () => {
  it("returns false for null", () => {
    expect(isLicenseExpired(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isLicenseExpired(undefined)).toBe(false);
  });

  it("returns true for past dates", () => {
    expect(isLicenseExpired("2020-01-01T00:00:00Z")).toBe(true);
  });

  it("returns false for far future dates", () => {
    expect(isLicenseExpired("2099-12-31T00:00:00Z")).toBe(false);
  });
});

describe("isLicenseExpiringSoon", () => {
  it("returns false for null", () => {
    expect(isLicenseExpiringSoon(null)).toBe(false);
  });

  it("returns false for past dates (already expired)", () => {
    expect(isLicenseExpiringSoon("2020-01-01T00:00:00Z")).toBe(false);
  });

  it("returns false for far future dates", () => {
    expect(isLicenseExpiringSoon("2099-12-31T00:00:00Z")).toBe(false);
  });

  it("returns true for dates within 30 days", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 15); // 15 days from now
    expect(isLicenseExpiringSoon(soon.toISOString())).toBe(true);
  });

  it("returns false for dates beyond 30 days", () => {
    const later = new Date();
    later.setDate(later.getDate() + 60); // 60 days from now
    expect(isLicenseExpiringSoon(later.toISOString())).toBe(false);
  });
});

// ── Form validation: clinical role requires license ──────────

interface UserFormState {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  specialty: string;
  department: string;
  license_no: string;
  license_expiry: string;
  verification_status: string;
}

function validateCreateForm(form: UserFormState): string[] {
  const errors: string[] = [];

  if (!form.email) errors.push("Email is required");
  if (!form.password || form.password.length < 8) errors.push("Password must be at least 8 characters");

  if (isClinicalRole(form.role) && !form.license_no) {
    errors.push("Clinical roles require a license number");
  }

  return errors;
}

describe("Create user form validation", () => {
  const baseForm: UserFormState = {
    email: "test@example.com",
    password: "password123",
    first_name: "Test",
    last_name: "User",
    role: "medical_student",
    is_active: true,
    specialty: "",
    department: "",
    license_no: "",
    license_expiry: "",
    verification_status: "unverified",
  };

  it("valid medical_student form passes", () => {
    expect(validateCreateForm(baseForm)).toEqual([]);
  });

  it("empty email fails", () => {
    const errors = validateCreateForm({ ...baseForm, email: "" });
    expect(errors).toContain("Email is required");
  });

  it("short password fails", () => {
    const errors = validateCreateForm({ ...baseForm, password: "abc" });
    expect(errors).toContain("Password must be at least 8 characters");
  });

  it("doctor without license fails", () => {
    const errors = validateCreateForm({ ...baseForm, role: "doctor", license_no: "" });
    expect(errors).toContain("Clinical roles require a license number");
  });

  it("doctor with license passes", () => {
    const errors = validateCreateForm({
      ...baseForm,
      role: "doctor",
      license_no: "MD12345",
      specialty: "Internal Medicine",
    });
    expect(errors).toEqual([]);
  });

  it("admin without license passes (non-clinical)", () => {
    const errors = validateCreateForm({ ...baseForm, role: "admin", license_no: "" });
    expect(errors).toEqual([]);
  });

  it("medical_student without license passes (non-clinical)", () => {
    const errors = validateCreateForm({ ...baseForm, role: "medical_student", license_no: "" });
    expect(errors).toEqual([]);
  });
});

// ── Verify action visibility logic ──────────────────────────────

function shouldShowVerifyButton(
  userRole: string,
  verificationStatus: string | null | undefined,
  currentUserRole: string | null
): boolean {
  return (
    currentUserRole === "admin" &&
    verificationStatus !== "verified"
  );
}

describe("Verify button visibility", () => {
  it("shows for admin viewing unverified doctor", () => {
    expect(shouldShowVerifyButton("doctor", "unverified", "admin")).toBe(true);
  });

  it("shows for admin viewing pending doctor", () => {
    expect(shouldShowVerifyButton("doctor", "pending", "admin")).toBe(true);
  });

  it("hides for admin viewing already verified doctor", () => {
    expect(shouldShowVerifyButton("doctor", "verified", "admin")).toBe(false);
  });

  it("hides for medical_student viewing unverified doctor", () => {
    expect(shouldShowVerifyButton("doctor", "unverified", "medical_student")).toBe(false);
  });

  it("shows for admin viewing admin (non-clinical, unverified)", () => {
    expect(shouldShowVerifyButton("admin", "unverified", "admin")).toBe(true);
  });

  it("shows for admin viewing medical_student (non-clinical, unverified)", () => {
    expect(shouldShowVerifyButton("medical_student", "unverified", "admin")).toBe(true);
  });

  it("handles null verification status", () => {
    expect(shouldShowVerifyButton("doctor", null, "admin")).toBe(true);
  });
});
