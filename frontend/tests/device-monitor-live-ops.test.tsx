import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchDeviceLiveSessions,
  mockFetchDeviceInventory,
  mockFetchPatients,
  mockCreateDeviceExamSession,
  mockActivateDeviceExamSession,
  mockCompleteDeviceExamSession,
  mockCancelDeviceExamSession,
  mockFetchDeviceLungSoundReviewQueue,
  mockResolveDeviceLungSoundReviewItem,
} = vi.hoisted(() => ({
  mockFetchDeviceLiveSessions: vi.fn(),
  mockFetchDeviceInventory: vi.fn(),
  mockFetchPatients: vi.fn(),
  mockCreateDeviceExamSession: vi.fn(),
  mockActivateDeviceExamSession: vi.fn(),
  mockCompleteDeviceExamSession: vi.fn(),
  mockCancelDeviceExamSession: vi.fn(),
  mockFetchDeviceLungSoundReviewQueue: vi.fn(),
  mockResolveDeviceLungSoundReviewItem: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    API_BASE_URL: "/api",
    isProbablyJwt: vi.fn(() => true),
    fetchDeviceLiveSessions: mockFetchDeviceLiveSessions,
    fetchDeviceInventory: mockFetchDeviceInventory,
    fetchPatients: mockFetchPatients,
    createDeviceExamSession: mockCreateDeviceExamSession,
    activateDeviceExamSession: mockActivateDeviceExamSession,
    completeDeviceExamSession: mockCompleteDeviceExamSession,
    cancelDeviceExamSession: mockCancelDeviceExamSession,
    fetchDeviceLungSoundReviewQueue: mockFetchDeviceLungSoundReviewQueue,
    resolveDeviceLungSoundReviewItem: mockResolveDeviceLungSoundReviewItem,
  };
});

async function renderLiveOps() {
  const { DeviceMonitorLiveOps } = await import("@/components/dashboard/device-monitor-live-ops");
  return render(
    <DeviceMonitorLiveOps
      token="test-token"
      language="en"
      autoRefreshEnabled={false}
      refreshIntervalMs={5000}
      canManageSessions
      enableStream={false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchDeviceLiveSessions.mockResolvedValue({
    items: [
      {
        session_id: "session-1",
        patient_id: "patient-1",
        patient_name: "Jamie Rivera",
        encounter_id: null,
        device_id: "lung-cart-01",
        device_display_name: "Lung Cart 01",
        measurement_type: "lung_sound",
        status: "active",
        started_at: "2026-04-22T07:30:00.000Z",
        last_seen_at: "2026-04-22T07:31:10.000Z",
        freshness_status: "fresh",
        seconds_since_last_seen: 18,
        pairing_code: "PAIR01",
      },
    ],
    total: 1,
    active_count: 1,
    pending_pair_count: 0,
    stale_count: 0,
    generated_at: "2026-04-22T07:31:20.000Z",
  });
  mockFetchDeviceInventory.mockResolvedValue({
    items: [
      {
        device_id: "lung-cart-01",
        device_display_name: "Lung Cart 01",
        default_measurement_type: "lung_sound",
        is_active: true,
        device_last_seen_at: "2026-04-22T07:31:10.000Z",
        availability_status: "in_use",
        session_id: "session-1",
        patient_id: "patient-1",
        patient_name: "Jamie Rivera",
        measurement_type: "lung_sound",
        session_started_at: "2026-04-22T07:30:00.000Z",
        session_last_seen_at: "2026-04-22T07:31:10.000Z",
        freshness_status: "fresh",
      },
      {
        device_id: "lung-cart-02",
        device_display_name: "Lung Cart 02",
        default_measurement_type: "multi",
        is_active: true,
        device_last_seen_at: null,
        availability_status: "busy",
        session_id: null,
        patient_id: null,
        patient_name: null,
        measurement_type: null,
        session_started_at: null,
        session_last_seen_at: "2026-04-22T07:30:45.000Z",
        freshness_status: "fresh",
      },
      {
        device_id: "lung-cart-03",
        device_display_name: "Lung Cart 03",
        default_measurement_type: "lung_sound",
        is_active: true,
        device_last_seen_at: "2026-04-22T07:29:45.000Z",
        availability_status: "idle",
        session_id: null,
        patient_id: null,
        patient_name: null,
        measurement_type: null,
        session_started_at: null,
        session_last_seen_at: null,
        freshness_status: null,
      },
    ],
    total: 3,
    idle_count: 1,
    in_use_count: 1,
    busy_count: 1,
    inactive_count: 0,
    generated_at: "2026-04-22T07:31:20.000Z",
  });
  mockFetchPatients.mockResolvedValue({
    items: [
      {
        id: "patient-2",
        first_name: "Nora",
        last_name: "Chen",
        date_of_birth: "1988-02-10",
        gender: "female",
        ward: "OPD",
        phone: null,
        email: null,
        address: null,
      },
    ],
    page: 1,
    limit: 8,
    total: 1,
  });
  mockCreateDeviceExamSession.mockResolvedValue({
    id: "session-2",
    patient_id: "patient-2",
    encounter_id: null,
    device_id: "lung-cart-03",
    measurement_type: "lung_sound",
    status: "active",
    pairing_code: "PAIR02",
    notes: null,
    started_by: "doctor-1",
    ended_by: null,
    started_at: "2026-04-22T07:35:00.000Z",
    ended_at: null,
    last_seen_at: null,
    created_at: "2026-04-22T07:35:00.000Z",
    updated_at: "2026-04-22T07:35:00.000Z",
  });
  mockCompleteDeviceExamSession.mockResolvedValue({
    id: "session-1",
    patient_id: "patient-1",
    encounter_id: null,
    device_id: "lung-cart-01",
    measurement_type: "lung_sound",
    status: "completed",
    pairing_code: "PAIR01",
    notes: "Completed from live device operations.",
    started_by: "doctor-1",
    ended_by: "doctor-1",
    started_at: "2026-04-22T07:30:00.000Z",
    ended_at: "2026-04-22T07:36:00.000Z",
    last_seen_at: "2026-04-22T07:31:10.000Z",
    created_at: "2026-04-22T07:30:00.000Z",
    updated_at: "2026-04-22T07:36:00.000Z",
  });
  mockFetchDeviceLungSoundReviewQueue.mockResolvedValue({
    items: [
      {
        record_id: "record-1",
        device_id: "lung-cart-01",
        routing_status: "needs_review",
        position: 2,
        recorded_at: "2026-04-22T07:30:20.000Z",
        server_received_at: "2026-04-22T07:30:21.000Z",
        patient_id: "patient-1",
        patient_name: "Jamie Rivera",
        device_exam_session_id: "session-1",
        session_status: "review_needed",
        conflict_metadata: { reason: "transition_window_overlap" },
      },
    ],
    total: 1,
    needs_review_count: 1,
    unmatched_count: 0,
    generated_at: "2026-04-22T07:31:20.000Z",
  });
  mockResolveDeviceLungSoundReviewItem.mockResolvedValue({
    record_id: "record-1",
    device_id: "lung-cart-01",
    routing_status: "verified",
    position: 2,
    recorded_at: "2026-04-22T07:30:20.000Z",
    server_received_at: "2026-04-22T07:30:21.000Z",
    patient_id: "patient-1",
    patient_name: "Jamie Rivera",
    device_exam_session_id: "session-1",
    session_status: "active",
    conflict_metadata: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("DeviceMonitorLiveOps", () => {
  it("renders live session and inventory snapshot data", async () => {
    await renderLiveOps();

    await waitFor(() => {
      expect(mockFetchDeviceLiveSessions).toHaveBeenCalledTimes(1);
      expect(mockFetchDeviceInventory).toHaveBeenCalledTimes(1);
      expect(mockFetchDeviceLungSoundReviewQueue).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("Live Device Operations")).toBeInTheDocument();
    expect(screen.getByText("Start device session")).toBeInTheDocument();
    expect(screen.getAllByText("Jamie Rivera").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Lung Cart 01").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Lung Cart 03")).toBeInTheDocument();
    expect(screen.getByText(/PAIR01/)).toBeInTheDocument();
    expect(screen.getByText("Assigned to another patient you cannot inspect here.")).toBeInTheDocument();
    expect(screen.getByText("Busy devices")).toBeInTheDocument();
    expect(screen.getByText("Review queue")).toBeInTheDocument();
    expect(screen.getByText("Transition overlap")).toBeInTheDocument();
  });

  it("completes an active session from the live session row", async () => {
    const user = userEvent.setup();
    await renderLiveOps();

    await screen.findByText("Complete");
    await user.click(screen.getByRole("button", { name: /Complete/i }));

    await waitFor(() => {
      expect(mockCompleteDeviceExamSession).toHaveBeenCalledWith(
        "test-token",
        "session-1",
        { notes: "Completed from live device operations." },
      );
    });
    expect(mockFetchDeviceLiveSessions).toHaveBeenCalledTimes(2);
  });

  it("verifies a flagged review item", async () => {
    const user = userEvent.setup();
    await renderLiveOps();

    await screen.findByText("Review queue");
    const verifyButtons = screen.getAllByRole("button", { name: /^Verify$/i });
    await user.click(verifyButtons[0]);

    await waitFor(() => {
      expect(mockResolveDeviceLungSoundReviewItem).toHaveBeenCalledWith(
        "test-token",
        "record-1",
        {
          resolution: "verified",
          target_session_id: "session-1",
          note: "Resolved from live review queue.",
        },
      );
    });
  });
});
