"use client";

import { useRef, useEffect, useState } from "react";
import { isToday, addMinutes } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PencilEdit01Icon,
  Layers01Icon,
  Delete01Icon,
  Cancel01Icon,
  ArrowUpRight01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Tick02Icon,
  Notification01Icon,
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
import { toast } from "@/components/ui/toast";
import { createMeetingPatientInvite, deleteMeeting, createMeeting } from "@/lib/api";
import type { MeetingCreatePayload } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";

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
          <span className="absolute -top-[0.6em] left-2 md:left-3 text-xs md:text-sm text-muted-foreground bg-background px-0.5 leading-none">
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
  const timeStr = getTimeRange(meeting.date_time, language, duration);
  const statusColor = getStatusColor(meeting.status);

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
        className={cn("absolute left-2 right-2 bg-card border border-border border-l-2 rounded-lg px-2 py-1 z-10 flex items-center gap-1.5 cursor-pointer hover:bg-muted transition-colors", statusColor.border)}
        style={{ top, height }}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <div className={cn("size-1.5 rounded-full shrink-0", statusColor.dot)} />
        <h4 className="text-[10px] font-semibold text-foreground truncate flex-1">
          {title}
        </h4>
        <span className="text-[9px] text-muted-foreground shrink-0">
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
        className={cn("absolute left-2 right-2 bg-card border border-border border-l-2 rounded-lg px-2.5 py-2 z-10 cursor-pointer hover:bg-muted transition-colors", statusColor.border)}
        style={{ top, height }}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <div className="flex flex-col gap-1 h-full">
          <div className="flex items-center gap-1.5">
            <div className={cn("size-1.5 rounded-full shrink-0", statusColor.dot)} />
            <h4 className="text-[10px] font-semibold text-foreground truncate flex-1">
              {title}
            </h4>
          </div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">
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
      className={cn("absolute left-2 right-2 bg-card border border-border border-l-2 rounded-lg p-3 z-10 cursor-pointer hover:bg-muted transition-colors", statusColor.border, meeting.status === "cancelled" && "opacity-60")}
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
            <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0", statusColor.text, "bg-current/10")}
              style={{ backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)" }}
            >
              {getMeetingStatusLabel(meeting.status, language)}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
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
                    <AvatarFallback className="text-[8px] font-bold bg-[var(--med-primary-light)]/15 text-[var(--med-primary-light)]">
                      {getInitial(p.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              {participants.length > 3 && (
                <span className="text-[10px] text-muted-foreground">
                  +{participants.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {meeting.room && (
          <div className="flex items-center gap-1.5 text-[10px] text-cyan-500 mt-auto">
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
  const dateStr = meetingDate.toLocaleDateString(localeOf(language), {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const startTimeStr = formatTime12(meeting.date_time, language);
  const endTimeStr = formatTime12(addMinutes(meetingDate, 60).toISOString(), language);
  const title = meeting.description || tr(language, "Appointment", "นัดหมาย");
  const roomTarget = normalizeRoomTarget(meeting.room);
  const canOpenRoom = Boolean(roomTarget);
  const statusColor = getStatusColor(meeting.status);
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

  const yesCount = sheetParticipants.length;

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
      const invite = await createMeetingPatientInvite(meeting.id, token);
      await navigator.clipboard.writeText(invite.invite_url);
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
          className="w-full sm:max-w-[560px] overflow-y-auto p-0 border-l border-r border-t [&>button]:hidden"
        >
          <div className="flex flex-col h-full">
            {/* ── Sheet Header ── */}
            <SheetHeader className="px-4 pt-4 pb-4 border-b border-border">
              {/* Top action row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 hover:bg-muted"
                      onClick={handleEdit}
                      title={tr(language, "Edit appointment", "แก้ไขนัดหมาย")}
                    >
                      <HugeiconsIcon
                        icon={PencilEdit01Icon}
                        className="size-4 text-muted-foreground"
                      />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 hover:bg-muted"
                    onClick={handleCopy}
                    title={tr(language, "Copy appointment details", "คัดลอกรายละเอียดนัดหมาย")}
                  >
                    <HugeiconsIcon
                      icon={Copy01Icon}
                      className="size-4 text-muted-foreground"
                    />
                  </Button>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 hover:bg-muted"
                      onClick={handleDuplicate}
                      disabled={duplicating}
                      title={tr(language, "Duplicate appointment", "ทำซ้ำนัดหมาย")}
                    >
                      <HugeiconsIcon
                        icon={Layers01Icon}
                        className="size-4 text-muted-foreground"
                      />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 hover:bg-muted"
                      onClick={handleDeleteAction}
                      disabled={deleting}
                      title={tr(language, "Delete appointment", "ลบนัดหมาย")}
                    >
                      <HugeiconsIcon
                        icon={Delete01Icon}
                        className="size-4 text-muted-foreground"
                      />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 hover:bg-muted"
                    onClick={handleStartCall}
                    disabled={!canStartCall}
                    title={tr(language, "Start video call", "เริ่มวิดีโอคอล")}
                  >
                    <HugeiconsIcon
                      icon={CallIcon}
                      className="size-4 text-muted-foreground"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 hover:bg-muted"
                    onClick={() => {
                      void handleCopyPatientJoinLink();
                    }}
                    disabled={!canWrite || copyingPatientLink}
                    title={tr(language, "Copy patient join link", "คัดลอกลิงก์เข้าห้องของคนไข้")}
                  >
                    <HugeiconsIcon
                      icon={LinkSquare01Icon}
                      className="size-4 text-muted-foreground"
                    />
                  </Button>
                </div>
                <SheetClose
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-full bg-muted hover:bg-muted"
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        className="size-4 text-muted-foreground"
                      />
                    </Button>
                  }
                />
              </div>

              {/* Title & time */}
              <div className="flex flex-col gap-1 mb-4">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-xl font-semibold text-foreground leading-normal">
                    {title}
                  </SheetTitle>
                  <span
                    className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", statusColor.text)}
                    style={{ backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)" }}
                  >
                    {getMeetingStatusLabel(meeting.status, language)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                  <span>{dateStr}</span>
                  <span className="size-1 rounded-full bg-muted-foreground" />
                  <span>
                    {startTimeStr} - {endTimeStr}
                  </span>
                  <span className="size-1 rounded-full bg-muted-foreground" />
                  <span>{tr(language, "ICT", "เวลา ICT")}</span>
                </div>
                {meeting.status === "waiting" && (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <HugeiconsIcon icon={Clock01Icon} className="size-3.5 shrink-0" />
                    <span>
                      {tr(
                        language,
                        "Patient is waiting in room now. Start call when ready.",
                        "คนไข้รออยู่ในห้องแล้ว กดเริ่มคอลได้เลย"
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Propose new time */}
              <div className="flex flex-wrap gap-2">
                <Button
                  className="flex-1"
                  onClick={handleStartCall}
                  disabled={!canStartCall}
                >
                  <HugeiconsIcon icon={CallIcon} className="size-4" />
                  <span>{tr(language, "Start Call", "เริ่มคอล")}</span>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
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
                <Button variant="outline" className="flex-1" disabled={!canWrite}>
                  <span>{tr(language, "Propose new time", "เสนอเวลาใหม่")}</span>
                  <HugeiconsIcon
                    icon={ArrowUpRight01Icon}
                    className="size-4"
                  />
                </Button>
                {onGoToCalendar && (
                  <Button
                    variant="outline"
                    className="gap-2"
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
            </SheetHeader>

            {/* ── Sheet Body ── */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="flex flex-col gap-4 max-w-[512px] mx-auto">
                {/* Participants */}
                <div className="flex flex-col gap-4">
                  {sheetParticipants.map((participant) => (
                    <div
                      key={participant.id}
                      className="flex items-start gap-3 relative"
                    >
                      <Avatar className="size-7 border-[1.4px] border-background shrink-0">
                        <AvatarFallback
                          className={cn(
                            "text-[10px] font-bold",
                            participant.isOrganizer
                              ? "bg-cyan-500/20 text-cyan-500"
                              : "bg-emerald-500/20 text-emerald-500"
                          )}
                        >
                          {getInitial(participant.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2 relative">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1 relative">
                              <p className="text-[13px] font-medium text-foreground leading-[18px]">
                                {participant.name}
                              </p>
                              {participant.isOrganizer && (
                                <span className="text-[10px] font-medium text-cyan-500 px-0.5 py-0.5 rounded-full">
                                  {tr(language, "Organizer", "ผู้จัด")}
                                </span>
                              )}
                              {participant.isYou && (
                                <span className="text-[10px] font-medium text-foreground px-0.5 py-0.5 rounded-full">
                                  {tr(language, "You", "คุณ")}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground leading-none">
                              {participant.email ||
                                `${participant.name.toLowerCase().replace(/[^a-z]/g, "")}@hospital.com`}
                            </p>
                          </div>
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            className="size-3 text-green-500 shrink-0 absolute right-0 top-[17px]"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Room section */}
                {meeting.room && (
                  <div className="flex flex-col gap-2 pt-4 border-t border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="size-6 shrink-0 rounded bg-[var(--med-primary-light)]/10 flex items-center justify-center">
                        <svg
                          className="size-3.5"
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
                      <p className="text-xs font-medium text-muted-foreground flex-1">
                        {tr(language, "Room Assignment", "ห้องที่มอบหมาย")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {meeting.room}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 h-8 bg-foreground text-background hover:bg-foreground/90 text-xs font-medium gap-2 shadow-sm disabled:opacity-60"
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
                        size="sm"
                        className="h-8 gap-2 text-xs border-border"
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

                {/* Info rows */}
                <div className="flex flex-col gap-2 pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="p-1">
                      <HugeiconsIcon
                        icon={Notification01Icon}
                        className="size-4"
                      />
                    </div>
                    <span>{tr(language, "Reminder: 30min before", "แจ้งเตือน: ก่อนเวลา 30 นาที")}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="p-1">
                      <HugeiconsIcon
                        icon={Calendar01Icon}
                        className="size-4"
                      />
                    </div>
                    <span>
                      {tr(language, "Doctor", "แพทย์")}: {meeting.doctor?.email || doctorName}
                    </span>
                  </div>
                  {meeting.room && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="p-1">
                        <HugeiconsIcon
                          icon={CallIcon}
                          className="size-4"
                        />
                      </div>
                      <span>{tr(language, "Room", "ห้อง")}: {meeting.room}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="p-1">
                      <HugeiconsIcon
                        icon={UserGroupIcon}
                        className="size-4"
                      />
                    </div>
                    <span>
                      {sheetParticipants.length} {tr(language, "persons", "คน")}
                      <span className="mx-1">•</span>
                      {yesCount} {tr(language, "yes", "ตอบรับ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="p-1">
                      <HugeiconsIcon icon={NoteIcon} className="size-4" />
                    </div>
                    <span>{tr(language, "Notes from Doctor", "บันทึกจากแพทย์")}</span>
                  </div>
                </div>

                {/* Notes */}
                {meeting.note && (
                  <div className="pt-4 border-t border-border">
                    <p className="text-xs text-muted-foreground leading-[1.6]">
                      {meeting.note}
                    </p>
                  </div>
                )}
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
