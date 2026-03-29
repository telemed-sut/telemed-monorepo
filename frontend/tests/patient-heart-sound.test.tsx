import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockPrefetch,
  mockPush,
  mockFetchPatient,
  mockFetchPatientHeartSounds,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockPrefetch: vi.fn(),
  mockPush: vi.fn(),
  mockFetchPatient: vi.fn(),
  mockFetchPatientHeartSounds: vi.fn(),
  mockAuthState: {
    token: "test-token",
    clearToken: vi.fn(),
  },
  mockLanguageState: {
    language: "en",
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: mockPrefetch,
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

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchPatient: mockFetchPatient,
    fetchPatientHeartSounds: mockFetchPatientHeartSounds,
  };
});

describe("patient heart sound page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockFetchPatientHeartSounds.mockResolvedValue({
      items: [
        {
          id: "sound-1",
          patient_id: "patient-1",
          device_id: "device-1",
          mac_address: "F6:62:73:62:79:5E",
          position: 3,
          blob_url: "https://example.com/heart.wav",
          duration_seconds: 12,
          recorded_at: "2026-03-27T04:50:00Z",
          created_at: "2026-03-27T04:50:00Z",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the heart sound table for a patient", async () => {
    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "Heart Sound", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText("DATE/TIME")).toBeInTheDocument();
    expect(screen.getByText("USER ID")).toBeInTheDocument();
    expect(screen.getByText("MAC ADDRESS")).toBeInTheDocument();
    expect(screen.getByText("PLAY")).toBeInTheDocument();
    expect(screen.getByText("F6:62:73:62:79:5E")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
  });

  it("keeps the page usable when heart sound records fail to load", async () => {
    mockFetchPatientHeartSounds.mockReset();
    mockFetchPatientHeartSounds.mockRejectedValue(
      Object.assign(new Error("Request failed"), { status: 404 })
    );

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "Heart Sound", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(
      screen.getByText("Built-in demo recordings are loaded")
    ).toBeInTheDocument();
    expect(screen.getByText("Demo audio loaded")).toBeInTheDocument();
    expect(screen.getByText("DE:MO:PO:09:20:A1")).toBeInTheDocument();
    expect(screen.getByText("Upload heart sound files")).toBeInTheDocument();
  });

  it("loads demo recordings when the patient has no uploaded files yet", async () => {
    mockFetchPatientHeartSounds.mockResolvedValue({ items: [] });

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "Heart Sound", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText("Built-in demo recordings are loaded")).toBeInTheDocument();
    expect(screen.getByText("DE:MO:AA:01:10:01")).toBeInTheDocument();
    expect(screen.getByText("DE:MO:PO:14:30:01")).toBeInTheDocument();
  });
});
