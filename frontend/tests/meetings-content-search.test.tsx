import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ImgHTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockFetchAllMeetings,
  mockFetchAllPatients,
  mockFetchPatients,
  mockFetchUsers,
  mockFetchCurrentUser,
  mockCreateMeeting,
  mockUpdateMeeting,
  mockGetErrorMessage,
  mockAuthState,
  mockLanguageState,
  mockCalendarState,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockFetchAllMeetings: vi.fn(),
  mockFetchAllPatients: vi.fn(),
  mockFetchPatients: vi.fn(),
  mockFetchUsers: vi.fn(),
  mockFetchCurrentUser: vi.fn(),
  mockCreateMeeting: vi.fn(),
  mockUpdateMeeting: vi.fn(),
  mockGetErrorMessage: vi.fn(),
  mockAuthState: {
    token: "test-token",
    userId: "admin-1",
    role: "admin",
    clearToken: vi.fn(),
  },
  mockLanguageState: {
    language: "en",
  },
  mockCalendarState: {
    currentWeekStart: new Date("2026-03-06T00:00:00.000Z"),
    goToToday: vi.fn(),
    goToDate: vi.fn(),
    getFilteredMeetings: vi.fn(() => []),
    searchQuery: "",
    setSearchQuery: vi.fn(),
    eventTypeFilter: "all",
    setEventTypeFilter: vi.fn(),
    includeCancelled: false,
    setIncludeCancelled: vi.fn(),
    setMeetings: vi.fn(),
    upsertMeeting: vi.fn(),
    meetings: [],
  },
}));

function stripMotionProps<T extends Record<string, unknown>>(props: T) {
  const domProps = { ...props };
  delete domProps.animate;
  delete domProps.exit;
  delete domProps.initial;
  delete domProps.layout;
  delete domProps.layoutId;
  delete domProps.transition;
  delete domProps.variants;
  delete domProps.whileHover;
  delete domProps.whileTap;
  return domProps;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
  usePathname: () => "/meetings",
  useSearchParams: () =>
    new URLSearchParams("view=week&date=2026-03-06"),
}));

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} />,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...stripMotionProps(props as Record<string, unknown>)}>{children}</div>
    ),
    button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...stripMotionProps(props as Record<string, unknown>)}>{children}</button>
    ),
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({
    children,
    render,
  }: {
    children?: ReactNode;
    render?: ReactElement;
  }) => <>{render ?? children}</>,
}));

vi.mock("@/components/ui/calendar", () => ({
  Calendar: () => <div data-testid="calendar" />,
}));

vi.mock("@/components/ui/calender", () => ({
  AnimatedCalendar: () => <div data-testid="animated-calendar" />,
}));

vi.mock("@/components/dashboard/calendar-view", () => ({
  CalendarView: () => <div data-testid="calendar-view" />,
}));

vi.mock("@/components/dashboard/queue-view", () => ({
  QueueView: () => <div data-testid="queue-view" />,
}));

vi.mock("@/components/dashboard/month-calendar-popover", () => ({
  MonthCalendarPopover: () => <div data-testid="month-calendar-popover" />,
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof mockLanguageState) => unknown) => selector(mockLanguageState),
}));

vi.mock("@/store/calendar-store", () => ({
  useCalendarStore: (selector: (state: typeof mockCalendarState) => unknown) => selector(mockCalendarState),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchAllMeetings: mockFetchAllMeetings,
    fetchAllPatients: mockFetchAllPatients,
    fetchPatients: mockFetchPatients,
    fetchUsers: mockFetchUsers,
    fetchCurrentUser: mockFetchCurrentUser,
    createMeeting: mockCreateMeeting,
    updateMeeting: mockUpdateMeeting,
    getErrorMessage: mockGetErrorMessage,
  };
});

async function renderMeetingsContent() {
  const { MeetingsContent } = await import("@/components/dashboard/meetings-content");
  return render(<MeetingsContent />);
}

beforeEach(() => {
  vi.clearAllMocks();

  mockFetchAllMeetings.mockResolvedValue([]);
  mockFetchAllPatients.mockResolvedValue([
    {
      id: "patient-1",
      first_name: "Papon",
      last_name: "Moonkonburee",
      email: "papon@example.com",
      phone: "0812345678",
      is_active: true,
    },
  ]);
  mockFetchUsers.mockImplementation(async (params?: { q?: string }) => {
    if (params?.q) {
      return { items: [], total: 0, page: 1, limit: 100 };
    }
    return {
      items: [
        {
          id: "doctor-1",
          email: "doctor@example.com",
          first_name: "Alice",
          last_name: "Doctor",
          role: "doctor",
          is_active: true,
        },
      ],
      total: 1,
      page: 1,
      limit: 100,
    };
  });
  mockFetchPatients.mockImplementation(async (params?: { q?: string }) => ({
    items:
      params?.q === "papon moonkonburee"
        ? [
            {
              id: "patient-1",
              first_name: "Papon",
              last_name: "Moonkonburee",
              email: "papon@example.com",
              phone: "0812345678",
              is_active: true,
            },
          ]
        : [],
    total: params?.q === "papon moonkonburee" ? 1 : 0,
    page: 1,
    limit: 100,
  }));
  mockFetchCurrentUser.mockResolvedValue(null);
  mockGetErrorMessage.mockReturnValue("api error");
});

afterEach(() => {
  cleanup();
});

describe("Meetings content search", () => {
  it("normalizes pasted patient search text before querying and shows the match", async () => {
    await renderMeetingsContent();

    fireEvent.change(screen.getByPlaceholderText("09:00"), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByPlaceholderText("10:00"), {
      target: { value: "10:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create Event/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose patient" }));

    const searchInput = await screen.findByPlaceholderText("Search patients...");
    fireEvent.change(searchInput, {
      target: { value: "papon\u200b moonkonburee" },
    });

    await new Promise((resolve) => window.setTimeout(resolve, 350));

    await waitFor(() => {
      expect(mockFetchPatients).toHaveBeenCalledWith(
        {
          page: 1,
          limit: 100,
          q: "papon moonkonburee",
          sort: "first_name",
          order: "asc",
        },
        "test-token"
      );
    });

    expect((await screen.findAllByText("Papon Moonkonburee")).length).toBeGreaterThan(0);
  }, 15000);

  it("adds a newly created meeting to the calendar store before waiting for the next fetch", async () => {
    const createdMeeting = {
      id: "meeting-new",
      date_time: "2026-03-07T10:00:00.000Z",
      doctor_id: "doctor-1",
      user_id: "patient-1",
      description: "Fresh follow-up",
      note: null,
      room: null,
      status: "scheduled",
      doctor: {
        id: "doctor-1",
        email: "doctor@example.com",
        first_name: "Alice",
        last_name: "Doctor",
        role: "doctor",
        is_active: true,
      },
      patient: {
        id: "patient-1",
        first_name: "Papon",
        last_name: "Moonkonburee",
        email: "papon@example.com",
        phone: "0812345678",
        is_active: true,
      },
    };

    mockCreateMeeting.mockResolvedValue(createdMeeting);
    mockFetchAllMeetings.mockResolvedValue([]);

    await renderMeetingsContent();

    fireEvent.click(screen.getByRole("button", { name: /Create Event/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose doctor" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Alice Doctor/i }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Choose patient" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Papon Moonkonburee/i }))[0]);
    fireEvent.change(screen.getByPlaceholderText("Follow-up consultation"), {
      target: { value: "Fresh follow-up" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: /^Schedule$/i }).at(-1)!);

    await waitFor(() => {
      expect(mockCreateMeeting).toHaveBeenCalled();
    });
    expect(mockCalendarState.upsertMeeting).toHaveBeenCalledWith(createdMeeting);
  }, 15000);
});
