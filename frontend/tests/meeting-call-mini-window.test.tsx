import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPush,
  mockIssueMeetingVideoToken,
  mockCreateMeetingPatientInvite,
  mockHeartbeatDoctorMeetingPresence,
  mockLeaveDoctorMeetingPresence,
  mockHydrate,
  mockJoinRoom,
  mockDestroy,
  mockGenerateKitTokenForProduction,
  mockCreateZegoInstance,
  mockWindowOpen,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockIssueMeetingVideoToken: vi.fn(),
  mockCreateMeetingPatientInvite: vi.fn(),
  mockHeartbeatDoctorMeetingPresence: vi.fn(),
  mockLeaveDoctorMeetingPresence: vi.fn(),
  mockHydrate: vi.fn().mockResolvedValue(undefined),
  mockJoinRoom: vi.fn(),
  mockDestroy: vi.fn(),
  mockGenerateKitTokenForProduction: vi.fn(() => "kit-token"),
  mockCreateZegoInstance: vi.fn(),
  mockWindowOpen: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ meetingId: "meeting-1" }),
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams("pn=Taylor%20Patient"),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: {
    token: string;
    role: string;
    hydrate: () => Promise<void>;
  }) => unknown) =>
    selector({
      token: "doctor-jwt-token",
      role: "doctor",
      hydrate: mockHydrate,
    }),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: { language: "en" }) => unknown) =>
    selector({ language: "en" }),
}));

vi.mock("@/lib/api", () => ({
  createMeetingPatientInvite: mockCreateMeetingPatientInvite,
  heartbeatDoctorMeetingPresence: mockHeartbeatDoctorMeetingPresence,
  issueMeetingVideoToken: mockIssueMeetingVideoToken,
  leaveDoctorMeetingPresence: mockLeaveDoctorMeetingPresence,
}));

vi.mock("@/lib/zego-uikit", () => ({
  loadZegoUIKitPrebuilt: async () => ({
    VideoConference: "video-conference",
    generateKitTokenForProduction: mockGenerateKitTokenForProduction,
    create: mockCreateZegoInstance,
  }),
  getCallNetworkProfile: () => "standard",
  getDefaultZegoVideoResolution: () => 360,
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

async function renderMeetingCallPage() {
  const mod = await import("@/app/(dashboard)/meetings/call/[meetingId]/page");
  return render(<mod.default />);
}

async function openMiniWindowAndGetHandoffId() {
  await renderMeetingCallPage();

  await waitFor(() => {
    expect(mockJoinRoom).toHaveBeenCalledTimes(1);
  });

  const openMiniWindowButton = await screen.findByRole("button", {
    name: "Open mini window",
  });

  fireEvent.click(openMiniWindowButton);

  const popupUrl = mockWindowOpen.mock.calls[0]?.[0];
  expect(typeof popupUrl).toBe("string");
  const handoffId = new URL(String(popupUrl)).searchParams.get("handoff");
  expect(handoffId).toBeTruthy();
  return String(handoffId);
}

function dispatchPopupMessage({
  handoffId,
  type,
  meetingId = "meeting-1",
}: {
  handoffId: string;
  type: string;
  meetingId?: string;
}) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "telemed-mini-window",
        meetingId,
        handoffId,
        type,
      },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });

  mockIssueMeetingVideoToken.mockResolvedValue({
    provider: "zego",
    meeting_id: "meeting-1",
    app_id: 123456,
    room_id: "room-1",
    user_id: "doctor-1",
    token: "zego-token-1",
    issued_at: "2026-03-17T00:00:00.000Z",
    expires_at: "2026-03-17T01:00:00.000Z",
  });
  mockCreateMeetingPatientInvite.mockResolvedValue({
    meeting_id: "meeting-1",
    room_id: "room-1",
    invite_token: "invite-token-1",
    short_code: "ABCD1234",
    invite_url: "https://example.com/p/ABCD1234",
    issued_at: "2026-03-17T00:00:00.000Z",
    expires_at: "2026-03-17T01:00:00.000Z",
  });
  mockHeartbeatDoctorMeetingPresence.mockResolvedValue({
    meeting_id: "meeting-1",
    state: "doctor_only",
    doctor_online: true,
    patient_online: false,
  });
  mockLeaveDoctorMeetingPresence.mockResolvedValue({
    meeting_id: "meeting-1",
    state: "none",
    doctor_online: false,
    patient_online: false,
  });
  mockCreateZegoInstance.mockImplementation(() => ({
    joinRoom: mockJoinRoom,
    destroy: mockDestroy,
  }));
  mockJoinRoom.mockImplementation(() => {});

  mockWindowOpen.mockReturnValue({
    closed: false,
    focus: vi.fn(),
    close: vi.fn(),
  });
  window.open = mockWindowOpen as typeof window.open;
});

afterEach(() => {
  cleanup();
});

describe("Meeting call mini-window handoff", () => {
  it("keeps the main call active until the popup reports it is active", async () => {
    const handoffId = await openMiniWindowAndGetHandoffId();

    dispatchPopupMessage({ handoffId, type: "popup-mounted" });

    await waitFor(() => {
      expect(screen.queryByText("Call is continuing in the mini window")).not.toBeInTheDocument();
    });
    expect(mockDestroy).not.toHaveBeenCalled();

    dispatchPopupMessage({ handoffId, type: "popup-active" });

    await waitFor(() => {
      expect(
        screen.getByText("Call is continuing in the mini window")
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  it("ignores popup messages with mismatched handoff ids", async () => {
    const handoffId = await openMiniWindowAndGetHandoffId();

    dispatchPopupMessage({ handoffId: "wrong-handoff", type: "popup-active" });

    await waitFor(() => {
      expect(screen.queryByText("Call is continuing in the mini window")).not.toBeInTheDocument();
    });
    expect(mockDestroy).not.toHaveBeenCalled();

    dispatchPopupMessage({ handoffId, type: "popup-active" });

    await waitFor(() => {
      expect(
        screen.getByText("Call is continuing in the mini window")
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  it("ignores popup messages with mismatched meeting ids", async () => {
    const handoffId = await openMiniWindowAndGetHandoffId();

    dispatchPopupMessage({
      handoffId,
      type: "popup-active",
      meetingId: "meeting-2",
    });

    await waitFor(() => {
      expect(screen.queryByText("Call is continuing in the mini window")).not.toBeInTheDocument();
    });
    expect(mockDestroy).not.toHaveBeenCalled();

    dispatchPopupMessage({ handoffId, type: "popup-active" });

    await waitFor(() => {
      expect(
        screen.getByText("Call is continuing in the mini window")
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  it("keeps the main call active when the popup fails to join", async () => {
    const handoffId = await openMiniWindowAndGetHandoffId();

    dispatchPopupMessage({ handoffId, type: "popup-failed" });

    await waitFor(() => {
      expect(screen.queryByText("Call is continuing in the mini window")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open mini window" })).toBeInTheDocument();
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it("resumes the main call when the popup closes after takeover", async () => {
    const handoffId = await openMiniWindowAndGetHandoffId();

    dispatchPopupMessage({ handoffId, type: "popup-active" });

    await waitFor(() => {
      expect(
        screen.getByText("Call is continuing in the mini window")
      ).toBeInTheDocument();
    });

    const joinCallsBeforeResume = mockJoinRoom.mock.calls.length;
    dispatchPopupMessage({ handoffId, type: "popup-closing" });

    await waitFor(() => {
      expect(screen.queryByText("Call is continuing in the mini window")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockJoinRoom.mock.calls.length).toBeGreaterThan(joinCallsBeforeResume);
    });
  });
});
