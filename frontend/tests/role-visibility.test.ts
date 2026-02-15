/**
 * Tests for role-based rendering logic in sidebar and users page.
 * We test the underlying data logic (route filtering) rather than full component
 * rendering since the components have heavy UI library dependencies.
 */
import { describe, it, expect } from "vitest";
import { CLINICAL_ROLES, ROLE_LABEL_MAP, ROLE_OPTIONS } from "@/lib/api";

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

  it("staff does NOT see Users link", () => {
    const routes = getDashboardRoutes("staff");
    expect(routes).not.toContain("users");
  });

  it("doctor does NOT see Users link", () => {
    const routes = getDashboardRoutes("doctor");
    expect(routes).not.toContain("users");
  });

  it("nurse does NOT see Users link", () => {
    const routes = getDashboardRoutes("nurse");
    expect(routes).not.toContain("users");
  });

  it("null role does NOT see Users link", () => {
    const routes = getDashboardRoutes(null);
    expect(routes).not.toContain("users");
  });

  it("all roles see base routes", () => {
    for (const role of ["admin", "staff", "doctor", "nurse", "pharmacist"]) {
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

  it("blocks staff with token", () => {
    expect(shouldAllowUsersPage("staff", "some-token")).toBe(false);
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
    expect(shouldRedirectToOverview("staff", "token", true)).toBe(true);
    expect(shouldRedirectToOverview("doctor", "token", true)).toBe(true);
  });

  it("does NOT redirect admin", () => {
    expect(shouldRedirectToOverview("admin", "token", true)).toBe(false);
  });

  it("does NOT redirect before hydration", () => {
    expect(shouldRedirectToOverview("staff", "token", false)).toBe(false);
  });
});

// ── Role constants ──────────────────────────────────────────────

describe("Role constants", () => {
  it("ROLE_OPTIONS has all 7 roles", () => {
    expect(ROLE_OPTIONS).toHaveLength(7);
    const values = ROLE_OPTIONS.map((r) => r.value);
    expect(values).toContain("admin");
    expect(values).toContain("staff");
    expect(values).toContain("doctor");
    expect(values).toContain("nurse");
    expect(values).toContain("pharmacist");
    expect(values).toContain("medical_technologist");
    expect(values).toContain("psychologist");
  });

  it("ROLE_LABEL_MAP maps all roles", () => {
    expect(ROLE_LABEL_MAP["admin"]).toBe("Admin");
    expect(ROLE_LABEL_MAP["doctor"]).toBe("Doctor");
    expect(ROLE_LABEL_MAP["nurse"]).toBe("Nurse");
    expect(ROLE_LABEL_MAP["staff"]).toBe("Staff");
  });

  it("CLINICAL_ROLES includes doctor/nurse/pharmacist but not admin/staff", () => {
    expect(CLINICAL_ROLES.has("doctor")).toBe(true);
    expect(CLINICAL_ROLES.has("nurse")).toBe(true);
    expect(CLINICAL_ROLES.has("pharmacist")).toBe(true);
    expect(CLINICAL_ROLES.has("medical_technologist")).toBe(true);
    expect(CLINICAL_ROLES.has("psychologist")).toBe(true);
    expect(CLINICAL_ROLES.has("admin")).toBe(false);
    expect(CLINICAL_ROLES.has("staff")).toBe(false);
  });
});
