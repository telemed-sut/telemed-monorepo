/**
 * Tests for the User type interface and API function signatures.
 * Validates that the types align with the backend schema.
 */
import { describe, it, expect } from "vitest";
import type { User, UserCreate, UserUpdate, UserListResponse } from "@/lib/api";

describe("User type structure", () => {
  it("User has required fields without is_superuser", () => {
    const user: User = {
      id: "123",
      email: "test@example.com",
      first_name: "Test",
      last_name: "User",
      role: "doctor",
      is_active: true,
    };

    expect(user.id).toBeDefined();
    expect(user.email).toBeDefined();
    expect(user.role).toBeDefined();
    expect(user.is_active).toBe(true);
    // Verify is_superuser does NOT exist on the type
    expect("is_superuser" in user).toBe(false);
  });

  it("User supports clinical profile fields", () => {
    const doctor: User = {
      id: "456",
      email: "doc@example.com",
      first_name: "Dr",
      last_name: "Smith",
      role: "doctor",
      is_active: true,
      specialty: "Cardiology",
      department: "Internal Medicine",
      license_no: "MD12345",
      license_expiry: "2027-12-31T00:00:00Z",
      verification_status: "verified",
    };

    expect(doctor.specialty).toBe("Cardiology");
    expect(doctor.department).toBe("Internal Medicine");
    expect(doctor.license_no).toBe("MD12345");
    expect(doctor.license_expiry).toBe("2027-12-31T00:00:00Z");
    expect(doctor.verification_status).toBe("verified");
  });

  it("User supports deleted_at for soft delete", () => {
    const deletedUser: User = {
      id: "789",
      email: "deleted@example.com",
      first_name: null,
      last_name: null,
      role: "medical_student",
      is_active: false,
      deleted_at: "2026-02-15T10:00:00Z",
    };

    expect(deletedUser.deleted_at).toBe("2026-02-15T10:00:00Z");
    expect(deletedUser.is_active).toBe(false);
  });

  it("User supports null deleted_at for active users", () => {
    const activeUser: User = {
      id: "000",
      email: "active@example.com",
      first_name: "Active",
      last_name: "User",
      role: "admin",
      is_active: true,
      deleted_at: null,
    };

    expect(activeUser.deleted_at).toBeNull();
  });
});

describe("UserCreate type structure", () => {
  it("supports all professional fields", () => {
    const create: UserCreate = {
      email: "new@example.com",
      password: "password123",
      first_name: "New",
      last_name: "Doctor",
      role: "doctor",
      is_active: true,
      specialty: "Dermatology",
      department: "Skin",
      license_no: "MD99999",
      license_expiry: "2028-06-30",
      verification_status: "unverified",
    };

    expect(create.specialty).toBe("Dermatology");
    expect(create.license_no).toBe("MD99999");
    expect(create.is_active).toBe(true);
  });

  it("supports medical_student as a non-clinical invite-only role", () => {
    const create: UserCreate = {
      email: "student@example.com",
      password: "password123",
      first_name: "Med",
      last_name: "Student",
      role: "medical_student",
      is_active: true,
      verification_status: "unverified",
    };

    expect(create.role).toBe("medical_student");
    expect(create.license_no).toBeUndefined();
  });
});

describe("UserUpdate type structure", () => {
  it("all fields are optional", () => {
    const minimalUpdate: UserUpdate = {};
    expect(Object.keys(minimalUpdate)).toHaveLength(0);

    const partialUpdate: UserUpdate = {
      first_name: "Updated",
      is_active: false,
    };
    expect(partialUpdate.first_name).toBe("Updated");
    expect(partialUpdate.is_active).toBe(false);
    expect(partialUpdate.email).toBeUndefined();
  });

  it("supports professional field updates", () => {
    const update: UserUpdate = {
      specialty: "New Specialty",
      license_no: "NEW12345",
      verification_status: "verified",
    };
    expect(update.specialty).toBe("New Specialty");
  });
});

describe("UserListResponse type structure", () => {
  it("has pagination fields", () => {
    const response: UserListResponse = {
      items: [],
      page: 1,
      limit: 10,
      total: 0,
    };

    expect(response.items).toEqual([]);
    expect(response.page).toBe(1);
    expect(response.limit).toBe(10);
    expect(response.total).toBe(0);
  });
});
