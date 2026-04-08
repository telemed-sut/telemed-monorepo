import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    token: "test-token" as string | null,
    userId: "user-a" as string | null,
    role: "admin",
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
    window.localStorage.clear();
    mockLanguageState.language = "en";
    mockAuthState.token = "test-token";
    mockAuthState.userId = "user-a";
    mockAuthState.role = "admin";
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
    expect(screen.getAllByText("Date / time").length).toBeGreaterThan(0);
    expect(screen.getAllByText("User ID").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MAC Address").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Position").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Playback").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/F6:62:73:62:79:5E/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("patient-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("John Doe").length).toBeGreaterThan(0);
  }, 10000);

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
    expect(screen.getAllByText("John Doe").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Built-in demo recordings are loaded")
    ).toBeInTheDocument();
    expect(screen.getByText("Demo audio loaded")).toBeInTheDocument();
    expect(screen.getAllByText(/DE:MO:PO:09:20:A1/).length).toBeGreaterThan(0);
    expect(screen.getByText("Upload heart sound files")).toBeInTheDocument();
  }, 10000);

  it("loads demo recordings when the patient has no uploaded files yet", async () => {
    mockFetchPatientHeartSounds.mockResolvedValue({ items: [] });

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "Heart Sound", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText("Built-in demo recordings are loaded")).toBeInTheDocument();
    expect(screen.getAllByText(/DE:MO:AA:01:10:01/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/DE:MO:PO:14:30:01/).length).toBeGreaterThan(0);
  });

  it("rejects oversized upload files on the client before queueing", async () => {
    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "Heart Sound", level: 1 })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload heart sound files" }));

    const validFile = new File(["ok"], "valid.wav", { type: "audio/wav" });
    const oversizedFile = new File(["too-large"], "oversized.wav", { type: "audio/wav" });
    Object.defineProperty(validFile, "size", { value: 1024 });
    Object.defineProperty(oversizedFile, "size", { value: 11 * 1024 * 1024 });

    const input = document.getElementById("heart-sound-files") as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [validFile, oversizedFile],
      },
    });

    expect(
      screen.getByText("oversized.wav exceeds the 10.0 MB limit and was not added.")
    ).toBeInTheDocument();
    expect(screen.getByText("valid.wav")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove file" })).toHaveLength(1);
  });

  it("filters the recording table to the selected position only", async () => {
    mockFetchPatientHeartSounds.mockResolvedValue({
      items: [
        {
          id: "sound-9-a",
          patient_id: "patient-1",
          device_id: "device-9-a",
          mac_address: "DE:MO:PO:09:20:A1",
          position: 9,
          blob_url: "https://example.com/heart-9-a.wav",
          duration_seconds: 12,
          recorded_at: "2026-03-27T04:50:00Z",
          created_at: "2026-03-27T04:50:00Z",
        },
        {
          id: "sound-9-b",
          patient_id: "patient-1",
          device_id: "device-9-b",
          mac_address: "DE:MO:PO:09:20:B2",
          position: 9,
          blob_url: "https://example.com/heart-9-b.wav",
          duration_seconds: 10,
          recorded_at: "2026-03-27T04:48:00Z",
          created_at: "2026-03-27T04:48:00Z",
        },
        {
          id: "sound-14",
          patient_id: "patient-1",
          device_id: "device-14",
          mac_address: "DE:MO:PO:14:30:01",
          position: 14,
          blob_url: "https://example.com/heart-14.wav",
          duration_seconds: 9,
          recorded_at: "2026-03-27T04:46:00Z",
          created_at: "2026-03-27T04:46:00Z",
        },
      ],
    });

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "Heart Sound", level: 1 })
    ).toBeInTheDocument();
    expect(await screen.findAllByText(/DE:MO:PO:09:20:A1/)).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Jump to position 9" }));

    expect(await screen.findAllByText(/DE:MO:PO:09:20:A1/)).not.toHaveLength(0);
    expect(await screen.findAllByText(/DE:MO:PO:09:20:B2/)).not.toHaveLength(0);
    expect(screen.queryByText(/DE:MO:PO:14:30:01/)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Clear filter" })).toBeInTheDocument();
  });

  it("clears the position filter when the same position is clicked again", async () => {
    mockFetchPatientHeartSounds.mockResolvedValue({
      items: [
        {
          id: "sound-9-a",
          patient_id: "patient-1",
          device_id: "device-9-a",
          mac_address: "DE:MO:PO:09:20:A1",
          position: 9,
          blob_url: "https://example.com/heart-9-a.wav",
          duration_seconds: 12,
          recorded_at: "2026-03-27T04:50:00Z",
          created_at: "2026-03-27T04:50:00Z",
        },
        {
          id: "sound-14",
          patient_id: "patient-1",
          device_id: "device-14",
          mac_address: "DE:MO:PO:14:30:01",
          position: 14,
          blob_url: "https://example.com/heart-14.wav",
          duration_seconds: 9,
          recorded_at: "2026-03-27T04:46:00Z",
          created_at: "2026-03-27T04:46:00Z",
        },
      ],
    });

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "Heart Sound", level: 1 })
    ).toBeInTheDocument();
    expect(await screen.findAllByText(/DE:MO:PO:14:30:01/)).not.toHaveLength(0);

    const getPositionNineFilterButton = () =>
      screen
        .getAllByRole("button")
        .find((button) => button.textContent?.trim().startsWith("9"));

    const firstClickButton = getPositionNineFilterButton();
    expect(firstClickButton).toBeTruthy();
    fireEvent.click(firstClickButton!);
    await waitFor(() => {
      expect(screen.queryByText(/DE:MO:PO:14:30:01/)).not.toBeInTheDocument();
    });

    const secondClickButton = getPositionNineFilterButton();
    expect(secondClickButton).toBeTruthy();
    fireEvent.click(secondClickButton!);
    expect(await screen.findAllByText(/DE:MO:PO:14:30:01/)).not.toHaveLength(0);
  });

  it("localizes visible workspace copy in Thai", async () => {
    mockLanguageState.language = "th";

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "เสียงหัวใจ", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "โหมดโฟกัส" })).toBeInTheDocument();
    expect(screen.getAllByText("วันเวลา").length).toBeGreaterThan(0);
    expect(screen.getAllByText("รหัสผู้ใช้").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ที่อยู่ MAC").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ตำแหน่ง").length).toBeGreaterThan(0);
    expect(screen.getAllByText("การเล่นเสียง").length).toBeGreaterThan(0);
  });

  it("hides system columns for doctor accounts", async () => {
    mockAuthState.role = "doctor";

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(
      await screen.findByRole("heading", { name: "Heart Sound", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Date / time").length).toBeGreaterThan(0);
    expect(screen.queryByText("User ID")).not.toBeInTheDocument();
    expect(screen.queryByText("MAC Address")).not.toBeInTheDocument();
    expect(screen.getAllByText("Position").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Playback").length).toBeGreaterThan(0);
  });

  it("localizes patient load errors instead of showing mixed-language API messages", async () => {
    mockFetchPatient.mockReset();
    mockFetchPatient.mockRejectedValue(
      Object.assign(new Error("ไม่พบข้อมูลผู้ใช้ที่ต้องการ"), { status: 400 })
    );

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-missing" />);

    expect(
      await screen.findByRole("heading", { name: "Patient not found", level: 2 })
    ).toBeInTheDocument();
    expect(screen.getByText("Unable to load patient data.")).toBeInTheDocument();
    expect(screen.queryByText("ไม่พบข้อมูลผู้ใช้ที่ต้องการ")).not.toBeInTheDocument();
  });

  it("does not render cached heart sound data before an authenticated session is available", async () => {
    mockAuthState.token = null;
    window.localStorage.setItem(
      "telemed.patient-workspace.heart-sound.v2:user-a:patient-1",
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
          records: [
            {
              id: "cached-sound-1",
              patient_id: "patient-1",
              device_id: "device-1",
              mac_address: "AA:BB:CC:DD:EE:FF",
              position: 3,
              blob_url: "https://example.com/cached.wav",
              duration_seconds: 12,
              recorded_at: "2026-03-27T04:50:00Z",
              created_at: "2026-03-27T04:50:00Z",
            },
          ],
          recordsCachedAt: Date.now(),
        },
      })
    );

    const { PatientHeartSoundContent } = await import("@/components/dashboard/patient-heart-sound");
    render(<PatientHeartSoundContent patientId="patient-1" />);

    expect(screen.queryByText("Cached Patient")).not.toBeInTheDocument();
    expect(screen.queryByText(/AA:BB:CC:DD:EE:FF/)).not.toBeInTheDocument();
    expect(mockFetchPatient).not.toHaveBeenCalled();
    expect(mockFetchPatientHeartSounds).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/login");

    mockAuthState.token = "test-token";
  });
});
