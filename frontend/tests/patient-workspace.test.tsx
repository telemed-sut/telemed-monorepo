import type { HTMLAttributes, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPush,
  mockPrefetch,
  mockReplace,
  mockFetchPatient,
  mockFetchMeetings,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockPrefetch: vi.fn(),
  mockReplace: vi.fn(),
  mockFetchPatient: vi.fn(),
  mockFetchMeetings: vi.fn(),
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
  useRouter: () => ({
    push: mockPush,
    prefetch: mockPrefetch,
    replace: mockReplace,
  }),
  usePathname: () => "/patients/patient-1",
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
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
    fetchPatient: mockFetchPatient,
    fetchMeetings: mockFetchMeetings,
  };
});

describe("patient workspace overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  afterEach(() => {
    cleanup();
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
});
