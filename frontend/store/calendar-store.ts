import { create } from "zustand";
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  format,
  isSameDay,
} from "date-fns";
import type { Meeting } from "@/lib/api";

export type EventTypeFilter = "all" | "with-room" | "without-room";
export type DisplayTimezone = "local" | "utc";

interface CalendarState {
  currentWeekStart: Date;
  searchQuery: string;
  eventTypeFilter: EventTypeFilter;
  displayTimezone: DisplayTimezone;
  meetings: Meeting[];
  selectedMeeting: Meeting | null;
  goToNextWeek: () => void;
  goToPreviousWeek: () => void;
  goToToday: () => void;
  goToDate: (date: Date) => void;
  setSearchQuery: (query: string) => void;
  setEventTypeFilter: (filter: EventTypeFilter) => void;
  setDisplayTimezone: (tz: DisplayTimezone) => void;
  setMeetings: (meetings: Meeting[]) => void;
  setSelectedMeeting: (meeting: Meeting | null) => void;
  getWeekDays: () => Date[];
  getFilteredMeetings: () => Meeting[];
  getMeetingsForDate: (date: Date) => Meeting[];
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  currentWeekStart: startOfWeek(new Date(), { weekStartsOn: 1 }),
  searchQuery: "",
  eventTypeFilter: "all",
  displayTimezone: "local",
  meetings: [],
  selectedMeeting: null,

  goToNextWeek: () =>
    set((s) => ({ currentWeekStart: addWeeks(s.currentWeekStart, 1) })),
  goToPreviousWeek: () =>
    set((s) => ({ currentWeekStart: subWeeks(s.currentWeekStart, 1) })),
  goToToday: () =>
    set({ currentWeekStart: startOfWeek(new Date(), { weekStartsOn: 1 }) }),
  goToDate: (date: Date) =>
    set({ currentWeekStart: startOfWeek(date, { weekStartsOn: 1 }) }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setEventTypeFilter: (filter) => set({ eventTypeFilter: filter }),
  setDisplayTimezone: (tz) => set({ displayTimezone: tz }),
  setMeetings: (meetings) => set({ meetings }),
  setSelectedMeeting: (meeting) => set({ selectedMeeting: meeting }),

  getWeekDays: () => {
    const { currentWeekStart } = get();
    return eachDayOfInterval({
      start: currentWeekStart,
      end: endOfWeek(currentWeekStart, { weekStartsOn: 1 }),
    });
  },

  getFilteredMeetings: () => {
    const { meetings, searchQuery, eventTypeFilter } = get();
    let filtered = meetings;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.description?.toLowerCase().includes(q) ||
          m.note?.toLowerCase().includes(q) ||
          m.doctor?.first_name?.toLowerCase().includes(q) ||
          m.doctor?.last_name?.toLowerCase().includes(q) ||
          m.patient?.first_name?.toLowerCase().includes(q) ||
          m.patient?.last_name?.toLowerCase().includes(q) ||
          m.room?.toLowerCase().includes(q)
      );
    }

    if (eventTypeFilter === "with-room") {
      filtered = filtered.filter((m) => m.room);
    } else if (eventTypeFilter === "without-room") {
      filtered = filtered.filter((m) => !m.room);
    }

    return filtered;
  },

  getMeetingsForDate: (date: Date) => {
    const filtered = get().getFilteredMeetings();
    return filtered.filter((m) => isSameDay(new Date(m.date_time), date));
  },
}));

// Constants
export const HOURS_24 = [
  "12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM",
  "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM",
  "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM",
  "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM",
];

export const HOUR_HEIGHT = 120;
export const INITIAL_SCROLL_OFFSET = 8 * HOUR_HEIGHT; // Scroll to 8 AM

export function getEventTop(dateTime: string, tz: DisplayTimezone = "local"): number {
  const d = new Date(dateTime);
  const hours = tz === "utc" ? d.getUTCHours() : d.getHours();
  const minutes = tz === "utc" ? d.getUTCMinutes() : d.getMinutes();
  return (hours + minutes / 60) * HOUR_HEIGHT;
}

export function getEventHeight(startTime: string, endTime?: string): number {
  if (!endTime) return 60; // Default 1 hour if no end time
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const height = (durationMinutes / 60) * HOUR_HEIGHT;
  return Math.max(height, 30);
}

export function getCurrentTimePosition(tz: DisplayTimezone = "local"): number {
  const now = new Date();
  const hours = tz === "utc" ? now.getUTCHours() : now.getHours();
  const minutes = tz === "utc" ? now.getUTCMinutes() : now.getMinutes();
  return (hours + minutes / 60) * HOUR_HEIGHT;
}

export function getMeetingDuration(meeting: Meeting): number {
  void meeting;
  // Default 60 min for meetings (since the backend doesn't store end_time)
  return 60;
}

export function formatMeetingTime(dateTime: string, tz: DisplayTimezone = "local"): string {
  const d = new Date(dateTime);
  if (tz === "utc") {
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const period = h >= 12 ? "PM" : "AM";
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
  }
  return format(d, "h:mm a");
}

/** Get the local timezone abbreviation, e.g. "ICT" for Asia/Bangkok */
export function getLocalTimezoneAbbr(): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || "Local";
  } catch {
    return "Local";
  }
}
