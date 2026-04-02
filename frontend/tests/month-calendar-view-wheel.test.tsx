import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/lib/api";

const { mockGoToDate, mockCalendarState } = vi.hoisted(() => ({
  mockGoToDate: vi.fn(),
  currentWeekStart: new Date("2026-03-09T00:00:00.000Z"),
  mockCalendarState: {
    currentWeekStart: new Date("2026-03-09T00:00:00.000Z"),
    getFilteredMeetings: vi.fn<() => Meeting[]>(() => []),
    goToDate: vi.fn(),
    selectedMeeting: null,
    setSelectedMeeting: vi.fn(),
  },
}));

mockCalendarState.goToDate = mockGoToDate;

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("@/store/calendar-store", () => ({
  useCalendarStore: (
    selector: (state: typeof mockCalendarState) => unknown
  ) => selector(mockCalendarState),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: { language: "th" | "en" }) => unknown) =>
    selector({ language: "th" }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/dashboard/calendar-view", () => ({
  EventDetailSheet: () => null,
}));

describe("month calendar wheel interactions", () => {
  beforeEach(() => {
    mockGoToDate.mockReset();
    mockCalendarState.currentWeekStart = new Date("2026-03-09T00:00:00.000Z");
    mockCalendarState.getFilteredMeetings.mockReturnValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not navigate months on vertical wheel scrolling", async () => {
    const { MonthCalendarView } = await import("@/components/dashboard/month-calendar-view");
    const scrollByMock = vi.fn();

    const { container, getByText } = render(<MonthCalendarView onGoToWeek={vi.fn()} />);

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(getByText("จ.")).toBeTruthy();

    const scrollViewport = root?.children.item(1);
    expect(scrollViewport).not.toBeNull();
    Object.defineProperty(scrollViewport, "scrollBy", {
      configurable: true,
      value: scrollByMock,
    });

    const wheelEvent = createEvent.wheel(root as Element, {
      deltaY: 80,
      deltaX: 0,
      cancelable: true,
    });
    fireEvent(root as Element, wheelEvent);

    expect(mockGoToDate).not.toHaveBeenCalled();
    expect(scrollByMock).toHaveBeenCalledWith({ top: 80 });
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it("navigates months on horizontal wheel gestures", async () => {
    const { MonthCalendarView } = await import("@/components/dashboard/month-calendar-view");
    const { container } = render(
      <MonthCalendarView onGoToWeek={vi.fn()} />
    );

    const root = container.firstElementChild;
    expect(root).not.toBeNull();

    const wheelEvent = createEvent.wheel(root as Element, {
      deltaY: 0,
      deltaX: 40,
      cancelable: true,
    });
    fireEvent(root as Element, wheelEvent);

    expect(mockGoToDate).toHaveBeenCalledTimes(1);
    const nextMonth = mockGoToDate.mock.calls[0]?.[0] as Date;
    expect(nextMonth).toBeInstanceOf(Date);
    expect(nextMonth.getFullYear()).toBe(2026);
    expect(nextMonth.getMonth()).toBe(3);
    expect(nextMonth.getDate()).toBe(1);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it("keeps overflow list scrolling isolated from the outer month calendar", async () => {
    const { MonthCalendarView } = await import("@/components/dashboard/month-calendar-view");
    const scrollByMock = vi.fn();

    mockCalendarState.getFilteredMeetings.mockReturnValue(
      [
        "2026-03-13T09:00:00.000Z",
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T11:00:00.000Z",
        "2026-03-13T12:00:00.000Z",
      ].map((dateTime, index) => ({
        id: `meeting-${index + 1}`,
        date_time: dateTime,
        description: `meeting ${index + 1}`,
        status: "scheduled",
        patient: null,
      }))
    );

    const { container, getByTestId } = render(<MonthCalendarView onGoToWeek={vi.fn()} />);

    const root = container.firstElementChild;
    expect(root).not.toBeNull();

    const scrollViewport = root?.children.item(1);
    expect(scrollViewport).not.toBeNull();
    Object.defineProperty(scrollViewport, "scrollBy", {
      configurable: true,
      value: scrollByMock,
    });

    const overflowScroll = getByTestId("month-day-overflow-scroll");
    fireEvent.wheel(overflowScroll, { deltaY: 80, deltaX: 0 });

    expect(scrollByMock).not.toHaveBeenCalled();
    expect(mockGoToDate).not.toHaveBeenCalled();
  });
});
