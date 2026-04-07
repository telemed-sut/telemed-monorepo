"use client";

import { useRef, useEffect, useState } from "react";
import { isToday } from "date-fns";

import {
  useCalendarStore,
  HOUR_HEIGHT,
  INITIAL_SCROLL_OFFSET,
  getCurrentTimePosition,
} from "@/store/calendar-store";
import { t as tr } from "@/lib/i18n-utils";
import type { Meeting } from "@/lib/api";
import type { MeetingStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import {
  getPresenceAwareStatus,
} from "./meeting-presence";
import { DayColumn } from "./day-column";
import { EventDetailSheet } from "./event-detail-sheet";
import { HoursColumn } from "./hours-column";

export { EventDetailSheet } from "./event-detail-sheet";

/* ── Helpers ── */

export interface CalendarSlotSelection {
  date: Date;
  startHour: number;
  startMinute: number;
  endHour?: number;
  endMinute?: number;
}

const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

function formatTime12(dateTime: string, language: AppLanguage): string {
  const d = new Date(dateTime);
  return d.toLocaleTimeString(localeOf(language), {
    hour: "numeric",
    minute: "2-digit",
    hour12: language !== "th",
  });
}

function formatGmtOffsetLabel(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = absoluteMinutes % 60;

  return minutes === 0
    ? `GMT${sign}${hours}`
    : `GMT${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
}

function sortMeetingsByTime(meetings: Meeting[]): Meeting[] {
  return [...meetings].sort(
    (a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime()
  );
}

function getWeekEventTone(status?: MeetingStatus) {
  switch (status) {
    case "waiting":
      return {
        border: "border-amber-200/90",
        surface: "bg-amber-50/95",
        surfaceHover: "hover:bg-amber-100/95",
        label: "text-amber-700",
        title: "text-amber-950",
        dot: "bg-amber-500",
      };
    case "in_progress":
      return {
        border: "border-sky-200/90",
        surface: "bg-sky-50/95",
        surfaceHover: "hover:bg-sky-100/95",
        label: "text-sky-700",
        title: "text-sky-950",
        dot: "bg-sky-500",
      };
    case "completed":
      return {
        border: "border-emerald-200/90",
        surface: "bg-emerald-50/95",
        surfaceHover: "hover:bg-emerald-100/95",
        label: "text-emerald-700",
        title: "text-emerald-950",
        dot: "bg-emerald-500",
      };
    case "cancelled":
      return {
        border: "border-slate-200/90",
        surface: "bg-slate-100/90",
        surfaceHover: "hover:bg-slate-200/80",
        label: "text-slate-500",
        title: "text-slate-700",
        dot: "bg-slate-400",
      };
    case "overtime":
      return {
        border: "border-rose-200/90",
        surface: "bg-rose-50/95",
        surfaceHover: "hover:bg-rose-100/95",
        label: "text-rose-700",
        title: "text-rose-950",
        dot: "bg-rose-500",
      };
    case "scheduled":
    default:
      return {
        border: "border-cyan-200/95",
        surface: "bg-cyan-50/95",
        surfaceHover: "hover:bg-cyan-100/95",
        label: "text-cyan-700",
        title: "text-cyan-950",
        dot: "bg-cyan-500",
      };
  }
}

const WEEK_LEFT_RAIL_CLASS = "w-[88px] md:w-[104px]";
const WEEK_DAY_COLUMN_CLASS = "min-w-[170px] flex-1 basis-0 xl:min-w-[180px]";

function WeekPreviewColumn({
  date,
  meetings,
  onMeetingClick,
}: {
  date: Date;
  meetings: Meeting[];
  onMeetingClick: (meeting: Meeting) => void;
}) {
  const language = useLanguageStore((state) => state.language);
  const [expanded, setExpanded] = useState(false);
  const sortedMeetings = sortMeetingsByTime(meetings);
  const visibleMeetings = sortedMeetings.slice(0, 2);
  const overflowCount = Math.max(sortedMeetings.length - visibleMeetings.length, 0);

  if (sortedMeetings.length === 0) {
    return (
        <div
          className={cn(
            "min-h-[54px] border-r border-slate-200/80 last:border-r-0 px-2 py-1.5",
            WEEK_DAY_COLUMN_CLASS
          )}
        />
    );
  }

  return (
      <div
        className={cn(
        "min-h-[54px] border-r border-slate-200/80 last:border-r-0 px-2 py-1.5",
        WEEK_DAY_COLUMN_CLASS
      )}
    >
      <div className="flex flex-col gap-1.5">
        {visibleMeetings.map((meeting) => {
          const tone = getWeekEventTone(getPresenceAwareStatus(meeting));
          const title =
            meeting.description ||
            (meeting.patient
              ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
              : tr(language, "Appointment", "นัดหมาย"));

          return (
            <button
              key={`preview-${meeting.id}`}
              type="button"
              onClick={() => onMeetingClick(meeting)}
              className={cn(
                "w-full rounded-[10px] border px-3 py-2 text-left shadow-[0_6px_14px_rgba(15,23,42,0.06)] transition-colors duration-200",
                tone.surface,
                tone.surfaceHover,
                tone.border
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", tone.dot)} />
                <div className="min-w-0">
                  <div className={cn("truncate text-[10px] font-semibold uppercase tracking-[0.12em]", tone.label)}>
                    {formatTime12(meeting.date_time, language)}
                  </div>
                  <div className={cn("truncate text-[11px] font-semibold", tone.title)}>{title}</div>
                </div>
              </div>
            </button>
          );
        })}

        {overflowCount > 0 ? (
          <Popover open={expanded} onOpenChange={setExpanded}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  className="inline-flex items-center text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-900"
                >
                  {tr(language, `${overflowCount} more`, `${overflowCount} นัด`)}
                </button>
              }
            />
            <PopoverContent
              side="right"
              align="start"
              sideOffset={10}
              className="w-[min(84vw,280px)] gap-0 overflow-hidden rounded-[24px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(248,250,252,0.98))] p-0 text-slate-900 shadow-[0_18px_36px_rgba(15,23,42,0.14)]"
            >
              <div className="border-b border-slate-200/80 px-4 pb-3 pt-4 text-center">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1" />
                  <div className="flex-1 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {date.toLocaleDateString(localeOf(language), { weekday: "short" })}
                    </p>
                    <p className="mt-1 text-[2.1rem] font-semibold leading-none tracking-[-0.05em] text-slate-900">
                      {date.toLocaleDateString(localeOf(language), { day: "numeric" })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="inline-flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    aria-label={tr(language, "Close", "ปิด")}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="max-h-[360px] overflow-y-auto px-3 py-3">
                <div className="flex flex-col gap-1.5">
                  {sortedMeetings.map((meeting) => {
                    const tone = getWeekEventTone(getPresenceAwareStatus(meeting));
                    const title =
                      meeting.description ||
                      (meeting.patient
                        ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
                        : tr(language, "Appointment", "นัดหมาย"));

                    return (
                      <button
                        key={`preview-popover-${meeting.id}`}
                        type="button"
                        onClick={() => {
                          setExpanded(false);
                          onMeetingClick(meeting);
                        }}
                        className={cn(
                          "w-full rounded-[10px] border px-3 py-2 text-left shadow-[0_6px_14px_rgba(15,23,42,0.06)] transition-colors duration-200",
                          tone.surface,
                          tone.surfaceHover,
                          tone.border
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn("size-2 rounded-full", tone.dot)} />
                          <div className="min-w-0">
                            <div className={cn("truncate text-[10px] font-semibold uppercase tracking-[0.12em]", tone.label)}>
                              {formatTime12(meeting.date_time, language)}
                            </div>
                            <div className={cn("truncate text-[11px] font-semibold", tone.title)}>{title}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Main Calendar View (Square UI calendar-view.tsx layout)
// ══════════════════════════════════════════════════════════
export function CalendarView({
  onSlotSelect,
  onEditMeeting,
  onRefresh,
}: {
  onSlotSelect?: (slot: CalendarSlotSelection) => void;
  onEditMeeting?: (meeting: Meeting) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const language = useLanguageStore((state) => state.language);
  const getWeekDays = useCalendarStore((s) => s.getWeekDays);
  const getMeetingsForDate = useCalendarStore((s) => s.getMeetingsForDate);
  const selectedMeeting = useCalendarStore((s) => s.selectedMeeting);
  const setSelectedMeeting = useCalendarStore((s) => s.setSelectedMeeting);
  const weekDays = getWeekDays();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<(HTMLDivElement | null)[]>([]);
  const timeZoneLabel = formatGmtOffsetLabel();

  useEffect(() => {
    if (scrollContainerRef.current) {
      const currentWeekIncludesToday = weekDays.some((day) => isToday(day));
      const nextScrollTop = currentWeekIncludesToday
        ? Math.max(getCurrentTimePosition() - HOUR_HEIGHT * 1.5, 0)
        : INITIAL_SCROLL_OFFSET;

      scrollContainerRef.current.scrollTop = nextScrollTop;
    }
  }, [weekDays]);

  return (
    <>
      <div className="flex flex-1 flex-col overflow-hidden rounded-[28px] border border-slate-200/85 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        {/* Single scroll container for both header and time grid */}
        <div
          ref={scrollContainerRef}
          className="flex-1 w-full overflow-auto bg-white"
        >
          <div className="flex min-w-full w-full flex-col">
            {/* ── Sticky header (date row + appointment preview row) ── */}
            <div className="sticky top-0 z-40 flex flex-col border-b border-slate-200/85 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.99))]">
              {/* Date row */}
              <div className="flex">
                <div
                  className={cn(
                    "sticky left-0 z-50 flex shrink-0 flex-col justify-center border-r border-slate-200/85 bg-white px-3 py-3",
                    WEEK_LEFT_RAIL_CLASS
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {timeZoneLabel}
                  </span>
                </div>

                {weekDays.map((day) => {
                  const today = isToday(day);

                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "flex items-center justify-center border-r border-slate-200/85 px-3 py-3 last:border-r-0",
                        WEEK_DAY_COLUMN_CLASS,
                        today ? "bg-sky-50/50" : "bg-transparent"
                      )}
                    >
                      <div className="text-center">
                        <p className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", today ? "text-sky-700" : "text-slate-400")}>
                          {day.toLocaleDateString(localeOf(language), { weekday: "short" })}
                        </p>
                        <div className="mt-1.5 flex items-center justify-center gap-2">
                          <span
                            className={cn(
                              "inline-flex size-9 items-center justify-center rounded-full text-[1.45rem] font-semibold tracking-[-0.04em]",
                              today ? "bg-sky-500 text-white" : "text-slate-700"
                            )}
                          >
                            {day.toLocaleDateString(localeOf(language), { day: "numeric" })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Appointment preview row */}
              <div className="flex border-t border-slate-200/85 bg-slate-50/65">
                <div
                  className={cn(
                    "sticky left-0 z-40 flex shrink-0 flex-col border-r border-slate-200/85 bg-white px-3 py-2.5",
                    WEEK_LEFT_RAIL_CLASS
                  )}
                >
                  <span className="text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-slate-400">
                    {tr(language, "Preview", "นัดหมาย")}
                  </span>
                </div>

                {weekDays.map((day) => (
                  <WeekPreviewColumn
                    key={`preview-${day.toISOString()}`}
                    date={day}
                    meetings={getMeetingsForDate(day)}
                    onMeetingClick={setSelectedMeeting}
                  />
                ))}
              </div>
            </div>

            {/* ── Time grid (hours column + day columns) ── */}
            <div className="flex">
              <HoursColumn />
              {weekDays.map((day, i) => {
                const setDayRef = (el: HTMLDivElement | null) => {
                  dayRefs.current[i] = el;
                };
                return (
                  <DayColumn
                    key={day.toISOString()}
                    date={day}
                    scrollRef={setDayRef}
                    onSlotSelect={onSlotSelect}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Event detail sheet */}
      <EventDetailSheet
        meeting={selectedMeeting}
        open={!!selectedMeeting}
        onOpenChange={(open) => {
          if (!open) setSelectedMeeting(null);
        }}
        onEdit={onEditMeeting}
        onRefresh={onRefresh}
      />
    </>
  );
}
