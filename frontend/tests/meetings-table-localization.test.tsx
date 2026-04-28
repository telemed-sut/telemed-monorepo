import type { HTMLAttributes, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockFetchMeetings,
  mockFetchAllPatients,
  mockCreateMeeting,
  mockUpdateMeeting,
  mockDeleteMeeting,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockFetchMeetings: vi.fn(),
  mockFetchAllPatients: vi.fn(),
  mockCreateMeeting: vi.fn(),
  mockUpdateMeeting: vi.fn(),
  mockDeleteMeeting: vi.fn(),
  mockAuthState: {
    token: "test-token",
    role: "admin",
    userId: "doctor-1",
    clearToken: vi.fn(),
  },
  mockLanguageState: {
    language: "th",
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
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
    tr: (props: HTMLAttributes<HTMLTableRowElement>) => <tr {...props} />,
  },
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    destructiveAction: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchMeetings: mockFetchMeetings,
    fetchAllPatients: mockFetchAllPatients,
    createMeeting: mockCreateMeeting,
    updateMeeting: mockUpdateMeeting,
    deleteMeeting: mockDeleteMeeting,
  };
});

describe("meetings table localization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguageState.language = "th";
    mockFetchAllPatients.mockResolvedValue([
      {
        id: "patient-1",
        first_name: "สมชาย",
        last_name: "ใจดี",
      },
    ]);
    mockFetchMeetings.mockResolvedValue({
      items: [
        {
          id: "meeting-1",
          date_time: "2026-04-02T09:00:00.000Z",
          doctor_id: "doctor-1",
          user_id: "patient-1",
          room: "301",
          description: "ตรวจติดตาม",
          note: "บันทึก",
          doctor: {
            first_name: "Alice",
            last_name: "Doctor",
            email: "doctor@example.com",
          },
          patient: {
            first_name: "สมชาย",
            last_name: "ใจดี",
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders visible meetings workspace copy in Thai", async () => {
    const { MeetingsTable } = await import("@/components/dashboard/meetings-table");
    render(<MeetingsTable />);

    expect(await screen.findByText("รายการการนัดหมาย")).toBeInTheDocument();
    expect(screen.getByText("จัดการการนัดหมาย ตารางเวลา และรายละเอียดการพบแพทย์")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ค้นหาการนัดหมาย...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "สร้างการนัดหมาย" })).toBeInTheDocument();
    expect(screen.getAllByText("วันและเวลา").length).toBeGreaterThan(0);
    expect(screen.getAllByText("แพทย์").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ผู้ป่วย").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ห้อง").length).toBeGreaterThan(0);
    expect(screen.getAllByText("รายละเอียด").length).toBeGreaterThan(0);
    expect(screen.getByText("การจัดการ")).toBeInTheDocument();
    expect(screen.getByText("ต่อหน้า")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ก่อนหน้า" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeInTheDocument();
  });
});
