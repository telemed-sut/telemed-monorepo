import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIssuePatientMeetingVideoToken,
  mockHeartbeatPatientMeetingPresence,
  mockLeavePatientMeetingPresence,
  mockJoinRoom,
  mockDestroy,
  mockGenerateKitTokenForProduction,
  mockCreateZegoInstance,
} = vi.hoisted(() => ({
  mockIssuePatientMeetingVideoToken: vi.fn(),
  mockHeartbeatPatientMeetingPresence: vi.fn(),
  mockLeavePatientMeetingPresence: vi.fn(),
  mockJoinRoom: vi.fn(),
  mockDestroy: vi.fn(),
  mockGenerateKitTokenForProduction: vi.fn(() => "kit-token"),
  mockCreateZegoInstance: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams("meeting_id=meeting-1&invite_token=invite-token-1"),
}));

vi.mock("@/lib/api", () => ({
  issuePatientMeetingVideoToken: mockIssuePatientMeetingVideoToken,
  heartbeatPatientMeetingPresence: mockHeartbeatPatientMeetingPresence,
  leavePatientMeetingPresence: mockLeavePatientMeetingPresence,
}));

vi.mock("@/lib/zego-uikit", () => ({
  getCallNetworkProfile: () => "standard",
  getDefaultZegoVideoResolution: () => 360,
  loadZegoUIKitPrebuilt: async () => ({
    VideoConference: "video-conference",
    generateKitTokenForProduction: mockGenerateKitTokenForProduction,
    create: mockCreateZegoInstance,
  }),
  preloadZegoUIKitPrebuilt: vi.fn(),
  withTimeout: <T,>(promise: Promise<T>) => promise,
  withRetry: async <T,>(fn: () => Promise<T>) => fn(),
  markPromiseHandled: <T,>(promise: Promise<T>) => {
    void promise.catch(() => {});
    return promise;
  },
  CallStartupMetrics: class {
    mark() {}
    measure() { return 0; }
    recordSummary() { return undefined; }
  },
  getAdaptiveMediaConstraints: () => ({}),
  getMediaReleaseDelay: () => 0,
  API_TIMEOUT_MS: 5000,
}));

async function renderPatientJoinPage() {
  const mod = await import("@/app/patient/join/page");
  return render(<mod.default />);
}

beforeEach(() => {
  vi.clearAllMocks();

  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof window.requestAnimationFrame;

  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: class {
      muted = false;
      volume = 1;
      play() {
        return Promise.resolve();
      }
    },
  });

  mockIssuePatientMeetingVideoToken.mockResolvedValue({
    provider: "zego",
    meeting_id: "meeting-1",
    app_id: 123456,
    room_id: "room-1",
    user_id: "patient-1",
    token: "zego-token-1",
    issued_at: "2026-03-17T00:00:00.000Z",
    expires_at: "2026-03-17T01:00:00.000Z",
  });
  mockHeartbeatPatientMeetingPresence.mockResolvedValue({
    meeting_id: "meeting-1",
    state: "patient_waiting",
    doctor_online: false,
    patient_online: true,
  });
  mockLeavePatientMeetingPresence.mockResolvedValue({
    meeting_id: "meeting-1",
    state: "none",
    doctor_online: false,
    patient_online: false,
  });
  mockCreateZegoInstance.mockImplementation(() => ({
    joinRoom: mockJoinRoom,
    destroy: mockDestroy,
  }));
});

afterEach(() => {
  cleanup();
});

describe("Patient join bootstrap", () => {
  it("does not start presence heartbeats when joinRoom throws during bootstrap", async () => {
    mockJoinRoom.mockImplementation(() => {
      throw new Error("join failed");
    });

    await renderPatientJoinPage();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Taylor Patient" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    await waitFor(() => {
      expect(screen.getByText("join failed")).toBeInTheDocument();
    });

    expect(mockHeartbeatPatientMeetingPresence).not.toHaveBeenCalled();
  });

  it("starts presence only after the room join path succeeds", async () => {
    mockJoinRoom.mockImplementation(() => {});

    await renderPatientJoinPage();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Taylor Patient" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    await waitFor(() => {
      expect(mockJoinRoom).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockHeartbeatPatientMeetingPresence).toHaveBeenCalledTimes(1);
    });
    expect(mockLeavePatientMeetingPresence).not.toHaveBeenCalled();
  });

  it("sends leave only after a heartbeat has succeeded", async () => {
    mockJoinRoom.mockImplementation(() => {});

    const { unmount } = await renderPatientJoinPage();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Taylor Patient" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    await waitFor(() => {
      expect(mockHeartbeatPatientMeetingPresence).toHaveBeenCalledTimes(1);
    });
    expect(mockLeavePatientMeetingPresence).not.toHaveBeenCalled();

    unmount();

    await waitFor(() => {
      expect(mockLeavePatientMeetingPresence).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores async join completion after unmount", async () => {
    let resolveToken: ((value: unknown) => void) | undefined;
    const tokenPromise = new Promise((resolve) => {
      resolveToken = resolve;
    });
    mockIssuePatientMeetingVideoToken.mockImplementationOnce(
      () => tokenPromise as Promise<unknown>
    );

    const { unmount } = await renderPatientJoinPage();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Taylor Patient" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    unmount();

    resolveToken?.({
      provider: "zego",
      meeting_id: "meeting-1",
      app_id: 123456,
      room_id: "room-1",
      user_id: "patient-1",
      token: "zego-token-1",
      issued_at: "2026-03-17T00:00:00.000Z",
      expires_at: "2026-03-17T01:00:00.000Z",
    });

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockJoinRoom).not.toHaveBeenCalled();
    expect(mockHeartbeatPatientMeetingPresence).not.toHaveBeenCalled();
  });
});
