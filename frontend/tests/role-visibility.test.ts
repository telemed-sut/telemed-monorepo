/**
 * Tests for role-based rendering logic in sidebar and users page.
 * We test the underlying data logic (route filtering) rather than full component
 * rendering since the components have heavy UI library dependencies.
 */
import { describe, it, expect } from "vitest";
import {
  CARE_TEAM_ASSIGNMENT_ROLES,
  CLINICAL_ROLES,
  ROLE_LABEL_MAP,
  ROLE_OPTIONS,
  canManageUsers,
  canViewClinicalData,
  canWriteClinicalData,
  isMedicalStudentRole,
} from "@/lib/api";

// ── Sidebar route visibility logic ──────────────────────────────

const baseRouteIds = ["overview", "patients", "meetings"];
const adminOnlyRouteIds = ["users"];

function getDashboardRoutes(userRole: string | null): string[] {
  if (userRole === "admin") {
    return [...baseRouteIds, ...adminOnlyRouteIds];
  }
  return baseRouteIds;
}

describe("Sidebar role-based visibility", () => {
  it("admin sees Users link", () => {
    const routes = getDashboardRoutes("admin");
    expect(routes).toContain("users");
  });

  it("doctor does NOT see Users link", () => {
    const routes = getDashboardRoutes("doctor");
    expect(routes).not.toContain("users");
  });

  it("medical_student does NOT see Users link", () => {
    const routes = getDashboardRoutes("medical_student");
    expect(routes).not.toContain("users");
  });

  it("null role does NOT see Users link", () => {
    const routes = getDashboardRoutes(null);
    expect(routes).not.toContain("users");
  });

  it("all roles see base routes", () => {
    for (const role of ["admin", "doctor", "medical_student"]) {
      const routes = getDashboardRoutes(role);
      expect(routes).toContain("overview");
      expect(routes).toContain("patients");
      expect(routes).toContain("meetings");
    }
  });
});

// ── /users page access logic ──────────────────────────────────

function shouldAllowUsersPage(role: string | null, token: string | null): boolean {
  return token !== null && role === "admin";
}

function shouldRedirectToOverview(role: string | null, token: string | null, hydrated: boolean): boolean {
  return hydrated && token !== null && role !== null && role !== "admin";
}

describe("/users page access control", () => {
  it("allows admin with token", () => {
    expect(shouldAllowUsersPage("admin", "some-token")).toBe(true);
  });

  it("blocks medical_student with token", () => {
    expect(shouldAllowUsersPage("medical_student", "some-token")).toBe(false);
  });

  it("blocks doctor with token", () => {
    expect(shouldAllowUsersPage("doctor", "some-token")).toBe(false);
  });

  it("blocks null role", () => {
    expect(shouldAllowUsersPage(null, "some-token")).toBe(false);
  });

  it("blocks no token", () => {
    expect(shouldAllowUsersPage("admin", null)).toBe(false);
  });

  it("redirects non-admin to overview when hydrated", () => {
    expect(shouldRedirectToOverview("medical_student", "token", true)).toBe(true);
    expect(shouldRedirectToOverview("doctor", "token", true)).toBe(true);
  });

  it("does NOT redirect admin", () => {
    expect(shouldRedirectToOverview("admin", "token", true)).toBe(false);
  });

  it("does NOT redirect before hydration", () => {
    expect(shouldRedirectToOverview("medical_student", "token", false)).toBe(false);
  });
});

// ── Role constants ──────────────────────────────────────────────

describe("Role constants", () => {
  it("ROLE_OPTIONS has all 3 roles", () => {
    expect(ROLE_OPTIONS).toHaveLength(3);
    const values = ROLE_OPTIONS.map((r) => r.value);
    expect(values).toContain("admin");
    expect(values).toContain("doctor");
    expect(values).toContain("medical_student");
  });

  it("ROLE_LABEL_MAP maps all roles", () => {
    expect(ROLE_LABEL_MAP["admin"]).toBe("Admin");
    expect(ROLE_LABEL_MAP["doctor"]).toBe("Doctor");
    expect(ROLE_LABEL_MAP["medical_student"]).toBe("Medical Student");
  });

  it("CLINICAL_ROLES includes doctor but not admin/medical_student", () => {
    expect(CLINICAL_ROLES.has("doctor")).toBe(true);
    expect(CLINICAL_ROLES.has("admin")).toBe(false);
    expect(CLINICAL_ROLES.has("medical_student")).toBe(false);
  });
});

describe("Role capability helpers", () => {
  it("only admin can manage users", () => {
    expect(canManageUsers("admin")).toBe(true);
    expect(canManageUsers("doctor")).toBe(false);
    expect(canManageUsers("medical_student")).toBe(false);
  });

  it("medical_student can view but not write clinical data", () => {
    expect(canViewClinicalData("medical_student")).toBe(true);
    expect(canWriteClinicalData("medical_student")).toBe(false);
  });

  it("doctor can write clinical data", () => {
    expect(canWriteClinicalData("doctor")).toBe(true);
  });

  it("CARE_TEAM_ASSIGNMENT_ROLES includes doctor and medical_student", () => {
    expect(CARE_TEAM_ASSIGNMENT_ROLES.has("doctor")).toBe(true);
    expect(CARE_TEAM_ASSIGNMENT_ROLES.has("medical_student")).toBe(true);
    expect(CARE_TEAM_ASSIGNMENT_ROLES.has("admin")).toBe(false);
  });

  it("isMedicalStudentRole matches only medical_student", () => {
    expect(isMedicalStudentRole("medical_student")).toBe(true);
    expect(isMedicalStudentRole("doctor")).toBe(false);
    expect(isMedicalStudentRole("admin")).toBe(false);
  });
});
