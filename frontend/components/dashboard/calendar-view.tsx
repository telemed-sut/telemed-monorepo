"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { isToday, format, addMinutes } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PencilEdit01Icon,
  FileEditIcon,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { deleteMeeting, createMeeting } from "@/lib/api";
import type { MeetingCreatePayload } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";

/* ── Helpers ── */

export interface CalendarSlotSelection {
  date: Date;
  startHour: number;
  startMinute: number;
}

function formatTime12(dateTime: string): string {
  const d = new Date(dateTime);
  const hour = d.getHours();
  const minute = d.getMinutes();
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
}

function getTimeRange(dateTime: string, durationMin: number = 60) {
  const start = new Date(dateTime);
  const end = addMinutes(start, durationMin);
  return `${formatTime12(dateTime)} - ${formatTime12(end.toISOString())}`;
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
  return (
    <div
      className="w-[80px] md:w-[104px] shrink-0 relative sticky left-0 z-30 bg-background border-r border-border"
    >
      {HOURS_24.map((hour, i) => (
        <div
          key={i}
          className="relative"
          style={{ height: HOUR_HEIGHT }}
        >
          <span className="absolute -top-[0.6em] left-2 md:left-3 text-xs md:text-sm text-muted-foreground bg-background px-0.5 leading-none">
            {i > 0 ? hour : ""}
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
  const [top, setTop] = useState(getCurrentTimePosition());

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
  const top = getEventTop(meeting.date_time) + 4;
  const duration = getMeetingDuration(meeting);
  const height = Math.max((duration / 60) * HOUR_HEIGHT - 8, 28);
  const isVeryShort = height < 36;
  const isMedium = height >= 36 && height < 80;

  const title =
    meeting.description ||
    (meeting.patient
      ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
      : "Appointment");
  const timeStr = getTimeRange(meeting.date_time, duration);
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
      <div
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
          {formatTime12(meeting.date_time)}
        </span>
      </div>
    );
  }

  // Medium event – title + time
  if (isMedium) {
    return (
      <div
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
      </div>
    );
  }

  // Full event card
  return (
    <div
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
              {MEETING_STATUS_LABELS[meeting.status] || "Scheduled"}
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
                    <AvatarFallback className="text-[8px] font-bold bg-[#7ac2f0]/15 text-[#7ac2f0]">
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
    </div>
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
        today && "bg-[#7ac2f0]/[0.03]"
      )}
    >
      <div
        className={cn("relative", onSlotSelect && "cursor-cell")}
        style={{ height: columnHeight }}
        onClick={handleSlotClick}
      >
        {HOURS_24.map((_, i) => (
          <div
            key={i}
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
  const setMeetings = useCalendarStore((s) => s.setMeetings);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  if (!meeting) return null;

  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name || ""} ${meeting.doctor.last_name || ""}`.trim()
    : "Unassigned Doctor";
  const patientName = meeting.patient
    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
    : "Unassigned Patient";
  const meetingDate = new Date(meeting.date_time);
  const dateStr = format(meetingDate, "EEEE, MMMM dd");
  const startTimeStr = formatTime12(meeting.date_time);
  const endTimeStr = formatTime12(addMinutes(meetingDate, 60).toISOString());
  const title = meeting.description || "Appointment";
  const roomTarget = normalizeRoomTarget(meeting.room);
  const canOpenRoom = Boolean(roomTarget);
  const statusColor = getStatusColor(meeting.status);

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
    setDeleting(true);
    try {
      await deleteMeeting(meeting.id, token);
      const current = useCalendarStore.getState().meetings;
      setMeetings(current.filter((m) => m.id !== meeting.id));
      toast.success("Appointment deleted");
      setDeleteDialogOpen(false);
      onOpenChange(false);
      await onRefresh?.();
    } catch (err) {
      console.error("Failed to delete appointment:", err);
      toast.error("Failed to delete appointment");
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(meeting);
      onOpenChange(false);
    }
  };

  const handleCopy = () => {
    const lines: string[] = [
      `📅 ${title}`,
      `Date: ${dateStr}`,
      `Time: ${startTimeStr} - ${endTimeStr} (ICT)`,
      `Doctor: ${doctorName}`,
      `Patient: ${patientName}`,
    ];
    if (meeting.room) lines.push(`Room: ${meeting.room}`);
    if (meeting.note) lines.push(`Note: ${meeting.note}`);
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Appointment details copied to clipboard");
  };

  const handleDuplicate = async () => {
    if (!token || duplicating) return;

    const doctorId = meeting.doctor_id || meeting.doctor?.id || "";
    const patientId = meeting.user_id || meeting.patient?.id || "";
    if (!doctorId || !patientId) {
      toast.error("Cannot duplicate: missing doctor or patient information");
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
      toast.success("Appointment duplicated");
      onOpenChange(false);
      await onRefresh?.();
    } catch (err) {
      console.error("Failed to duplicate appointment:", err);
      toast.error("Failed to duplicate appointment");
    } finally {
      setDuplicating(false);
    }
  };

  const handleOpenRoom = () => {
    if (!roomTarget) {
      toast.error("This room does not have a valid meeting link");
      return;
    }

    if (roomTarget.startsWith("/")) {
      window.location.assign(roomTarget);
      return;
    }

    window.open(roomTarget, "_blank", "noopener,noreferrer");
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 hover:bg-muted"
                    onClick={handleEdit}
                    title="Edit appointment"
                  >
                    <HugeiconsIcon
                      icon={PencilEdit01Icon}
                      className="size-4 text-muted-foreground"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 hover:bg-muted"
                    onClick={handleCopy}
                    title="Copy appointment details"
                  >
                    <HugeiconsIcon
                      icon={Copy01Icon}
                      className="size-4 text-muted-foreground"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 hover:bg-muted"
                    onClick={handleDuplicate}
                    disabled={duplicating}
                    title="Duplicate appointment"
                  >
                    <HugeiconsIcon
                      icon={Layers01Icon}
                      className="size-4 text-muted-foreground"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 hover:bg-muted"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={deleting}
                    title="Delete appointment"
                  >
                    <HugeiconsIcon
                      icon={Delete01Icon}
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
                    {MEETING_STATUS_LABELS[meeting.status] || "Scheduled"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                  <span>{dateStr}</span>
                  <span className="size-1 rounded-full bg-muted-foreground" />
                  <span>
                    {startTimeStr} - {endTimeStr}
                  </span>
                  <span className="size-1 rounded-full bg-muted-foreground" />
                  <span>ICT</span>
                </div>
              </div>

              {/* Propose new time */}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1">
                  <span>Propose new time</span>
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
                    <span>View in Calendar</span>
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
                                  Organizer
                                </span>
                              )}
                              {participant.isYou && (
                                <span className="text-[10px] font-medium text-foreground px-0.5 py-0.5 rounded-full">
                                  You
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
                      <div className="size-6 shrink-0 rounded bg-[#7ac2f0]/10 flex items-center justify-center">
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
                            fill="#7ac2f0"
                            opacity="0.3"
                          />
                          <path
                            d="M8 12h8M12 8v8"
                            stroke="#7ac2f0"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </div>
                      <p className="text-xs font-medium text-muted-foreground flex-1">
                        Room Assignment
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
                            ? `Go to ${meeting.room}`
                            : "Meeting link unavailable"}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 text-xs border-border"
                        onClick={() => {
                          navigator.clipboard.writeText(meeting.room || "");
                          toast.success("Room copied");
                        }}
                      >
                        <HugeiconsIcon
                          icon={LinkSquare01Icon}
                          className="size-4"
                        />
                        <span>Copy</span>
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
                    <span>Reminder: 30min before</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="p-1">
                      <HugeiconsIcon
                        icon={Calendar01Icon}
                        className="size-4"
                      />
                    </div>
                    <span>
                      Doctor: {meeting.doctor?.email || doctorName}
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
                      <span>Room: {meeting.room}</span>
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
                      {sheetParticipants.length} persons
                      <span className="mx-1">•</span>
                      {yesCount} yes
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="p-1">
                      <HugeiconsIcon icon={NoteIcon} className="size-4" />
                    </div>
                    <span>Notes from Doctor</span>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Appointment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this appointment? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
            {weekDays.map((day, i) => (
              <div
                key={i}
                className="flex-1 border-r border-border last:border-r-0 p-1.5 md:p-2 min-w-44 flex items-center bg-background"
              >
                <div
                  className={cn(
                    "text-xs md:text-sm font-medium",
                    isToday(day) ? "text-[#7ac2f0]" : "text-foreground"
                  )}
                >
                  {format(day, "dd EEE").toUpperCase()}
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
                  key={i}
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
