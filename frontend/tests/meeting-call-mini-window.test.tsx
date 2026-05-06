import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MEETING_CALL_NAVIGATION_REQUEST } from "@/lib/meeting-call-navigation";

const {
  mockPush,
  mockRouter,
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
  mockSearchParams,
} = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return {
    mockPush: push,
    mockReplace: replace,
    mockRouter: { push, replace },
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
    mockSearchParams: { value: "pn=Taylor%20Patient" },
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ meetingId: "meeting-1" }),
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(mockSearchParams.value),
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
  destroyZegoInstanceSafely: (instance: { destroy: () => void }) => {
    instance.destroy();
  },
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

function dispatchCallNavigationRequest(href: string) {
  window.dispatchEvent(
    new CustomEvent(MEETING_CALL_NAVIGATION_REQUEST, {
      detail: { href },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.value = "pn=Taylor%20Patient";

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

  it("moves the active call to a mini window before navigating away", async () => {
    await renderMeetingCallPage();

    await waitFor(() => {
      expect(mockJoinRoom).toHaveBeenCalledTimes(1);
    });

    dispatchCallNavigationRequest("/patients");

    await waitFor(() => {
      expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    });
    expect(mockPush).not.toHaveBeenCalledWith("/patients");
    expect(mockDestroy).not.toHaveBeenCalled();

    const popupUrl = mockWindowOpen.mock.calls[0]?.[0];
    const handoffId = new URL(String(popupUrl)).searchParams.get("handoff");
    expect(handoffId).toBeTruthy();

    dispatchPopupMessage({ handoffId: String(handoffId), type: "popup-active" });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/patients");
    });
  });

  it("stays on the active call when navigation handoff pop-up is blocked", async () => {
    mockWindowOpen.mockReturnValueOnce(null);

    await renderMeetingCallPage();

    await waitFor(() => {
      expect(mockJoinRoom).toHaveBeenCalledTimes(1);
    });

    dispatchCallNavigationRequest("/patients");

    await waitFor(() => {
      expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    });
    expect(mockPush).not.toHaveBeenCalledWith("/patients");
    expect(mockDestroy).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Mini window was blocked by browser. Please allow pop-ups for this site and try again."
      )
    ).toBeInTheDocument();
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

  it("returns to the originating meetings week when the doctor leaves the room", async () => {
    mockSearchParams.value =
      "pn=Taylor%20Patient&pt=2026-05-07T10%3A30%3A00.000Z&returnTo=%2Fmeetings%3Fview%3Dweek%26date%3D2026-05-04";

    await renderMeetingCallPage();

    await waitFor(() => {
      expect(mockJoinRoom).toHaveBeenCalledTimes(1);
    });

    const joinOptions = mockJoinRoom.mock.calls[0]?.[0] as
      | { onLeaveRoom?: () => void }
      | undefined;
    expect(joinOptions?.onLeaveRoom).toBeTypeOf("function");

    joinOptions?.onLeaveRoom?.();

    expect(mockPush).toHaveBeenCalledWith("/meetings?view=week&date=2026-05-04");
    expect(screen.queryByText("You have left the room")).not.toBeInTheDocument();
  });

  it("falls back to the appointment week when no meetings return URL is available", async () => {
    mockSearchParams.value = "pn=Taylor%20Patient&pt=2026-05-07T10%3A30%3A00.000Z";

    await renderMeetingCallPage();

    await waitFor(() => {
      expect(mockJoinRoom).toHaveBeenCalledTimes(1);
    });

    const joinOptions = mockJoinRoom.mock.calls[0]?.[0] as
      | { onLeaveRoom?: () => void }
      | undefined;
    joinOptions?.onLeaveRoom?.();

    expect(mockPush).toHaveBeenCalledWith("/meetings?view=week&date=2026-05-04");
  });
});
