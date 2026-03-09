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
  ArrowUpRight01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
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
  getEventTop,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { createMeetingPatientInvite, deleteMeeting, createMeeting } from "@/lib/api";
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

/* ── Helpers ── */

export interface CalendarSlotSelection {
  date: Date;
  startHour: number;
  startMinute: number;
}

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";
const TH_MEETING_STATUS_LABELS: Partial<Record<MeetingStatus, string>> = {
  scheduled: "กำหนดการ",
  waiting: "รอหมอเข้าห้อง",
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

function getTimeRange(dateTime: string, language: AppLanguage, durationMin: number = 60) {
  const start = new Date(dateTime);
  const end = addMinutes(start, durationMin);
  return `${formatTime12(dateTime, language)} - ${formatTime12(end.toISOString(), language)}`;
}

/** Status → dot color + border accent */
function getStatusColor(status?: MeetingStatus): { dot: string; border: string; text: string } {
  switch (status) {
    case "waiting":
      return { dot: "bg-amber-500", border: "border-l-amber-500", text: "text-amber-600 dark:text-amber-400" };
    case "in_progress":
      return { dot: "bg-blue-500", border: "border-l-blue-500", text: "text-blue-600 dark:text-blue-400" };
    case "overtime":
      return { dot: "bg-red-500", border: "border-l-red-500", text: "text-red-600 dark:text-red-400" };
    case "completed":
      return { dot: "bg-emerald-500", border: "border-l-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
    case "cancelled":
      return { dot: "bg-gray-400", border: "border-l-gray-400", text: "text-gray-500" };
    case "scheduled":
    default:
      return { dot: "bg-cyan-500", border: "border-l-cyan-500", text: "text-cyan-600 dark:text-cyan-400" };
  }
}

function getInitial(name: string | null | undefined): string {
  return name?.charAt(0)?.toUpperCase() || "?";
}

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
      className="w-[80px] md:w-[104px] shrink-0 relative sticky left-0 z-30 bg-background border-r border-border"
    >
      {HOURS_24.map((hour) => (
        <div
          key={hour}
          className="relative"
          style={{ height: HOUR_HEIGHT }}
        >
          <span className="absolute -top-[0.6em] left-2 bg-background px-0.5 text-sm leading-none text-muted-foreground md:left-3 md:text-[0.95rem]">
            {Number(hour) > 0 ? formatHourLabel(Number(hour), language) : ""}
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
        <div className="size-2.5 rounded-full bg-red-500 -ml-[5px]" />
        <div className="flex-1 h-[2px] bg-red-500" />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Event Card (Square UI event-card.tsx)
// ══════════════════════════════════════════════════════════
function EventCard({
  meeting,
  onClick,
}: {
  meeting: Meeting;
  onClick: () => void;
}) {
  const language = useLanguageStore((state) => state.language);
  const top = getEventTop(meeting.date_time) + 4;
  const duration = getMeetingDuration(meeting);
  const height = Math.max((duration / 60) * HOUR_HEIGHT - 8, 28);
  const isVeryShort = height < 36;
  const isMedium = height >= 36 && height < 80;

  const title =
    meeting.description ||
    (meeting.patient
      ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
      : tr(language, "Appointment", "นัดหมาย"));
  const isWaiting = isPatientWaitingLive(meeting);
  const effectiveStatus = getPresenceAwareStatus(meeting);
  const livePresenceInfo = getLivePresenceInfo(meeting, language);
  const timeStr = getTimeRange(meeting.date_time, language, duration);
  const statusColor = getStatusColor(effectiveStatus);
  const waitingText = tr(language, "Patient waiting", "คนไข้รออยู่");

  const participants = [
    meeting.doctor
      ? {
        id: meeting.doctor.id,
        name: `Dr. ${meeting.doctor.first_name || ""} ${meeting.doctor.last_name || ""}`.trim(),
      }
      : null,
    meeting.patient
      ? {
        id: meeting.patient.id,
        name: `${meeting.patient.first_name} ${meeting.patient.last_name}`,
      }
      : null,
  ].filter(Boolean) as { id: string; name: string }[];

  // Very short event – single-line card
  if (isVeryShort) {
    return (
      <button
        type="button"
        className={cn(
          "absolute left-2 right-2 bg-card border border-border border-l-2 rounded-lg px-2 py-1 z-10 flex items-center gap-1.5 cursor-pointer hover:bg-muted transition-colors",
          statusColor.border,
          isWaiting && "border-amber-300/70 bg-amber-50/50 ring-1 ring-amber-300/40"
        )}
        style={{ top, height }}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <div className="relative shrink-0">
          {isWaiting && <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-60" />}
          <div className={cn("size-1.5 rounded-full relative", statusColor.dot)} />
        </div>
        <h4 className="flex-1 truncate text-[11px] font-semibold text-foreground">
          {title}
        </h4>
        {isWaiting && (
          <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold text-amber-700">
            {tr(language, "Waiting", "รอหมอ")}
          </span>
        )}
        {livePresenceInfo?.tone === "offline" && (
          <span className="rounded bg-slate-500/15 px-1 py-0.5 text-[9px] font-semibold text-slate-700">
            {tr(language, "Offline", "ออฟไลน์")}
          </span>
        )}
        {livePresenceInfo?.tone === "left" && (
          <span className="rounded bg-slate-500/15 px-1 py-0.5 text-[9px] font-semibold text-slate-700">
            {tr(language, "Left", "ออกแล้ว")}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatTime12(meeting.date_time, language)}
        </span>
      </button>
    );
  }

  // Medium event – title + time
  if (isMedium) {
    return (
      <button
        type="button"
        className={cn(
          "absolute left-2 right-2 bg-card border border-border border-l-2 rounded-lg px-2.5 py-2 z-10 cursor-pointer hover:bg-muted transition-colors",
          statusColor.border,
          isWaiting && "border-amber-300/70 bg-amber-50/50 ring-1 ring-amber-300/40"
        )}
        style={{ top, height }}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <div className="flex flex-col gap-1 h-full">
          <div className="flex items-center gap-1.5">
            <div className="relative shrink-0">
              {isWaiting && <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-60" />}
              <div className={cn("size-1.5 rounded-full relative", statusColor.dot)} />
            </div>
            <h4 className="flex-1 truncate text-[11px] font-semibold text-foreground">
              {title}
            </h4>
            {isWaiting && (
              <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold text-amber-700">
                {tr(language, "Waiting", "รอหมอ")}
              </span>
            )}
            {livePresenceInfo?.tone === "offline" && (
              <span className="rounded bg-slate-500/15 px-1 py-0.5 text-[9px] font-semibold text-slate-700">
                {tr(language, "Offline", "ออฟไลน์")}
              </span>
            )}
            {livePresenceInfo?.tone === "left" && (
              <span className="rounded bg-slate-500/15 px-1 py-0.5 text-[9px] font-semibold text-slate-700">
                {tr(language, "Left", "ออกแล้ว")}
              </span>
            )}
          </div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {timeStr}
          </p>
        </div>
      </button>
    );
  }

  // Full event card
  return (
    <button
      type="button"
      className={cn(
        "absolute left-2 right-2 bg-card border border-border border-l-2 rounded-lg p-3 z-10 cursor-pointer hover:bg-muted transition-colors",
        statusColor.border,
        meeting.status === "cancelled" && "opacity-60",
        isWaiting && "border-amber-300/70 bg-amber-50/60 ring-1 ring-amber-300/50 shadow-sm shadow-amber-500/20"
      )}
      style={{ top, height }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <div className="flex flex-col gap-1 h-full">
        <div className="flex-1 min-h-0">
          <div className="flex items-center gap-1.5 mb-1">
            <h4
              className={cn("text-xs font-semibold text-foreground flex-1",
                duration <= 60 ? "truncate whitespace-nowrap" : "line-clamp-2",
                meeting.status === "cancelled" && "line-through"
              )}
            >
              {title}
            </h4>
            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", statusColor.text, "bg-current/10")}
              style={{ backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)" }}
            >
              {getMeetingStatusLabel(effectiveStatus, language)}
            </span>
          </div>
          {isWaiting && (
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              <span className="relative inline-flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
              </span>
              {waitingText}
            </div>
          )}
          {livePresenceInfo?.tone === "active" && (
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {tr(language, "Doctor + patient in room", "หมอและคนไข้อยู่ในห้อง")}
            </div>
          )}
          {livePresenceInfo?.tone === "offline" && (
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-slate-500/25 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-slate-500" />
              {tr(language, "Patient offline", "คนไข้ออฟไลน์")}
            </div>
          )}
          {livePresenceInfo?.tone === "left" && (
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-slate-500/25 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-slate-500" />
              {tr(language, "Patient left room", "คนไข้ออกจากห้องแล้ว")}
            </div>
          )}
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            {timeStr}
          </p>

          {participants.length > 0 && (
            <div className="flex items-center gap-1.5 mb-2">
              <div className="flex -space-x-1.5">
                {participants.slice(0, 3).map((p) => (
                  <Avatar
                    key={p.id}
                    className="size-5 border-2 border-background"
                  >
                    <AvatarFallback className="bg-[var(--med-primary-light)]/15 text-[9px] font-bold text-[var(--med-primary-light)]">
                      {getInitial(p.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              {participants.length > 3 && (
                <span className="text-[11px] text-muted-foreground">
                  +{participants.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {meeting.room && (
          <div className="mt-auto flex items-center gap-1.5 text-[11px] text-cyan-500">
            <div className="size-4 rounded bg-cyan-500/10 flex items-center justify-center shrink-0">
              <svg className="size-2.5" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <span className="flex-1 truncate">{meeting.room}</span>
            <HugeiconsIcon
              icon={ArrowUpRight01Icon}
              className="size-3 shrink-0"
            />
          </div>
        )}
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════
// Day Column (Square UI calendar-day-column.tsx)
// ══════════════════════════════════════════════════════════
function DayColumn({
  date,
  meetings,
  scrollRef,
  onEventClick,
  onSlotSelect,
}: {
  date: Date;
  meetings: Meeting[];
  scrollRef: (el: HTMLDivElement | null) => void;
  onEventClick: (meeting: Meeting) => void;
  onSlotSelect?: (slot: CalendarSlotSelection) => void;
}) {
  const today = isToday(date);
  const columnHeight = HOURS_24.length * HOUR_HEIGHT;

  const handleSlotClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlotSelect) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const y = Math.min(
      Math.max(event.clientY - rect.top, 0),
      columnHeight - 1
    );

    const minuteInDay = Math.floor((y / HOUR_HEIGHT) * 60);
    const snappedMinute = Math.floor(minuteInDay / 15) * 15;
    const startHour = Math.floor(snappedMinute / 60);
    const startMinute = snappedMinute % 60;

    onSlotSelect({
      date: new Date(date),
      startHour,
      startMinute,
    });
  };

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex-1 last:border-r-0 relative min-w-44",
        today && "bg-[var(--med-primary-light)]/[0.03]"
      )}
    >
      <div
        className={cn("relative", onSlotSelect && "cursor-cell")}
        style={{ height: columnHeight }}
        onClick={handleSlotClick}
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
            style={{ height: HOUR_HEIGHT }}
          />
        ))}
        {today && <CurrentTimeIndicator />}
        {meetings.map((meeting) => (
          <EventCard
            key={meeting.id}
            meeting={meeting}
            onClick={() => onEventClick(meeting)}
          />
        ))}
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
  const [duplicating, setDuplicating] = useState(false);
  const [copyingPatientLink, setCopyingPatientLink] = useState(false);

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
    if (meeting.note) lines.push(`${tr(language, "Note", "บันทึก")}: ${meeting.note}`);
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
    window.location.assign(`/meetings/call/${meeting.id}`);
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
          className="w-full sm:max-w-[580px] overflow-y-auto border-l border-r border-t bg-background p-0 [&>button]:hidden"
        >
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border bg-[linear-gradient(180deg,rgba(189,232,245,0.18)_0%,rgba(255,255,255,0)_100%)] px-4 pt-4 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold uppercase tracking-[0.14em]",
                        statusColor.text
                      )}
                      style={{ backgroundColor: "color-mix(in srgb, currentColor 10%, white)" }}
                    >
                      <span className={cn("size-2 rounded-full", statusColor.dot)} />
                      {getMeetingStatusLabel(effectiveStatus, language)}
                    </span>
                    {meeting.room && (
                      <span className="inline-flex items-center rounded-full border border-border/80 bg-background/80 px-3 py-1 text-sm font-medium text-muted-foreground">
                        {tr(language, "Room", "ห้อง")} {meeting.room}
                      </span>
                    )}
                  </div>
                  <p className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {appointmentLabel}
                  </p>
                  <SheetTitle className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
                    {title}
                  </SheetTitle>
                  <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                    <p className="truncate">{doctorName}</p>
                    {rawTitle && <p className="truncate">{patientName}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 border-border/80 bg-background/90"
                          title={tr(language, "More actions", "การกระทำเพิ่มเติม")}
                        >
                          <MoreHorizontal className="size-4" />
                          <span>{tr(language, "More", "เพิ่มเติม")}</span>
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
                <div className="mt-4 rounded-2xl border border-amber-500/35 bg-gradient-to-r from-amber-500/15 to-orange-500/10 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex size-8 items-center justify-center rounded-full bg-amber-500/20 text-amber-700">
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
                      className="h-9 bg-amber-600 text-white hover:bg-amber-700"
                      onClick={handleStartCall}
                      disabled={!canStartCall}
                    >
                      <HugeiconsIcon icon={CallIcon} className="size-3.5" />
                      <span>{tr(language, "Start now", "เริ่มเลย")}</span>
                    </Button>
                  </div>
                </div>
              )}

              {livePresenceInfo?.tone === "offline" && (
                <div className="mt-4 rounded-2xl border border-slate-500/35 bg-slate-500/10 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex size-8 items-center justify-center rounded-full bg-slate-500/20 text-slate-700 dark:text-slate-300">
                      <HugeiconsIcon icon={Clock01Icon} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {tr(language, "Patient is offline now", "ตอนนี้คนไข้ออฟไลน์")}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-700/90 dark:text-slate-300/90">
                        {tr(
                          language,
                          "Ask patient to reopen the room link and wait in room.",
                          "แนะนำให้คนไข้เปิดลิงก์เข้าห้องใหม่และรอในห้องอีกครั้ง"
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {livePresenceInfo?.tone === "left" && (
                <div className="mt-4 rounded-2xl border border-slate-500/35 bg-slate-500/10 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex size-8 items-center justify-center rounded-full bg-slate-500/20 text-slate-700 dark:text-slate-300">
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

              <div className="mt-4 grid gap-2 rounded-2xl border border-border/80 bg-background/90 p-3 shadow-[0_1px_2px_rgba(15,40,84,0.05)] sm:grid-cols-3">
                {summaryItems.map((item) => (
                  <div key={item.label} className="min-w-0 rounded-xl bg-muted/35 px-3 py-2.5">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <HugeiconsIcon icon={item.icon} className="size-3.5" />
                      <span>{item.label}</span>
                    </div>
                    <p className="truncate text-sm font-semibold text-foreground">{item.value}</p>
                    <p className="truncate text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button
                  className="h-11 justify-center gap-2 text-sm shadow-sm"
                  onClick={handleStartCall}
                  disabled={!canStartCall}
                >
                  <HugeiconsIcon icon={CallIcon} className="size-4" />
                  <span>{tr(language, "Start Call", "เริ่มคอล")}</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-11 justify-center gap-2 border-border bg-background px-3 text-sm"
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

              {secondaryActionsVisible && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {canWrite && (
                    <Button
                      variant="outline"
                      className="min-h-9 flex-1 justify-center gap-2 border-border bg-background text-sm"
                      onClick={handleEdit}
                    >
                      <HugeiconsIcon icon={PencilEdit01Icon} className="size-4" />
                      <span>{tr(language, "Edit appointment", "แก้ไขนัดหมาย")}</span>
                    </Button>
                  )}
                  {onGoToCalendar && (
                    <Button
                      variant="outline"
                      className="min-h-9 flex-1 justify-center gap-2 border-border bg-background text-sm"
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

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="mx-auto flex max-w-[540px] flex-col gap-3">
                <section className="rounded-2xl border border-border bg-card p-3 shadow-[0_1px_2px_rgba(15,40,84,0.05)]">
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

                  <div className="flex flex-col gap-2.5">
                    {sheetParticipants.map((participant) => (
                      <div
                        key={participant.id}
                        className="flex items-start gap-2.5"
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

                {meeting.room && (
                  <section className="rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(15,40,84,0.05)]">
                    <div className="mb-2.5 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {tr(language, "Room access", "ทางเข้าห้องตรวจ")}
                        </h3>
                      </div>
                      <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[var(--med-primary-light)]/12">
                        <svg
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <rect
                            x="3"
                            y="3"
                            width="18"
                            height="18"
                            rx="2"
                            fill="var(--med-primary-light)"
                            opacity="0.3"
                          />
                          <path
                            d="M8 12h8M12 8v8"
                            stroke="var(--med-primary-light)"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/35 px-3 py-2 text-sm font-medium text-foreground">
                      {meeting.room}
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        className="min-h-9 flex-1 gap-2 shadow-sm disabled:opacity-60"
                        onClick={handleOpenRoom}
                        disabled={!canOpenRoom}
                      >
                        <span>
                          {canOpenRoom
                            ? tr(language, `Go to ${meeting.room}`, `ไปที่ ${meeting.room}`)
                            : tr(language, "Meeting link unavailable", "ไม่มีลิงก์ประชุม")}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-9 flex-1 gap-2 border-border bg-background"
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
                  </section>
                )}

                <section className="rounded-2xl border border-border bg-card p-3 shadow-[0_1px_2px_rgba(15,40,84,0.05)]">
                  <div className="mb-2.5">
                    <h3 className="text-sm font-semibold text-foreground">
                      {tr(language, "Appointment details", "รายละเอียดนัดหมาย")}
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-muted/35 px-3 py-2.5 text-sm text-foreground">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <HugeiconsIcon
                          icon={Clock01Icon}
                          className="size-3.5"
                        />
                        <span>{tr(language, "Schedule", "กำหนดเวลา")}</span>
                      </div>
                      <p className="truncate text-sm leading-5 text-muted-foreground">{compactDateStr}</p>
                      <p className="truncate text-sm font-medium">{compactTimeRange} ICT</p>
                    </div>
                    <div className="rounded-xl bg-muted/35 px-3 py-2.5 text-sm text-foreground">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <HugeiconsIcon
                          icon={Notification01Icon}
                          className="size-3.5"
                        />
                        <span>{tr(language, "Reminder", "แจ้งเตือน")}</span>
                      </div>
                      <p className="text-sm font-medium">
                        {tr(language, "30 min before", "30 นาทีก่อน")}
                      </p>
                    </div>
                    <div className="rounded-xl bg-muted/35 px-3 py-2.5 text-sm text-foreground">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <HugeiconsIcon
                          icon={Calendar01Icon}
                          className="size-3.5"
                        />
                        <span>{tr(language, "Doctor", "แพทย์")}</span>
                      </div>
                      <p className="truncate text-sm font-medium">{doctorName}</p>
                      <p className="truncate text-sm leading-5 text-muted-foreground">
                        {meeting.doctor?.email || tr(language, "No contact email", "ไม่มีอีเมลติดต่อ")}
                      </p>
                    </div>
                    <div className="rounded-xl bg-muted/35 px-3 py-2.5 text-sm text-foreground">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <HugeiconsIcon
                          icon={UserGroupIcon}
                          className="size-3.5"
                        />
                        <span>{tr(language, "Participants", "ผู้เข้าร่วม")}</span>
                      </div>
                      <p className="text-sm font-medium">
                        {tr(language, `${sheetParticipants.length} people`, `${sheetParticipants.length} คน`)}
                      </p>
                    </div>
                    {meeting.room && (
                      <div className="col-span-2 rounded-xl bg-muted/35 px-3 py-2.5 text-sm text-foreground">
                        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          <HugeiconsIcon
                            icon={CallIcon}
                            className="size-3.5"
                          />
                          <span>{tr(language, "Room", "ห้อง")}</span>
                        </div>
                        <p className="truncate text-sm font-medium">{meeting.room}</p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-card p-3 shadow-[0_1px_2px_rgba(15,40,84,0.05)]">
                  <div className="mb-2.5 flex items-start gap-3">
                    <div className="rounded-xl bg-muted p-1.5 text-muted-foreground">
                      <HugeiconsIcon icon={NoteIcon} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-foreground">
                        {tr(language, "Notes from doctor", "บันทึกจากแพทย์")}
                      </h3>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {meeting.note
                          ? tr(language, "Clinical note attached to this appointment", "มีบันทึกคลินิกแนบกับนัดหมายนี้")
                          : tr(language, "No note has been added yet", "ยังไม่มีการเพิ่มบันทึก")}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-dashed border-border bg-muted/25 px-3 py-2.5 text-sm leading-5 text-foreground/80">
                    {meeting.note || tr(language, "No notes available for this appointment.", "ยังไม่มีบันทึกสำหรับนัดหมายนี้")}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
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
  const goToPreviousWeek = useCalendarStore((s) => s.goToPreviousWeek);
  const goToNextWeek = useCalendarStore((s) => s.goToNextWeek);

  const weekDays = getWeekDays();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = INITIAL_SCROLL_OFFSET;
    }
  }, []);

  return (
    <>
      {/* ── Scrollable calendar body ── */}
      {/* ── Scrollable Calendar Wrapper ── */}
      <div className="flex-1 flex flex-col overflow-hidden w-full relative">

        {/* ── 1) Week Header (Synced Scroll) ── */}
        <div
          ref={headerRef}
          className="flex border-b border-border bg-background w-full overflow-hidden shrink-0"
        >
          <div className="flex w-max min-w-full">
            {/* Corner (Sticky Left) */}
            <div className="w-[80px] md:w-[104px] flex items-center gap-1 md:gap-2 p-1.5 md:p-2 border-r border-border shrink-0 sticky left-0 z-50 bg-background">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 md:size-8"
                onClick={goToPreviousWeek}
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  className="size-4 md:size-5"
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 md:size-8"
                onClick={goToNextWeek}
              >
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="size-4 md:size-5"
                />
              </Button>
            </div>

            {/* Days Header */}
            {weekDays.map((day) => (
              <div
                key={day.toISOString()}
                className="flex-1 border-r border-border last:border-r-0 p-1.5 md:p-2 min-w-44 flex items-center bg-background"
              >
                <div
                  className={cn(
                    "text-xs md:text-sm font-medium",
                    isToday(day) ? "text-[var(--med-primary-light)]" : "text-foreground"
                  )}
                >
                  {day
                    .toLocaleDateString(localeOf(language), {
                      day: "2-digit",
                      weekday: "short",
                    })
                    .toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 2) Calendar Body (Main Scroll) ── */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto w-full"
          onScroll={(e) => {
            if (headerRef.current) {
              headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
        >
          <div className="flex min-w-full w-max">
            <HoursColumn />
            {weekDays.map((day, i) => {
              const setDayRef = (el: HTMLDivElement | null) => {
                dayRefs.current[i] = el;
              };
              return (
                <DayColumn
                  key={day.toISOString()}
                  date={day}
                  meetings={getMeetingsForDate(day)}
                  scrollRef={setDayRef}
                  onEventClick={setSelectedMeeting}
                  onSlotSelect={onSlotSelect}
                />
              );
            })}
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
