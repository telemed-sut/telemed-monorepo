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
  mockUpdateDeviceRegistration,
  mockGetErrorMessage,
  mockClipboardWriteText,
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
    mockUpdateDeviceRegistration: vi.fn(),
    mockGetErrorMessage: vi.fn(),
    mockClipboardWriteText: vi.fn(),
    mockAuthState: {
      token: "test-token",
      hydrated: true,
      clearToken: clearToken,
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
    updateDeviceRegistration: mockUpdateDeviceRegistration,
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
  Object.assign(navigator, {
    clipboard: {
      writeText: mockClipboardWriteText,
    },
  });

  mockGetErrorMessage.mockReturnValue("api error");
  mockFetchDeviceRegistrations.mockResolvedValue({
    items: [makeDevice()],
    total: 1,
    page: 1,
    limit: 20,
  });
  mockCreateDeviceRegistration.mockResolvedValue({
    device: makeDevice({ id: "d-2", device_id: "ward-bp-002", display_name: "Ward BP Device 02" }),
    device_secret: "generated-secret-123",
  });
  mockUpdateDeviceRegistration.mockResolvedValue(makeDevice({ is_active: false }));
});

afterEach(() => {
  cleanup();
});

describe("Device registry flow", () => {
  it("registers a device and allows copying one-time secret", async () => {
    await renderDeviceRegistry();
    await screen.findByText("Ward BP Device 01");

    fireEvent.change(screen.getByPlaceholderText("e.g. ward-bp-001"), {
      target: { value: "ward-bp-002" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Ward Bed 1 monitor"), {
      target: { value: "Ward BP Device 02" },
    });
    fireEvent.change(screen.getByPlaceholderText("Where this device is placed"), {
      target: { value: "ICU zone A" },
    });

    fireEvent.click(screen.getByRole("button", { name: /register device/i }));

    await waitFor(() => {
      expect(mockCreateDeviceRegistration).toHaveBeenCalledWith(
        {
          device_id: "ward-bp-002",
          display_name: "Ward BP Device 02",
          notes: "ICU zone A",
          is_active: true,
        },
        "test-token",
      );
    });

    expect(screen.getByText("One-time Secret (Save now)")).toBeInTheDocument();
    expect(screen.getByText("generated-secret-123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy secret/i }));

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith("generated-secret-123");
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Secret copied");
    });
  });
});
