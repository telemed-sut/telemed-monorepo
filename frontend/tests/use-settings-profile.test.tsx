import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockToastError,
  mockToastSuccess,
  mockFetchAccessProfile,
  mockFetchCurrentUser,
  mockUpdateUser,
} = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockFetchAccessProfile: vi.fn(),
  mockFetchCurrentUser: vi.fn(),
  mockUpdateUser: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchAccessProfile: mockFetchAccessProfile,
    fetchCurrentUser: mockFetchCurrentUser,
    updateUser: mockUpdateUser,
  };
});

describe("useSettingsProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets draft fields and saves profile changes", async () => {
    const { useSettingsProfile } = await import(
      "@/components/dashboard/settings/use-settings-profile"
    );

    const baseUser = {
      id: "doctor-1",
      email: "doctor@example.com",
      first_name: "Test",
      last_name: "Doctor",
      role: "doctor",
      verification_status: "verified" as const,
      two_factor_enabled: true,
      mfa_verified: true,
      mfa_authenticated_at: "2026-04-17T03:30:00.000Z",
      mfa_recent_for_privileged_actions: true,
      auth_source: "local" as const,
      sso_provider: null,
    };

    const router = {
      replace: vi.fn(),
    };
    const setAuthCurrentUser = vi.fn();
    const clearToken = vi.fn();
    const getTokenTTL = vi.fn(() => 1800);

    mockFetchCurrentUser.mockResolvedValue(baseUser);
    mockFetchAccessProfile.mockResolvedValue({
      has_privileged_access: false,
      access_class: null,
      access_class_revealed: false,
      can_manage_privileged_admins: false,
      can_manage_security_operations: false,
      can_bootstrap_privileged_roles: false,
    });
    mockUpdateUser.mockResolvedValue({
      ...baseUser,
      first_name: "Updated",
    });

    const { result } = renderHook(() =>
      useSettingsProfile({
        token: "settings-token",
        userId: "doctor-1",
        hydrated: true,
        authCurrentUser: baseUser,
        setAuthCurrentUser,
        clearToken,
        getTokenTTL,
        router,
        language: "en",
        ssoProvider: null,
        mfaVerified: true,
        mfaAuthenticatedAt: "2026-04-17T03:30:00.000Z",
      }),
    );

    await waitFor(() => {
      expect(result.current.firstName).toBe("Test");
      expect(result.current.lastName).toBe("Doctor");
    });

    act(() => {
      result.current.setFirstName("Changed");
    });

    expect(result.current.hasProfileChanges).toBe(true);

    act(() => {
      result.current.handleResetProfile();
    });

    expect(result.current.firstName).toBe("Test");
    expect(result.current.hasProfileChanges).toBe(false);

    act(() => {
      result.current.setFirstName("Updated");
    });

    await act(async () => {
      await result.current.handleSaveProfile({
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLFormElement>);
    });

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith(
        "doctor-1",
        {
          first_name: "Updated",
          last_name: "Doctor",
        },
        "settings-token",
      );
    });

    expect(setAuthCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: "Updated",
        last_name: "Doctor",
      }),
    );
    expect(result.current.firstName).toBe("Updated");
    expect(result.current.hasProfileChanges).toBe(false);
    expect(mockToastSuccess).toHaveBeenCalledWith("Profile updated");
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
