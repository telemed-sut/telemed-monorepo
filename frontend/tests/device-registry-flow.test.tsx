import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceRegistration } from "@/lib/api";

const {
  mockPush,
  mockReplace,
  mockToastDismiss,
  mockToastError,
  mockToastSuccess,
  mockToastWarning,
  mockFetchDeviceRegistrations,
  mockCreateDeviceRegistration,
  mockUpdateDeviceRegistration,
  mockDeleteDeviceRegistration,
  mockGetErrorMessage,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => {
  const clearToken = vi.fn();
  return {
    mockPush: vi.fn(),
    mockReplace: vi.fn(),
    mockClearToken: clearToken,
    mockToastDismiss: vi.fn(),
    mockToastError: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastWarning: vi.fn(),
    mockFetchDeviceRegistrations: vi.fn(),
    mockCreateDeviceRegistration: vi.fn(),
    mockUpdateDeviceRegistration: vi.fn(),
    mockDeleteDeviceRegistration: vi.fn(),
    mockGetErrorMessage: vi.fn(),
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
    dismiss: mockToastDismiss,
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
    deleteDeviceRegistration: mockDeleteDeviceRegistration,
    getErrorMessage: mockGetErrorMessage,
  };
});

function makeDevice(overrides: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    id: "d-1",
    device_id: "ward-bp-001",
    display_name: "Ward BP Device 01",
    notes: "Near nursing station",
    default_measurement_type: "lung_sound",
    is_active: true,
    last_seen_at: "2026-02-25T06:27:00.000Z",
    deactivated_at: null,
    created_at: "2026-02-25T06:23:00.000Z",
    updated_at: "2026-02-25T06:23:00.000Z",
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
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
    device: makeDevice({ id: "d-2", device_id: "ward-bp-002", display_name: "Ward BP Device 02" }),
    device_secret: "generated-secret-123",
  });
  mockUpdateDeviceRegistration.mockResolvedValue(makeDevice({ is_active: false }));
  mockDeleteDeviceRegistration.mockResolvedValue({
    message: "Device ward-bp-001 deleted.",
    device_id: "ward-bp-001",
  });
});

afterEach(() => {
  cleanup();
});

describe("Device registry flow", () => {
  it("registers a device", async () => {
    const initialDevice = makeDevice();
    const createdDevice = makeDevice({ id: "d-2", device_id: "ward-bp-002", display_name: "Ward BP Device 02" });
    const createRequest = createDeferred<{ device: DeviceRegistration; device_secret: string }>();
    mockFetchDeviceRegistrations
      .mockResolvedValueOnce({
        items: [initialDevice],
        total: 1,
        page: 1,
        limit: 20,
      })
      .mockResolvedValueOnce({
        items: [createdDevice, initialDevice],
        total: 2,
        page: 1,
        limit: 20,
      });
    mockCreateDeviceRegistration.mockReturnValueOnce(createRequest.promise);

    await renderDeviceRegistry();
    await screen.findByText("Ward BP Device 01");

    fireEvent.click(screen.getByRole("button", { name: /new device/i }));
    await screen.findByText("Register new device");

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
          default_measurement_type: "lung_sound",
          is_active: true,
        },
        "test-token",
      );
    });
    expect(await screen.findByText("Ward BP Device 02")).toBeInTheDocument();
    expect(screen.getByText("ward-bp-002")).toBeInTheDocument();

    createRequest.resolve({
      device: createdDevice,
      device_secret: "generated-secret-123",
    });

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Device registered successfully");
    });
    await waitFor(() => {
      expect(mockFetchDeviceRegistrations).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("One-time Secret (Save now)")).toBeNull();
  });

  it("updates the status row immediately after clicking disable", async () => {
    const activeDevice = makeDevice();
    const inactiveDevice = makeDevice({
      is_active: false,
      deactivated_at: "2026-02-25T06:30:00.000Z",
      updated_at: "2026-02-25T06:30:00.000Z",
    });
    const updateRequest = createDeferred<DeviceRegistration>();
    mockFetchDeviceRegistrations
      .mockResolvedValueOnce({
        items: [activeDevice],
        total: 1,
        page: 1,
        limit: 20,
      })
      .mockResolvedValueOnce({
        items: [inactiveDevice],
        total: 1,
        page: 1,
        limit: 20,
      });
    mockUpdateDeviceRegistration.mockReturnValueOnce(updateRequest.promise);

    await renderDeviceRegistry();
    await screen.findByText("Ward BP Device 01");

    const row = screen.getByText("Ward BP Device 01").closest("tr");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /disable ward bp device 01/i }));
    expect(mockUpdateDeviceRegistration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /disable device/i }));

    await waitFor(() => {
      expect(mockUpdateDeviceRegistration).toHaveBeenCalledWith(
        "ward-bp-001",
        { is_active: false },
        "test-token",
      );
    });
    const item = screen.getByText("Ward BP Device 01").closest("tr");
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByText("Inactive")).toBeInTheDocument();

    updateRequest.resolve(inactiveDevice);
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Device deactivated", {
        id: "device-registry-result",
      });
    });
  });

  it("opens the edit sheet and saves updated device details", async () => {
    const updatedDevice = makeDevice({
      display_name: "Ward BP Device Renamed",
      notes: "Moved to ICU zone B",
      default_measurement_type: "heart_sound",
      updated_at: "2026-02-25T06:40:00.000Z",
    });
    mockUpdateDeviceRegistration.mockResolvedValueOnce(updatedDevice);

    await renderDeviceRegistry();
    await screen.findByText("Ward BP Device 01");

    fireEvent.click(screen.getByRole("button", { name: /edit ward bp device 01/i }));
    await screen.findByText("Edit device");

    fireEvent.change(screen.getByDisplayValue("Ward BP Device 01"), {
      target: { value: "Ward BP Device Renamed" },
    });
    fireEvent.change(screen.getByDisplayValue("Near nursing station"), {
      target: { value: "Moved to ICU zone B" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateDeviceRegistration).toHaveBeenCalledWith(
        "ward-bp-001",
        {
          display_name: "Ward BP Device Renamed",
          notes: "Moved to ICU zone B",
          default_measurement_type: "lung_sound",
        },
        "test-token",
      );
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Device details updated", {
        id: "device-registry-result",
      });
    });
  });

  it("removes the row immediately after clicking delete", async () => {
    const deleteRequest = createDeferred<{ message: string; device_id: string }>();
    mockFetchDeviceRegistrations
      .mockResolvedValueOnce({
        items: [makeDevice()],
        total: 1,
        page: 1,
        limit: 20,
      })
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
      });
    mockDeleteDeviceRegistration.mockReturnValueOnce(deleteRequest.promise);

    await renderDeviceRegistry();
    await screen.findByText("Ward BP Device 01");

    const row = screen.getByText("Ward BP Device 01").closest("tr");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /delete ward bp device 01/i }));
    expect(mockDeleteDeviceRegistration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete device/i }));

    await waitFor(() => {
      expect(mockDeleteDeviceRegistration).toHaveBeenCalledWith("ward-bp-001", "test-token");
    });
    await waitFor(() => {
      expect(screen.queryByText("Ward BP Device 01")).not.toBeInTheDocument();
    });

    deleteRequest.resolve({
      message: "Device ward-bp-001 deleted.",
      device_id: "ward-bp-001",
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Device deleted", {
        id: "device-registry-result",
      });
    });
  });
});
