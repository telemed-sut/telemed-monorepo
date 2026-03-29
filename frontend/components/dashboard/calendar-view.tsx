"use client";

import { useRef, useEffect, useState } from "react";
import { isToday, addMinutes } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { MoreHorizontal } from "lucide-react";
import {
  PencilEdit01Icon,
  Layers01Icon,
  Delete01Icon,
  Cancel01Icon,
  Clock01Icon,
  Notification01Icon,
  AlertCircleIcon,
  Calendar01Icon,
  CallIcon,
  UserGroupIcon,
  NoteIcon,
  LinkSquare01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";

import {
  useCalendarStore,
  HOURS_24,
  HOUR_HEIGHT,
  INITIAL_SCROLL_OFFSET,
  getCurrentTimePosition,
  getMeetingDuration,
} from "@/store/calendar-store";
import type { Meeting } from "@/lib/api";
import { MEETING_STATUS_LABELS, type MeetingStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { createMeetingPatientInvite, deleteMeeting, createMeeting, updateMeeting } from "@/lib/api";
import type { MeetingCreatePayload } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import {
  getLivePresenceInfo,
  getPresenceAwareStatus,
  isDoctorLeftWhilePatientWaiting,
  isPatientWaitingLive,
} from "./meeting-presence";
import { preloadMeetingCallExperience } from "@/lib/meeting-call-prefetch";

/* ── Helpers ── */

export interface CalendarSlotSelection {
  date: Date;
  startHour: number;
  startMinute: number;
  endHour?: number;
  endMinute?: number;
}

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";
const TH_MEETING_STATUS_LABELS: Partial<Record<MeetingStatus, string>> = {
  scheduled: "กำหนดการ",
  waiting: "เช็กอินแล้ว",
  in_progress: "กำลังตรวจ",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
  overtime: "เกินเวลา",
};
function getMeetingStatusLabel(status: MeetingStatus, language: AppLanguage): string {
  if (language === "th") {
    return TH_MEETING_STATUS_LABELS[status] ?? "กำหนดการ";
  }
  return MEETING_STATUS_LABELS[status] || "Scheduled";
}

function formatTime12(dateTime: string, language: AppLanguage): string {
  const d = new Date(dateTime);
  return d.toLocaleTimeString(localeOf(language), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatCompactDate(dateTime: string, language: AppLanguage): string {
  const d = new Date(dateTime);
  return d.toLocaleDateString(localeOf(language), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatCompactTime(dateTime: string, language: AppLanguage): string {
  const d = new Date(dateTime);
  return d.toLocaleTimeString(localeOf(language), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatHourLabel(index: number, language: AppLanguage): string {
  const hour = index % 24;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  if (language === "th") {
    return `${displayHour} ${period === "AM" ? "เช้า" : "บ่าย"}`;
  }
  return `${displayHour} ${period}`;
}

function formatSelectionTimeRange(
  startMinuteOfDay: number,
  endMinuteOfDay: number,
  language: AppLanguage
): string {
  const formatMinute = (totalMinutes: number) => {
    const safeMinutes = Math.max(0, Math.min(totalMinutes, 24 * 60));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    const date = new Date();
    date.setHours(Math.min(hours, 23), minutes, 0, 0);
    return date.toLocaleTimeString(localeOf(language), {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return `${formatMinute(startMinuteOfDay)} - ${formatMinute(endMinuteOfDay)}`;
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

/** Status → dot color + border accent */
function getStatusColor(status?: MeetingStatus): { dot: string; border: string; text: string } {
  switch (status) {
    case "waiting":
      return { dot: "bg-amber-500", border: "border-amber-200/80", text: "text-amber-700 dark:text-amber-300" };
    case "in_progress":
      return { dot: "bg-blue-500", border: "border-sky-200/85", text: "text-sky-700 dark:text-sky-300" };
    case "overtime":
      return { dot: "bg-red-500", border: "border-rose-200/85", text: "text-rose-700 dark:text-rose-300" };
    case "completed":
      return { dot: "bg-emerald-500", border: "border-emerald-200/85", text: "text-emerald-700 dark:text-emerald-300" };
    case "cancelled":
      return { dot: "bg-gray-400", border: "border-zinc-200/85", text: "text-zinc-500" };
    case "scheduled":
    default:
      return { dot: "bg-cyan-500", border: "border-cyan-200/85", text: "text-cyan-700 dark:text-cyan-300" };
  }
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

function getInitial(name: string | null | undefined): string {
  return name?.charAt(0)?.toUpperCase() || "?";
}

const WEEK_LEFT_RAIL_CLASS = "w-[88px] md:w-[104px]";
const WEEK_DAY_COLUMN_CLASS = "min-w-[170px] flex-1 basis-0 xl:min-w-[180px]";

function normalizeRoomTarget(room?: string | null): string | null {
  const value = room?.trim();
  if (!value) return null;

  // Full URL (https/http/mailto/tel) can be opened directly.
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;

  // Domain-like values (meet.example.com/abc) are treated as https URLs.
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }

  // Allow internal app paths.
  if (value.startsWith("/")) return value;

  return null;
}

// ══════════════════════════════════════════════════════════
// Hours Column (Square UI calendar-hours-column.tsx)
// ══════════════════════════════════════════════════════════
function HoursColumn() {
  const language = useLanguageStore((state) => state.language);
  return (
    <div
      className={cn(
        "relative sticky left-0 z-30 shrink-0 border-r border-slate-200/85 bg-white",
        WEEK_LEFT_RAIL_CLASS
      )}
    >
      <div className="sticky top-0 z-10 border-b border-slate-200/90 bg-white/95 px-3 pb-2 pt-3 backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {tr(language, "Time", "เวลา")}
        </p>
      </div>
      {HOURS_24.map((hour, index) => (
        <div
          key={hour}
          className="relative border-b border-slate-200/80 last:border-b-0 bg-white"
          style={{ height: HOUR_HEIGHT }}
        >
          <span className="absolute -top-[0.72em] left-2 bg-white px-1 py-0.5 text-[11px] font-medium leading-none text-slate-500 md:left-3 md:text-xs">
            {index > 0 ? formatHourLabel(index, language) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Current Time Indicator
// ══════════════════════════════════════════════════════════
function CurrentTimeIndicator() {
  const [top, setTop] = useState(() => getCurrentTimePosition());

  useEffect(() => {
    const interval = setInterval(() => {
      setTop(getCurrentTimePosition());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top }}
    >
      <div className="flex items-center">
        <div className="-ml-[5px] size-2.5 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" />
        <div className="flex-1 h-[2px] bg-rose-500" />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Day Column (Square UI calendar-day-column.tsx)
// ══════════════════════════════════════════════════════════
function DayColumn({
  date,
  scrollRef,
  onSlotSelect,
}: {
  date: Date;
  scrollRef: (el: HTMLDivElement | null) => void;
  onSlotSelect?: (slot: CalendarSlotSelection) => void;
}) {
  const language = useLanguageStore((state) => state.language);
  const today = isToday(date);
  const columnHeight = HOURS_24.length * HOUR_HEIGHT;
  const [selection, setSelection] = useState<{
    pointerId: number;
    startMinute: number;
    currentMinute: number;
  } | null>(null);

  const resolveSnappedMinute = (clientY: number, rect: DOMRect) => {
    const y = Math.min(Math.max(clientY - rect.top, 0), columnHeight - 1);
    const minuteInDay = Math.floor((y / HOUR_HEIGHT) * 60);
    return Math.max(0, Math.min(Math.floor(minuteInDay / 15) * 15, 23 * 60 + 45));
  };

  const emitSelection = (startMinuteOfDay: number, endMinuteOfDay: number) => {
    if (!onSlotSelect) return;

    const normalizedEndMinute =
      endMinuteOfDay >= 24 * 60 ? 23 * 60 + 59 : endMinuteOfDay;
    const startHour = Math.floor(startMinuteOfDay / 60);
    const startMinute = startMinuteOfDay % 60;
    const endHour = Math.floor(normalizedEndMinute / 60);
    const endMinute = normalizedEndMinute % 60;

    onSlotSelect({
      date: new Date(date),
      startHour,
      startMinute,
      endHour,
      endMinute,
    });
  };

  const finalizeSelection = (draft: {
    startMinute: number;
    currentMinute: number;
  }) => {
    const lowerBound = Math.min(draft.startMinute, draft.currentMinute);
    const upperBound = Math.max(draft.startMinute, draft.currentMinute);
    const isClickSelection = upperBound === lowerBound;
    const endMinuteOfDay = isClickSelection
      ? Math.min(lowerBound + 60, 24 * 60)
      : Math.min(upperBound + 15, 24 * 60);

    emitSelection(lowerBound, endMinuteOfDay);
  };

  const previewStartMinute = selection
    ? Math.min(selection.startMinute, selection.currentMinute)
    : null;
  const previewEndMinute = selection
    ? (() => {
        const lowerBound = Math.min(selection.startMinute, selection.currentMinute);
        const upperBound = Math.max(selection.startMinute, selection.currentMinute);
        return upperBound === lowerBound
          ? Math.min(lowerBound + 60, 24 * 60)
          : Math.min(upperBound + 15, 24 * 60);
      })()
    : null;
  const previewTop =
    previewStartMinute !== null ? (previewStartMinute / 60) * HOUR_HEIGHT : null;
  const previewHeight =
    previewStartMinute !== null && previewEndMinute !== null
      ? Math.max(((previewEndMinute - previewStartMinute) / 60) * HOUR_HEIGHT, 24)
      : null;

  return (
    <div
      ref={scrollRef}
      className={cn(
        "relative border-r border-slate-200/85 last:border-r-0",
        WEEK_DAY_COLUMN_CLASS,
        today
          ? "bg-[linear-gradient(180deg,rgba(14,165,233,0.06),rgba(240,249,255,0.92)_14%,rgba(255,255,255,1))]"
          : "bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(248,250,252,0.88))]"
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-16 bg-[linear-gradient(180deg,rgba(255,255,255,0.75),rgba(255,255,255,0))]" />
      <div
        className={cn("relative", onSlotSelect && "cursor-cell")}
        style={{ height: columnHeight }}
        onPointerDown={(event) => {
          if (!onSlotSelect || event.button !== 0) return;
          const minute = resolveSnappedMinute(event.clientY, event.currentTarget.getBoundingClientRect());
          event.currentTarget.setPointerCapture(event.pointerId);
          setSelection({
            pointerId: event.pointerId,
            startMinute: minute,
            currentMinute: minute,
          });
        }}
        onPointerMove={(event) => {
          if (!selection || selection.pointerId !== event.pointerId) return;
          const minute = resolveSnappedMinute(event.clientY, event.currentTarget.getBoundingClientRect());
          setSelection((current) =>
            current && current.pointerId === event.pointerId
              ? { ...current, currentMinute: minute }
              : current
          );
        }}
        onPointerUp={(event) => {
          if (!selection || selection.pointerId !== event.pointerId) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          finalizeSelection(selection);
          setSelection(null);
        }}
        onPointerCancel={() => {
          setSelection(null);
        }}
        role="button"
        tabIndex={0}
        aria-disabled={!onSlotSelect}
        onKeyDown={(event) => {
          if (!onSlotSelect) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
          }
        }}
      >
        {HOURS_24.map((hour) => (
          <div
            key={`slot-${hour}`}
            className="border-b border-slate-200/80 transition-colors duration-200 hover:bg-sky-50/60"
            style={{ height: HOUR_HEIGHT }}
          />
        ))}
        {previewTop !== null && previewHeight !== null ? (
          <div
            className="pointer-events-none absolute inset-x-2 z-20 overflow-hidden rounded-[12px] border border-sky-300/90 bg-sky-100/85 shadow-[0_10px_18px_rgba(14,165,233,0.12)]"
            style={{ top: previewTop + 3, height: Math.max(previewHeight - 6, 18) }}
          >
            <div className="border-b border-sky-200/90 bg-sky-100/90 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-800">
              {previewStartMinute !== null && previewEndMinute !== null
                ? formatSelectionTimeRange(previewStartMinute, previewEndMinute, language)
                : null}
            </div>
            <div className="px-3 py-2 text-[12px] font-semibold text-sky-900">
              {tr(language, "New appointment", "นัดหมายใหม่")}
            </div>
          </div>
        ) : null}
        {today && <CurrentTimeIndicator />}
      </div>
    </div>
  );
}

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
// Event Detail Sheet (Square UI event-sheet.tsx)
// ══════════════════════════════════════════════════════════
export function EventDetailSheet({
  meeting,
  open,
  onOpenChange,
  onEdit,
  onGoToCalendar,
  onRefresh,
}: {
  meeting: Meeting | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (meeting: Meeting) => void;
  onGoToCalendar?: (meeting: Meeting) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const currentUserId = useAuthStore((s) => s.userId);
  const language = useLanguageStore((state) => state.language);
  const setMeetings = useCalendarStore((s) => s.setMeetings);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [copyingPatientLink, setCopyingPatientLink] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setNoteDialogOpen(false);
    }
  }, [open, meeting?.id]);

  if (!meeting) return null;

  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name || ""} ${meeting.doctor.last_name || ""}`.trim()
    : tr(language, "Unassigned Doctor", "ยังไม่ระบุแพทย์");
  const patientName = meeting.patient
    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
    : tr(language, "Unassigned Patient", "ยังไม่ระบุผู้ป่วย");
  const meetingDate = new Date(meeting.date_time);
  const meetingDuration = getMeetingDuration(meeting);
  const dateStr = meetingDate.toLocaleDateString(localeOf(language), {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const compactDateStr = formatCompactDate(meeting.date_time, language);
  const startTimeStr = formatTime12(meeting.date_time, language);
  const endTimeStr = formatTime12(addMinutes(meetingDate, meetingDuration).toISOString(), language);
  const compactTimeRange = `${formatCompactTime(meeting.date_time, language)}-${formatCompactTime(
    addMinutes(meetingDate, meetingDuration).toISOString(),
    language
  )}`;
  const noteText = meeting.note?.trim() ?? "";
  const hasNote = noteText.length > 0;
  const shouldCollapseNote = hasNote && (noteText.length > 180 || noteText.split(/\r?\n/).length > 4);
  const rawTitle = meeting.description?.trim();
  const title = rawTitle || patientName;
  const appointmentLabel = tr(language, "Appointment", "นัดหมาย");
  const roomTarget = normalizeRoomTarget(meeting.room);
  const canOpenRoom = Boolean(roomTarget);
  const isPatientWaiting = isPatientWaitingLive(meeting);
  const isDoctorLeftWaiting = isDoctorLeftWhilePatientWaiting(meeting);
  const effectiveStatus = getPresenceAwareStatus(meeting);
  const livePresenceInfo = getLivePresenceInfo(meeting, language);
  const statusColor = getStatusColor(effectiveStatus);
  const isAdmin = role === "admin";
  const isOwnerDoctor =
    role === "doctor" && Boolean(currentUserId) && meeting.doctor_id === currentUserId;
  const canWrite = isAdmin || isOwnerDoctor;
  const canDelete = isAdmin;
  const canCancel =
    canWrite && (effectiveStatus === "scheduled" || effectiveStatus === "waiting");
  const canStartCall = isOwnerDoctor && !["cancelled", "completed"].includes(meeting.status);

  const sheetParticipants = [
    {
      id: meeting.doctor?.id || "doctor",
      name: doctorName,
      email: meeting.doctor?.email || "",
      isOrganizer: true,
      isYou: false,
    },
    {
      id: meeting.patient?.id || "patient",
      name: patientName,
      email: "",
      isOrganizer: false,
      isYou: false,
    },
  ];

  const secondaryActionsVisible = canWrite || Boolean(onGoToCalendar);
  const summaryItems = [
    {
      icon: Calendar01Icon,
      label: tr(language, "Date", "วันที่"),
      value: compactDateStr,
      detail: dateStr,
    },
    {
      icon: Clock01Icon,
      label: tr(language, "Time", "เวลา"),
      value: compactTimeRange,
      detail: tr(language, "ICT", "เวลา ICT"),
    },
    {
      icon: UserGroupIcon,
      label: tr(language, "Participants", "ผู้เข้าร่วม"),
      value: tr(language, `${sheetParticipants.length} people`, `${sheetParticipants.length} คน`),
      detail: tr(language, "Doctor + patient", "แพทย์ + ผู้ป่วย"),
    },
  ];

  const handleDelete = async () => {
    if (!token || deleting) return;
    if (!canDelete) {
      toast.error(tr(language, "Only admin can delete meetings", "เฉพาะผู้ดูแลระบบเท่านั้นที่ลบนัดหมายได้"));
      return;
    }
    setDeleting(true);
    try {
      await deleteMeeting(meeting.id, token);
      const current = useCalendarStore.getState().meetings;
      setMeetings(current.filter((m) => m.id !== meeting.id));
      toast.success(tr(language, "Appointment deleted", "ลบนัดหมายแล้ว"));
      onOpenChange(false);
      await onRefresh?.();
    } catch {
      toast.error(tr(language, "Failed to delete appointment", "ลบนัดหมายไม่สำเร็จ"));
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAction = () => {
    if (deleting) return;
    toast.destructiveAction(tr(language, "Delete appointment?", "ลบนัดหมายนี้ใช่ไหม?"), {
      description: tr(language, "This action cannot be undone.", "การกระทำนี้ไม่สามารถย้อนกลับได้"),
      button: {
        title: tr(language, "Delete", "ลบ"),
        onClick: () => {
          void handleDelete();
        },
      },
      duration: 9000,
    });
  };

  const handleCancel = async () => {
    if (!token || cancelling) return;
    if (!canCancel) {
      toast.error(
        tr(
          language,
          "This appointment can no longer be cancelled here.",
          "นัดหมายนี้ไม่สามารถยกเลิกจากหน้านี้ได้แล้ว"
        )
      );
      return;
    }

    setCancelling(true);
    try {
      const updatedMeeting = await updateMeeting(
        meeting.id,
        {
          status: "cancelled",
          reason: isAdmin
            ? tr(language, "Cancelled by admin", "ยกเลิกโดยผู้ดูแลระบบ")
            : tr(language, "Cancelled by doctor", "ยกเลิกโดยแพทย์"),
        },
        token
      );
      const current = useCalendarStore.getState().meetings;
      setMeetings(current.map((item) => (item.id === meeting.id ? updatedMeeting : item)));
      toast.success(
        tr(
          language,
          "Appointment cancelled. Find it in Queue > Cancelled or turn on Show cancelled in Filters.",
          "ยกเลิกนัดหมายแล้ว ดูย้อนหลังได้ที่ คิว > ยกเลิก หรือเปิด แสดงนัดที่ยกเลิก ในตัวกรอง"
        )
      );
      onOpenChange(false);
      await onRefresh?.();
    } catch {
      toast.error(tr(language, "Failed to cancel appointment", "ยกเลิกนัดหมายไม่สำเร็จ"));
    } finally {
      setCancelling(false);
    }
  };

  const handleCancelAction = () => {
    if (cancelling) return;
    toast.warningAction(tr(language, "Cancel appointment?", "ยกเลิกนัดหมายใช่ไหม?"), {
      description: tr(
        language,
        "This appointment will be removed from the working queue but kept in history.",
        "นัดหมายนี้จะถูกเอาออกจากคิวทำงาน แต่ยังเก็บประวัติไว้"
      ),
      button: {
        title: tr(language, "Cancel Appointment", "ยืนยันยกเลิกนัดหมาย"),
        onClick: () => {
          void handleCancel();
        },
      },
      duration: 9000,
    });
  };

  const handleEdit = () => {
    if (!canWrite) {
      toast.error(tr(language, "This meeting is read-only for your account", "บัญชีของคุณดูได้อย่างเดียวสำหรับนัดหมายนี้"));
      return;
    }
    if (onEdit) {
      onEdit(meeting);
      onOpenChange(false);
    }
  };

  const handleCopy = () => {
    const lines: string[] = [
      `📅 ${title}`,
      `${tr(language, "Date", "วันที่")}: ${dateStr}`,
      `${tr(language, "Time", "เวลา")}: ${startTimeStr} - ${endTimeStr} (${tr(language, "ICT", "เวลา ICT")})`,
      `${tr(language, "Doctor", "แพทย์")}: ${doctorName}`,
      `${tr(language, "Patient", "ผู้ป่วย")}: ${patientName}`,
    ];
    if (meeting.room) lines.push(`${tr(language, "Room", "ห้อง")}: ${meeting.room}`);
    if (hasNote) lines.push(`${tr(language, "Note", "บันทึก")}: ${noteText}`);
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success(tr(language, "Appointment details copied to clipboard", "คัดลอกรายละเอียดนัดหมายแล้ว"));
  };

  const handleDuplicate = async () => {
    if (!token || duplicating) return;
    if (!canWrite) {
      toast.error(tr(language, "This meeting is read-only for your account", "บัญชีของคุณดูได้อย่างเดียวสำหรับนัดหมายนี้"));
      return;
    }

    const doctorId = meeting.doctor_id || meeting.doctor?.id || "";
    const patientId = meeting.user_id || meeting.patient?.id || "";
    if (!doctorId || !patientId) {
      toast.error(tr(language, "Cannot duplicate: missing doctor or patient information", "ทำซ้ำไม่ได้: ข้อมูลแพทย์หรือผู้ป่วยไม่ครบ"));
      return;
    }

    setDuplicating(true);
    try {
      const payload: MeetingCreatePayload = {
        date_time: meeting.date_time,
        doctor_id: doctorId,
        user_id: patientId,
        description: meeting.description || undefined,
        note: meeting.note || undefined,
        room: meeting.room || undefined,
      };
      const newMeeting = await createMeeting(payload, token);
      const current = useCalendarStore.getState().meetings;
      setMeetings([...current, newMeeting]);
      toast.success(tr(language, "Appointment duplicated", "ทำซ้ำนัดหมายแล้ว"));
      onOpenChange(false);
      await onRefresh?.();
    } catch {
      toast.error(tr(language, "Failed to duplicate appointment", "ทำซ้ำนัดหมายไม่สำเร็จ"));
    } finally {
      setDuplicating(false);
    }
  };

  const handleOpenRoom = () => {
    if (!roomTarget) {
      toast.error(tr(language, "This room does not have a valid meeting link", "ห้องนี้ไม่มีลิงก์ประชุมที่ใช้งานได้"));
      return;
    }

    if (roomTarget.startsWith("/")) {
      window.location.assign(roomTarget);
      return;
    }

    window.open(roomTarget, "_blank", "noopener,noreferrer");
  };

  const handleStartCall = () => {
    if (!canStartCall) {
      toast.error(tr(language, "Only the assigned doctor can start this call", "เฉพาะแพทย์เจ้าของนัดหมายเท่านั้นที่เริ่มคอลได้"));
      return;
    }
    const callParams = new URLSearchParams();
    const pn = [meeting.patient?.first_name, meeting.patient?.last_name].filter(Boolean).join(" ");
    if (pn) callParams.set("pn", pn);
    if (meeting.date_time) callParams.set("pt", meeting.date_time);
    const qs = callParams.toString();
    void preloadMeetingCallExperience();
    window.location.assign(`/meetings/call/${meeting.id}${qs ? `?${qs}` : ""}`);
  };
  const handleStartCallIntent = () => {
    if (!canStartCall) {
      return;
    }
    void preloadMeetingCallExperience();
  };

  const handleCopyPatientJoinLink = async () => {
    if (!token || copyingPatientLink) return;
    if (!canWrite) {
      toast.error(
        tr(language, "This meeting is read-only for your account", "บัญชีของคุณดูได้อย่างเดียวสำหรับนัดหมายนี้")
      );
      return;
    }
    setCopyingPatientLink(true);
    try {
      const existingInviteUrl = meeting.patient_invite_url?.trim();
      const inviteUrl = existingInviteUrl
        ? existingInviteUrl
        : (await createMeetingPatientInvite(meeting.id, token)).invite_url;
      await navigator.clipboard.writeText(inviteUrl);
      toast.success(
        tr(
          language,
          "Patient join link copied. Send this to patient now.",
          "คัดลอกลิงก์คนไข้แล้ว สามารถส่งให้คนไข้ได้ทันที"
        )
      );
    } catch {
      toast.error(
        tr(
          language,
          "Unable to generate patient link right now.",
          "ไม่สามารถสร้างลิงก์คนไข้ได้ในขณะนี้"
        )
      );
    } finally {
      setCopyingPatientLink(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full sm:max-w-[448px] overflow-y-auto border-l border-r border-t bg-background p-0 [&>button]:hidden"
        >
          <div className="flex h-full flex-col bg-background">
            <SheetHeader className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 pt-4 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/88">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]",
                        statusColor.text
                      )}
                      style={{ backgroundColor: "color-mix(in srgb, currentColor 10%, white)" }}
                    >
                      <span className={cn("size-2 rounded-full", statusColor.dot)} />
                      {getMeetingStatusLabel(effectiveStatus, language)}
                    </span>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {tr(language, "Appointment", "นัดหมาย")}
                  </p>
                  <SheetTitle className="mt-1 max-w-[16ch] text-[22px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[24px]">
                    {title}
                  </SheetTitle>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <p className="truncate">{appointmentLabel}</p>
                    <span className="hidden text-border sm:inline">•</span>
                    <p className="truncate">{doctorName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="border-border/80 bg-background/90"
                          title={tr(language, "More actions", "การกระทำเพิ่มเติม")}
                        >
                          <MoreHorizontal className="size-4" />
                          <span className="sr-only">{tr(language, "More", "เพิ่มเติม")}</span>
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={handleCopy}>
                        <HugeiconsIcon icon={Copy01Icon} className="size-4" />
                        {tr(language, "Copy appointment details", "คัดลอกรายละเอียดนัดหมาย")}
                      </DropdownMenuItem>
                      {canWrite && (
                        <DropdownMenuItem
                          onClick={() => {
                            void handleDuplicate();
                          }}
                          disabled={duplicating}
                        >
                          <HugeiconsIcon icon={Layers01Icon} className="size-4" />
                          {tr(language, "Duplicate appointment", "ทำซ้ำนัดหมาย")}
                        </DropdownMenuItem>
                      )}
                      {canCancel && (
                        <DropdownMenuItem
                          onClick={handleCancelAction}
                          disabled={cancelling}
                        >
                          <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
                          {tr(language, "Cancel appointment", "ยกเลิกนัดหมาย")}
                        </DropdownMenuItem>
                      )}
                      {canDelete && <DropdownMenuSeparator />}
                      {canDelete && (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={handleDeleteAction}
                          disabled={deleting}
                        >
                          <HugeiconsIcon icon={Delete01Icon} className="size-4" />
                          {tr(language, "Delete appointment", "ลบนัดหมาย")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <SheetClose
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full bg-background/80 hover:bg-muted"
                      >
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          className="size-4 text-muted-foreground"
                        />
                      </Button>
                    }
                  />
                </div>
              </div>

              {isPatientWaiting && (
                <div className="mt-4 rounded-3xl border border-amber-500/25 bg-amber-50/80 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex size-9 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-700">
                      <HugeiconsIcon icon={Clock01Icon} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-amber-800">
                        {isDoctorLeftWaiting
                          ? tr(
                              language,
                              "Doctor left room while patient is still waiting",
                              "หมอออกจากห้องแล้ว แต่คนไข้ยังรออยู่"
                            )
                          : tr(language, "Patient is in waiting room now", "คนไข้อยู่ในห้องรอแล้ว")}
                      </p>
                      <p className="mt-0.5 text-sm text-amber-700/90">
                        {isDoctorLeftWaiting
                          ? tr(
                              language,
                              "Rejoin now so patient does not stay alone in room.",
                              "แนะนำให้กลับเข้าห้องทันที เพื่อไม่ให้คนไข้รออยู่คนเดียว"
                            )
                          : tr(
                              language,
                              "Start call now to avoid patient drop-off.",
                              "แนะนำให้กดเริ่มคอลทันที เพื่อลดโอกาสคนไข้หลุดจากห้องรอ"
                            )}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="h-10 rounded-xl bg-amber-600 px-3 text-white hover:bg-amber-700"
                      onClick={handleStartCall}
                      onMouseEnter={handleStartCallIntent}
                      onFocus={handleStartCallIntent}
                      onTouchStart={handleStartCallIntent}
                      disabled={!canStartCall}
                    >
                      <HugeiconsIcon icon={CallIcon} className="size-3.5" />
                      <span>{tr(language, "Start now", "เริ่มเลย")}</span>
                    </Button>
                  </div>
                </div>
              )}

              {livePresenceInfo?.tone === "offline" && (
                <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-50 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex size-9 items-center justify-center rounded-2xl bg-slate-200 text-slate-700 dark:text-slate-300">
                      <HugeiconsIcon icon={Clock01Icon} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {tr(language, "No one has entered the room yet", "ยังไม่มีใครเข้าห้อง")}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-700/90 dark:text-slate-300/90">
                        {tr(
                          language,
                          "Copy the patient link or wait for the patient to open the room before starting the call.",
                          "คัดลอกลิงก์ให้คนไข้ หรือรอให้คนไข้เปิดห้องก่อนเริ่มคอล"
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {livePresenceInfo?.tone === "left" && (
                <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-50 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex size-9 items-center justify-center rounded-2xl bg-slate-200 text-slate-700 dark:text-slate-300">
                      <HugeiconsIcon icon={AlertCircleIcon} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {tr(language, "Patient left the room", "คนไข้ออกจากห้องแล้ว")}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-700/90 dark:text-slate-300/90">
                        {tr(
                          language,
                          "If the visit should continue, ask patient to reopen the room link.",
                          "หากต้องการตรวจต่อ ให้คนไข้เปิดลิงก์เข้าห้องอีกครั้ง"
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button
                  className="h-11 justify-center gap-2 rounded-2xl text-sm shadow-sm"
                  onClick={handleStartCall}
                  onMouseEnter={handleStartCallIntent}
                  onFocus={handleStartCallIntent}
                  onTouchStart={handleStartCallIntent}
                  disabled={!canStartCall}
                >
                  <HugeiconsIcon icon={CallIcon} className="size-4" />
                  <span>{tr(language, "Start Call", "เริ่มคอล")}</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-11 justify-center gap-2 rounded-2xl border-border bg-background px-3 text-sm"
                  onClick={() => {
                    void handleCopyPatientJoinLink();
                  }}
                  disabled={!canWrite || copyingPatientLink}
                >
                  <HugeiconsIcon icon={LinkSquare01Icon} className="size-4" />
                  <span>
                    {copyingPatientLink
                      ? tr(language, "Generating link...", "กำลังสร้างลิงก์...")
                      : tr(language, "Copy patient link", "คัดลอกลิงก์คนไข้")}
                  </span>
                </Button>
              </div>

              <div className="mt-4 overflow-hidden rounded-[24px] border border-border/80 bg-slate-50/75 shadow-[0_1px_2px_rgba(15,40,84,0.04)]">
                {summaryItems.map((item, index) => (
                  <div
                    key={item.label}
                    className={cn(
                      "flex items-start justify-between gap-4 px-4 py-3",
                      index > 0 && "border-t border-border/70"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <HugeiconsIcon icon={item.icon} className="size-3.5" />
                        <span>{item.label}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                    <p className="min-w-0 text-right text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              {secondaryActionsVisible && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canCancel && (
                    <Button
                      variant="outline"
                      className="min-h-10 justify-center gap-2 rounded-2xl border-rose-200 bg-rose-50 px-4 text-sm text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                      onClick={handleCancelAction}
                      disabled={cancelling}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
                      <span>{tr(language, "Cancel appointment", "ยกเลิกนัดหมาย")}</span>
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      variant="outline"
                      className="min-h-10 justify-center gap-2 rounded-2xl border-border bg-background px-4 text-sm"
                      onClick={handleEdit}
                    >
                      <HugeiconsIcon icon={PencilEdit01Icon} className="size-4" />
                      <span>{tr(language, "Edit appointment", "แก้ไขนัดหมาย")}</span>
                    </Button>
                  )}
                  {onGoToCalendar && (
                    <Button
                      variant="outline"
                      className="min-h-10 justify-center gap-2 rounded-2xl border-border bg-background px-4 text-sm"
                      onClick={() => {
                        onGoToCalendar(meeting);
                        onOpenChange(false);
                      }}
                    >
                      <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
                      <span>{tr(language, "View in Calendar", "ดูในปฏิทิน")}</span>
                    </Button>
                  )}
                </div>
              )}
            </SheetHeader>

            <div className="flex-1 overflow-y-auto bg-background px-4 py-4">
              <div className="mx-auto flex max-w-[420px] flex-col gap-3">
                <section className="border-t border-border/70 pt-4">
                  <div className="mb-2.5 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {tr(language, "Participants", "ผู้เข้าร่วม")}
                      </h3>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
                      {tr(language, `${sheetParticipants.length} people`, `${sheetParticipants.length} คน`)}
                    </span>
                  </div>

                  <div className="overflow-hidden rounded-[24px] border border-border/80 bg-background shadow-[0_1px_2px_rgba(15,40,84,0.04)]">
                    {sheetParticipants.map((participant) => (
                      <div
                        key={participant.id}
                        className="flex items-start gap-2.5 px-4 py-3 first:pt-4 last:pb-4 [&+&]:border-t [&+&]:border-border/70"
                      >
                        <Avatar className="size-8 shrink-0 border border-background shadow-sm">
                          <AvatarFallback
                            className={cn(
                              "text-xs font-bold",
                              participant.isOrganizer
                                ? "bg-cyan-500/20 text-cyan-500"
                                : "bg-emerald-500/20 text-emerald-500"
                            )}
                          >
                            {getInitial(participant.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-sm font-medium leading-5 text-foreground">
                              {participant.name}
                            </p>
                            {participant.isOrganizer && (
                              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs font-medium text-cyan-600">
                                {tr(language, "Organizer", "ผู้จัด")}
                              </span>
                            )}
                            {participant.isYou && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                                {tr(language, "You", "คุณ")}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-sm leading-5 text-muted-foreground">
                            {participant.email || tr(language, "No contact email", "ไม่มีอีเมลติดต่อ")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border-t border-border/70 pt-4">
                  <div className="mb-2.5">
                    <h3 className="text-sm font-semibold text-foreground">
                      {tr(language, "Visit details", "รายละเอียดการนัดหมาย")}
                    </h3>
                  </div>

                  <div className="overflow-hidden rounded-[24px] border border-border/80 bg-background shadow-[0_1px_2px_rgba(15,40,84,0.04)]">
                    <div className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          <HugeiconsIcon
                            icon={Clock01Icon}
                            className="size-3.5"
                          />
                          <span>{tr(language, "Schedule", "กำหนดเวลา")}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{compactDateStr}</p>
                      </div>
                      <p className="text-right text-sm font-semibold text-foreground">{compactTimeRange} ICT</p>
                    </div>

                    <div className="flex items-start justify-between gap-4 border-t border-border/70 px-4 py-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          <HugeiconsIcon
                            icon={Notification01Icon}
                            className="size-3.5"
                          />
                          <span>{tr(language, "Reminder", "แจ้งเตือน")}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{tr(language, "Appointment reminder", "การแจ้งเตือนนัดหมาย")}</p>
                      </div>
                      <p className="text-right text-sm font-semibold text-foreground">
                        {tr(language, "30 min before", "30 นาทีก่อน")}
                      </p>
                    </div>

                    <div className="flex items-start justify-between gap-4 border-t border-border/70 px-4 py-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          <HugeiconsIcon
                            icon={Calendar01Icon}
                            className="size-3.5"
                          />
                          <span>{tr(language, "Doctor", "แพทย์")}</span>
                        </div>
                        <p className="truncate text-sm font-semibold text-foreground">{doctorName}</p>
                      </div>
                      <p className="truncate text-right text-sm text-muted-foreground">
                        {meeting.doctor?.email || tr(language, "No contact email", "ไม่มีอีเมลติดต่อ")}
                      </p>
                    </div>

                    <div className="flex items-start justify-between gap-4 border-t border-border/70 px-4 py-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          <HugeiconsIcon
                            icon={UserGroupIcon}
                            className="size-3.5"
                          />
                          <span>{tr(language, "Participants", "ผู้เข้าร่วม")}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{tr(language, "Doctor and patient", "แพทย์และผู้ป่วย")}</p>
                      </div>
                      <p className="text-right text-sm font-semibold text-foreground">
                        {tr(language, `${sheetParticipants.length} people`, `${sheetParticipants.length} คน`)}
                      </p>
                    </div>

                    {meeting.room && (
                      <div className="border-t border-border/70 px-4 py-3">
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          <HugeiconsIcon
                            icon={CallIcon}
                            className="size-3.5"
                          />
                          <span>{tr(language, "Room access", "ทางเข้าห้องตรวจ")}</span>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-slate-50 px-3 py-3 text-sm font-medium text-foreground">
                          {meeting.room}
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Button
                            className="min-h-10 flex-1 gap-2 rounded-2xl shadow-sm disabled:opacity-60"
                            onClick={handleOpenRoom}
                            disabled={!canOpenRoom}
                          >
                            <span>
                              {canOpenRoom
                                ? tr(language, "Open meeting link", "เปิดลิงก์ห้องตรวจ")
                                : tr(language, "Meeting link unavailable", "ไม่มีลิงก์ประชุม")}
                            </span>
                          </Button>
                          <Button
                            variant="outline"
                            className="min-h-10 flex-1 gap-2 rounded-2xl border-border bg-background"
                            onClick={() => {
                              navigator.clipboard.writeText(meeting.room || "");
                              toast.success(tr(language, "Room copied", "คัดลอกห้องแล้ว"));
                            }}
                          >
                            <HugeiconsIcon
                              icon={LinkSquare01Icon}
                              className="size-4"
                            />
                            <span>{tr(language, "Copy", "คัดลอก")}</span>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="border-t border-border/70 pt-4">
                  <div className="mb-2.5 flex items-start gap-3">
                    <div className="rounded-xl bg-slate-100 p-1.5 text-muted-foreground">
                      <HugeiconsIcon icon={NoteIcon} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-foreground">
                        {tr(language, "Notes from doctor", "บันทึกจากแพทย์")}
                      </h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {hasNote
                          ? tr(language, "Clinical note attached to this appointment", "มีบันทึกคลินิกแนบกับนัดหมายนี้")
                          : tr(language, "No note has been added yet", "ยังไม่มีการเพิ่มบันทึก")}
                      </p>
                    </div>
                  </div>

                  {hasNote ? (
                    <div className="space-y-2.5">
                      <div className="rounded-[24px] border border-border/80 bg-slate-50 px-4 py-4 text-sm leading-6 text-foreground/80">
                        <p
                          className={cn(
                            "break-words whitespace-pre-wrap",
                            shouldCollapseNote && "line-clamp-4"
                          )}
                        >
                          {noteText}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {shouldCollapseNote
                            ? tr(language, "Showing a short preview of the note", "กำลังแสดงตัวอย่างบันทึกแบบย่อ")
                            : tr(language, "Full note is visible here", "กำลังแสดงบันทึกเต็มในส่วนนี้")}
                        </p>
                        {shouldCollapseNote && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full px-3 text-sm"
                            onClick={() => setNoteDialogOpen(true)}
                          >
                            {tr(language, "Read full note", "อ่านทั้งหมด")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-border/80 bg-slate-50 px-4 py-4">
                      <p className="text-sm leading-6 text-muted-foreground">
                        {tr(
                          language,
                          "No notes available for this appointment.",
                          "ยังไม่มีบันทึกสำหรับนัดหมายนี้"
                        )}
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>{tr(language, "Clinical note", "บันทึกทางการแพทย์")}</DialogTitle>
            <DialogDescription>
              {tr(
                language,
                "Full note attached to this appointment.",
                "บันทึกฉบับเต็มที่แนบกับนัดหมายนี้"
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-2xl border border-border/80 bg-slate-50 px-4 py-4">
            <pre className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/85 font-sans">
              {noteText}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
