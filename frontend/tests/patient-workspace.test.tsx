import type { HTMLAttributes, ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPush,
  mockPrefetch,
  mockReplace,
  mockRouter,
  mockFetchPatient,
  mockFetchMeetings,
  mockFetchPressureReadings,
  mockFetchVitalsTrends,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockPrefetch: vi.fn(),
  mockReplace: vi.fn(),
  mockRouter: {} as {
    push: ReturnType<typeof vi.fn>;
    prefetch: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
  },
  mockFetchPatient: vi.fn(),
  mockFetchMeetings: vi.fn(),
  mockFetchPressureReadings: vi.fn(),
  mockFetchVitalsTrends: vi.fn(),
  mockAuthState: {
    token: "test-token" as string | null,
    userId: "user-a" as string | null,
    clearToken: vi.fn(),
  },
  mockLanguageState: {
    language: "en",
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/patients/patient-1",
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector?: (state: typeof mockAuthState) => unknown) =>
    typeof selector === "function" ? selector(mockAuthState) : mockAuthState,
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof mockLanguageState) => unknown) => selector(mockLanguageState),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  LazyMotion: ({ children }: { children: ReactNode }) => <>{children}</>,
  domAnimation: {},
  m: {
    div: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
    section: (props: HTMLAttributes<HTMLElement>) => <section {...props} />,
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    API_BASE_URL: "/api",
    fetchPatient: mockFetchPatient,
    fetchMeetings: mockFetchMeetings,
    fetchPatientPressureReadings: mockFetchPressureReadings,
    fetchPatientVitalsTrends: mockFetchVitalsTrends,
  };
});

let mockStreamController: ReadableStreamDefaultController<Uint8Array> | null = null;

const textEncoder = new TextEncoder();

const createPatientStreamResponse = () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      mockStreamController = controller;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
};

const emitPatientStreamEvent = (payload: unknown) => {
  mockStreamController?.enqueue(
    textEncoder.encode(`event: message\r\ndata: ${JSON.stringify(payload)}\r\n\r\n`)
  );
};

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe("patient workspace overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(createPatientStreamResponse())));
    mockRouter.push = mockPush;
    mockRouter.prefetch = mockPrefetch;
    mockRouter.replace = mockReplace;
    mockStreamController = null;
    window.localStorage.clear();
    mockAuthState.token = "test-token";
    mockAuthState.userId = "user-a";
    mockFetchPatient.mockResolvedValue({
      id: "patient-1",
      first_name: "John",
      last_name: "Doe",
      date_of_birth: "1990-01-01",
      gender: "male",
      phone: "0812345678",
      email: "john@example.com",
      address: "Bangkok",
    });
    mockFetchMeetings.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 100,
    });
    mockFetchPressureReadings.mockResolvedValue({
      items: [],
      total: 0,
      limit: 10,
      offset: 0,
      latest: null,
    });
    mockFetchVitalsTrends.mockResolvedValue({
      patient_id: "patient-1",
      days: 30,
      trends: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders workspace navigation and focus mode entry", async () => {
    const { PatientDetailContent } = await import("@/components/dashboard/patient-detail");
    render(<PatientDetailContent patientId="patient-1" />);

    expect(await screen.findByText("Patient Workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Heart Sound" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Monitoring" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Timeline" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Devices" })).toBeDisabled();
    expect(screen.getByText("Open Heart Sound")).toBeInTheDocument();
    expect(screen.getByText("Open Advanced Focus Mode")).toBeInTheDocument();
  });

  it("refreshes patient vitals from patient stream events", async () => {
    mockAuthState.token = "header.payload.signature";
    const { PatientDetailContent } = await import("@/components/dashboard/patient-detail");
    render(<PatientDetailContent patientId="patient-1" />);

    expect(await screen.findByText("Patient Workspace")).toBeInTheDocument();
    await waitFor(() => expect(mockFetchPressureReadings).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/patients/patient-1/stream",
      expect.objectContaining({
        credentials: "include",
        headers: { Authorization: "Bearer header.payload.signature" },
        method: "GET",
      })
    );
    await waitFor(() => expect(mockFetchVitalsTrends).toHaveBeenCalled());
    expect(await screen.findByText("Realtime connected")).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
    const initialVitalsTrendCalls = mockFetchVitalsTrends.mock.calls.length;

    act(() => {
      emitPatientStreamEvent({ type: "new_heart_sound", data: { id: "heart-1" } });
    });
    expect(mockFetchPressureReadings).toHaveBeenCalledTimes(1);

    act(() => {
      emitPatientStreamEvent({ type: "new_pressure_reading", data: { id: "pressure-1" } });
    });

    await waitFor(() => expect(mockFetchPressureReadings).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mockFetchVitalsTrends).toHaveBeenCalledTimes(initialVitalsTrendCalls + 1)
    );

    act(() => {
      emitPatientStreamEvent({ type: "new_weight_record", data: { id: "weight-1" } });
    });

    await waitFor(() =>
      expect(mockFetchVitalsTrends).toHaveBeenCalledTimes(initialVitalsTrendCalls + 2)
    );

    act(() => {
      emitPatientStreamEvent({ type: "new_patient_screening", data: { id: "screening-1" } });
    });

    await waitFor(() =>
      expect(mockFetchVitalsTrends).toHaveBeenCalledTimes(initialVitalsTrendCalls + 3)
    );
  });

  it("localizes patient load errors instead of surfacing mixed-language API text", async () => {
    mockFetchPatient.mockRejectedValue(
      Object.assign(new Error("ไม่พบข้อมูลผู้ใช้ที่ต้องการ"), { status: 400 })
    );

    const { PatientDetailContent } = await import("@/components/dashboard/patient-detail");
    render(<PatientDetailContent patientId="patient-missing" />);

    expect(
      await screen.findByRole("heading", { name: "Patient not found", level: 3 })
    ).toBeInTheDocument();
    expect(screen.getByText("Unable to load patient data.")).toBeInTheDocument();
    expect(screen.queryByText("ไม่พบข้อมูลผู้ใช้ที่ต้องการ")).not.toBeInTheDocument();
  });

  it("does not render cached patient data before an authenticated session is available", async () => {
    mockAuthState.token = null;
    window.localStorage.setItem(
      "telemed.patient-workspace.detail.v2:user-a:patient-1",
      JSON.stringify({
        version: 2,
        data: {
          patient: {
            id: "patient-1",
            first_name: "Cached",
            last_name: "Patient",
            date_of_birth: "1990-01-01",
          },
          patientCachedAt: Date.now(),
          meetings: [],
          meetingsTotal: 0,
          meetingsCachedAt: Date.now(),
        },
      })
    );

    const { PatientDetailContent } = await import("@/components/dashboard/patient-detail");
    render(<PatientDetailContent patientId="patient-1" />);

    expect(screen.queryByText("Cached Patient")).not.toBeInTheDocument();
    expect(mockFetchPatient).not.toHaveBeenCalled();

    mockAuthState.token = "test-token";
  });
});

describe("dashboard header patient route titles", () => {
  it("returns patient workspace title for nested patient routes", async () => {
    const { getDashboardPageTitle } = await import("@/components/dashboard/dashboard-route-utils");

    expect(getDashboardPageTitle("/patients", "en")).toBe("Patients");
    expect(getDashboardPageTitle("/patients/patient-1", "en")).toBe("Patient Workspace");
    expect(getDashboardPageTitle("/patients/patient-1/heart-sound", "en")).toBe("Heart Sound");
    expect(getDashboardPageTitle("/patients/patient-1/dense", "en")).toBe("Clinical Focus Mode");
    expect(getDashboardPageTitle("/patients/patient-1", "th")).toBe("พื้นที่ทำงานผู้ป่วย");
    expect(getDashboardPageTitle("/patients/patient-1/heart-sound", "th")).toBe("เสียงหัวใจ");
  });
});

describe("patient workspace cache registry", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("clears only registered patient workspace keys without touching unrelated storage", async () => {
    const {
      clearPatientWorkspaceCache,
      writePatientDetailCache,
      writePatientHeartSoundCache,
    } = await import("@/lib/patient-workspace-cache");

    writePatientDetailCache("user-a", "patient-1", {
      patient: {
        id: "patient-1",
        first_name: "Cached",
        last_name: "Patient",
        date_of_birth: "1990-01-01",
      },
      patientCachedAt: Date.now(),
      meetings: [],
      meetingsTotal: 0,
      meetingsCachedAt: Date.now(),
    });
    writePatientHeartSoundCache("user-a", "patient-1", {
      patient: {
        id: "patient-1",
        first_name: "Cached",
        last_name: "Patient",
        date_of_birth: "1990-01-01",
      },
      patientCachedAt: Date.now(),
      records: [],
      recordsCachedAt: Date.now(),
    });
    window.localStorage.setItem("unrelated-key", "keep-me");

    clearPatientWorkspaceCache();

    expect(
      window.localStorage.getItem("telemed.patient-workspace.detail.v2:user-a:patient-1")
    ).toBeNull();
    expect(
      window.localStorage.getItem("telemed.patient-workspace.heart-sound.v2:user-a:patient-1")
    ).toBeNull();
    expect(window.localStorage.getItem("telemed.patient-workspace._keys")).toBeNull();
    expect(window.localStorage.getItem("unrelated-key")).toBe("keep-me");
  });

  it("refreshes the registry from storage before clearing so cross-tab keys are not missed", async () => {
    const {
      clearPatientWorkspaceCache,
      writePatientDetailCache,
    } = await import("@/lib/patient-workspace-cache");

    writePatientDetailCache("user-a", "patient-1", {
      patient: {
        id: "patient-1",
        first_name: "Cached",
        last_name: "Patient",
        date_of_birth: "1990-01-01",
      },
      patientCachedAt: Date.now(),
      meetings: [],
      meetingsTotal: 0,
      meetingsCachedAt: Date.now(),
    });

    const crossTabKey = "telemed.patient-workspace.heart-sound.v2:user-a:patient-2";
    window.localStorage.setItem(
      crossTabKey,
      JSON.stringify({
        version: 2,
        data: {
          patient: {
            id: "patient-2",
            first_name: "Other",
            last_name: "Patient",
            date_of_birth: "1990-01-01",
          },
          patientCachedAt: Date.now(),
          records: [],
          recordsCachedAt: Date.now(),
        },
      })
    );
    window.localStorage.setItem(
      "telemed.patient-workspace._keys",
      JSON.stringify([
        "telemed.patient-workspace.detail.v2:user-a:patient-1",
        crossTabKey,
      ])
    );

    clearPatientWorkspaceCache();

    expect(
      window.localStorage.getItem("telemed.patient-workspace.detail.v2:user-a:patient-1")
    ).toBeNull();
    expect(window.localStorage.getItem(crossTabKey)).toBeNull();
    expect(window.localStorage.getItem("telemed.patient-workspace._keys")).toBeNull();
  });

  it("sanitizes cached patient workspace data before persisting it to session storage", async () => {
    const {
      readPatientDetailCache,
      writePatientDetailCache,
      readPatientHeartSoundCache,
      writePatientHeartSoundCache,
    } = await import("@/lib/patient-workspace-cache");

    writePatientDetailCache("user-a", "patient-1", {
      patient: {
        id: "patient-1",
        first_name: "Cached",
        last_name: "Patient",
        date_of_birth: "1990-01-01",
        gender: "male",
        phone: "0812345678",
        email: "cached@example.com",
        address: "Bangkok",
        ward: "ICU",
        created_at: "2026-04-10T00:00:00Z",
        updated_at: "2026-04-10T01:00:00Z",
      },
      patientCachedAt: Date.now(),
      meetings: [
        {
          id: "meeting-1",
          date_time: "2026-04-10T09:00:00Z",
          description: "Follow-up",
          note: "Bring results",
          room: "A-12",
          status: "scheduled",
          patient_invite_url: "https://example.com/private-invite",
          doctor: {
            id: "doctor-1",
            email: "doctor@example.com",
            first_name: "Dana",
            last_name: "Sato",
          },
        },
      ],
      meetingsTotal: 1,
      meetingsCachedAt: Date.now(),
    });

    writePatientHeartSoundCache("user-a", "patient-1", {
      patient: {
        id: "patient-1",
        first_name: "Cached",
        last_name: "Patient",
        date_of_birth: "1990-01-01",
        email: "cached@example.com",
      },
      patientCachedAt: Date.now(),
      records: [
        {
          id: "record-1",
          patient_id: "patient-1",
          device_id: "device-1",
          mac_address: "AA:BB:CC:DD:EE:FF",
          position: 4,
          blob_url: "blob:https://example.com/audio",
          storage_key: "heart-sounds/record-1.wav",
          mime_type: "audio/wav",
          duration_seconds: 3.2,
          recorded_at: "2026-04-10T09:05:00Z",
          created_at: "2026-04-10T09:05:00Z",
        },
      ],
      recordsCachedAt: Date.now(),
    });

    const detailRaw = window.sessionStorage.getItem("telemed.patient-workspace.detail.v2:user-a:patient-1");
    const heartSoundRaw = window.sessionStorage.getItem("telemed.patient-workspace.heart-sound.v2:user-a:patient-1");

    expect(detailRaw).toBeTruthy();
    expect(heartSoundRaw).toBeTruthy();
    expect(detailRaw).not.toContain("0812345678");
    expect(detailRaw).not.toContain("cached@example.com");
    expect(detailRaw).not.toContain("Bangkok");
    expect(detailRaw).not.toContain("ICU");
    expect(detailRaw).not.toContain("private-invite");
    expect(heartSoundRaw).not.toContain("cached@example.com");
    expect(heartSoundRaw).not.toContain("1990-01-01");

    const detailSnapshot = readPatientDetailCache("user-a", "patient-1");
    const heartSoundSnapshot = readPatientHeartSoundCache("user-a", "patient-1");

    expect(detailSnapshot?.patient?.first_name).toBe("Cached");
    expect(detailSnapshot?.patient).not.toHaveProperty("phone");
    expect(detailSnapshot?.meetings[0]).not.toHaveProperty("patient_invite_url");
    expect(heartSoundSnapshot?.patient).toEqual({
      id: "patient-1",
      first_name: "Cached",
      last_name: "Patient",
    });
    expect(heartSoundSnapshot?.records[0].mac_address).toBe("AA:BB:CC:DD:EE:FF");
  });
});
