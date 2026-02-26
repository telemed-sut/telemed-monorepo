import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceRegistration } from "@/lib/api";

const {
  mockPush,
  mockReplace,
  mockToastError,
  mockToastSuccess,
  mockToastWarning,
  mockFetchDeviceRegistrations,
  mockCreateDeviceRegistration,
  mockGetErrorMessage,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => {
  const clearToken = vi.fn();
  return {
    mockPush: vi.fn(),
    mockReplace: vi.fn(),
    mockClearToken: clearToken,
    mockToastError: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastWarning: vi.fn(),
    mockFetchDeviceRegistrations: vi.fn(),
    mockCreateDeviceRegistration: vi.fn(),
    mockGetErrorMessage: vi.fn(),
    mockAuthState: {
      token: "test-token",
      hydrated: true,
      clearToken,
    },
    mockLanguageState: {
      language: "en",
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof mockLanguageState) => unknown) => selector(mockLanguageState),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    error: mockToastError,
    success: mockToastSuccess,
    warning: mockToastWarning,
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchDeviceRegistrations: mockFetchDeviceRegistrations,
    createDeviceRegistration: mockCreateDeviceRegistration,
    getErrorMessage: mockGetErrorMessage,
  };
});

function makeDevice(overrides: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    id: "d-1",
    device_id: "ward-bp-001",
    display_name: "Ward BP Device 01",
    notes: "Near nursing station",
    is_active: true,
    last_seen_at: "2026-02-25T06:27:00.000Z",
    deactivated_at: null,
    created_at: "2026-02-25T06:23:00.000Z",
    updated_at: "2026-02-25T06:23:00.000Z",
    ...overrides,
  };
}

async function renderDeviceRegistry() {
  const { DeviceRegistryContent } = await import("@/components/dashboard/device-registry-content");
  return render(<DeviceRegistryContent />);
}

beforeEach(() => {
  vi.clearAllMocks();

  mockGetErrorMessage.mockReturnValue("api error");
  mockFetchDeviceRegistrations.mockResolvedValue({
    items: [makeDevice()],
    total: 1,
    page: 1,
    limit: 20,
  });
  mockCreateDeviceRegistration.mockResolvedValue({
    device: makeDevice(),
    device_secret: "created-secret",
  });
});

afterEach(() => {
  cleanup();
});

describe("DeviceRegistryContent", () => {
  it("renders registered device list after loading", async () => {
    await renderDeviceRegistry();
    await waitFor(() => expect(mockFetchDeviceRegistrations).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /rotate/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /^disable$/i })).toBeTruthy();
  });

  it("shows toast error when refresh fails", async () => {
    mockFetchDeviceRegistrations
      .mockResolvedValueOnce({
        items: [makeDevice()],
        total: 1,
        page: 1,
        limit: 20,
      })
      .mockRejectedValueOnce({ status: 500 });

    await renderDeviceRegistry();
    await screen.findByText("Ward BP Device 01");

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Unable to load device list", {
        description: "api error",
      });
    });
  });

});
