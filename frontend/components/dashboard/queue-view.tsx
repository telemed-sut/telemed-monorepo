"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { isToday, isTomorrow } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Clock01Icon,
  Stethoscope02Icon,
  DoorIcon,
  Cancel01Icon,
  Tick02Icon,
  AlertCircleIcon,
  Loading03Icon,
  Calendar01Icon,
  NoteIcon,
  Layers01Icon,
  ArrowTurnBackwardIcon,
  PencilEdit01Icon,
  Delete01Icon,
  CallIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/store/calendar-store";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { EventDetailSheet } from "./calendar-view";
import {
  updateMeeting,
  createMeeting,
  deleteMeeting,
  type Meeting,
  type MeetingStatus,
  type MeetingCreatePayload,
  MEETING_STATUS_LABELS,
  MEETING_STATUSES,
} from "@/lib/api";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import {
  getLivePresenceInfo,
  getPresenceAwareStatus,
  isDoctorLeftWhilePatientWaiting,
  isPatientWaitingLive,
} from "./meeting-presence";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

const MEETING_STATUS_LABELS_TH: Record<MeetingStatus, string> = {
  scheduled: "กำหนดการ",
  waiting: "เช็กอินแล้ว",
  in_progress: "กำลังตรวจ",
  overtime: "เกินเวลา",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
};

type QueueDisplayMode = "cards" | "list";
type QueueDensity = "compact" | "comfortable" | "spacious";
type QueueFocusFilter = "all" | "attention" | "waiting" | "upcoming";

const QUEUE_VIEW_STORAGE_KEY = "telemed.queue.display-mode";
const QUEUE_DENSITY_STORAGE_KEY = "telemed.queue.density";

/* ── Status visual helpers ── */
function getStatusConfig(status: MeetingStatus, language: AppLanguage) {
  switch (status) {
    case "waiting":
      return {
        dot: "bg-amber-500",
        bg: "bg-amber-500/10",
        text: "text-amber-600 dark:text-amber-400",
        border: "border-amber-500/30",
        label: tr(language, "Checked In", "เช็กอินแล้ว"),
        icon: Clock01Icon,
      };
    case "in_progress":
      return {
        dot: "bg-blue-500",
        bg: "bg-blue-500/10",
        text: "text-blue-600 dark:text-blue-400",
        border: "border-blue-500/30",
        label: tr(language, "In Progress", "กำลังตรวจ"),
        icon: Loading03Icon,
      };
    case "overtime":
      return {
        dot: "bg-red-500",
        bg: "bg-red-500/10",
        text: "text-red-600 dark:text-red-400",
        border: "border-red-500/30",
        label: tr(language, "Overtime", "เกินเวลา"),
        icon: AlertCircleIcon,
      };
    case "completed":
      return {
        dot: "bg-emerald-500",
        bg: "bg-emerald-500/10",
        text: "text-emerald-600 dark:text-emerald-400",
        border: "border-emerald-500/30",
        label: tr(language, "Completed", "เสร็จสิ้น"),
        icon: Tick02Icon,
      };
    case "cancelled":
      return {
        dot: "bg-gray-400",
        bg: "bg-gray-400/10",
        text: "text-gray-500",
        border: "border-gray-400/30",
        label: tr(language, "Cancelled", "ยกเลิก"),
        icon: Cancel01Icon,
      };
    case "scheduled":
    default:
      return {
        dot: "bg-cyan-500",
        bg: "bg-cyan-500/10",
        text: "text-cyan-600 dark:text-cyan-400",
        border: "border-cyan-500/30",
        label: tr(language, "Scheduled", "กำหนดการ"),
        icon: Calendar01Icon,
      };
  }
}

/** Valid next-status transitions */
const STATUS_TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  scheduled: ["waiting", "cancelled"],
  waiting: ["in_progress", "cancelled"],
  in_progress: ["completed", "overtime"],
  overtime: ["completed"],
  completed: [],
  cancelled: [],
};

/** Undo transitions — allows reverting from terminal states */
const UNDO_TRANSITIONS: Partial<Record<MeetingStatus, MeetingStatus>> = {
  completed: "in_progress",
  cancelled: "scheduled",
  overtime: "in_progress",
};

function formatTime12(dateTime: string): string {
  const d = new Date(dateTime);
  const hour = d.getHours();
  const minute = d.getMinutes();
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
}

function formatAppointmentDate(dateTime: string, language: AppLanguage): string {
  const value = new Date(dateTime);

  if (Number.isNaN(value.getTime())) {
    return "";
  }

  if (isToday(value)) {
    return tr(language, "Today", "วันนี้");
  }

  if (isTomorrow(value)) {
    return tr(language, "Tomorrow", "พรุ่งนี้");
  }

  return value.toLocaleDateString(localeOf(language), {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getInitial(name: string | null | undefined): string {
  return name?.charAt(0)?.toUpperCase() || "?";
}

/* ── Status Badge ── */
function StatusBadge({
  status,
  language,
}: {
  status: MeetingStatus;
  language: AppLanguage;
}) {
  const config = getStatusConfig(status, language);
  const isWaiting = status === "waiting";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full",
        config.text
      )}
      style={{
        backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
      }}
    >
      <span className="relative inline-flex size-1.5">
        {isWaiting && (
          <span className="absolute inset-0 rounded-full bg-amber-500 animate-ping opacity-60" />
        )}
        <span className={cn("relative size-1.5 rounded-full", config.dot)} />
      </span>
      {config.label}
    </span>
  );
}

/* ── Action Button ── */
function StatusActionButton({
  nextStatus,
  onClick,
  loading,
  language,
}: {
  nextStatus: MeetingStatus;
  onClick: () => void;
  loading: boolean;
  language: AppLanguage;
}) {
  const config = getStatusConfig(nextStatus, language);

  const labelMap: Record<string, string> = {
    waiting: tr(language, "Check In", "เช็กอิน"),
    in_progress: tr(language, "Start Visit", "เริ่มตรวจ"),
    completed: tr(language, "Complete", "เสร็จสิ้น"),
    overtime: tr(language, "Mark Overtime", "ทำเครื่องหมายเกินเวลา"),
    cancelled: tr(language, "Cancel", "ยกเลิก"),
  };

  const isCancelAction = nextStatus === "cancelled";

  return (
    <Button
      variant={isCancelAction ? "outline" : "default"}
      size="sm"
      className={cn(
        "h-7 text-xs gap-1.5",
        isCancelAction
          ? "text-red-500 border-red-500/30 hover:bg-red-500/10"
          : "text-white",
        !isCancelAction && nextStatus === "waiting" && "bg-amber-500 hover:bg-amber-600",
        !isCancelAction && nextStatus === "in_progress" && "bg-blue-500 hover:bg-blue-600",
        !isCancelAction && nextStatus === "completed" && "bg-emerald-500 hover:bg-emerald-600",
        !isCancelAction && nextStatus === "overtime" && "bg-red-500 hover:bg-red-600"
      )}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? (
        <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <>
          <HugeiconsIcon icon={config.icon} className="size-3.5" />
          {labelMap[nextStatus] ||
            (language === "th"
              ? MEETING_STATUS_LABELS_TH[nextStatus]
              : MEETING_STATUS_LABELS[nextStatus])}
        </>
      )}
    </Button>
  );
}

/* ── Queue Card ── */
function QueueCard({
  meeting,
  onStatusChange,
  onCancelClick,
  onDuplicate,
  onStartCall,
  onEdit,
  onDelete,
  onClick,
  loading,
  canWrite,
  canDelete,
  language,
  displayMode,
  density,
}: {
  meeting: Meeting;
  onStatusChange: (meeting: Meeting, newStatus: MeetingStatus) => void;
  onCancelClick: (meeting: Meeting) => void;
  onDuplicate: (meeting: Meeting) => void;
  onStartCall: (meeting: Meeting) => void;
  onEdit: (meeting: Meeting) => void;
  onDelete: (meeting: Meeting) => void;
  onClick: (meeting: Meeting) => void;
  loading: boolean;
  canWrite: boolean;
  canDelete: boolean;
  language: AppLanguage;
  displayMode: QueueDisplayMode;
  density: QueueDensity;
}) {
  const nextStatuses = STATUS_TRANSITIONS[meeting.status] || [];
  const undoTarget = UNDO_TRANSITIONS[meeting.status];
  const isTerminal =
    meeting.status === "completed" || meeting.status === "cancelled";
  const isWaitingLive = isPatientWaitingLive(meeting);
  const isDoctorLeftWaiting = isDoctorLeftWhilePatientWaiting(meeting);
  const statusForBadge = getPresenceAwareStatus(meeting);
  const livePresenceInfo = getLivePresenceInfo(meeting, language);
  const config = getStatusConfig(statusForBadge, language);
  const appointmentDateLabel = formatAppointmentDate(meeting.date_time, language);
  const appointmentTimeLabel = formatTime12(meeting.date_time);

  const patientName = meeting.patient
    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
    : tr(language, "Unknown Patient", "ไม่ทราบชื่อผู้ป่วย");
  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name || ""} ${meeting.doctor.last_name || ""}`.trim()
    : tr(language, "Unassigned", "ยังไม่ระบุ");
  const isListMode = displayMode === "list";
  const isCompact = density === "compact";
  const isSpacious = density === "spacious";

  return (
    <div
      className={cn(
        "group flex h-full flex-col rounded-2xl border border-border bg-card transition-all cursor-pointer",
        "hover:shadow-md hover:border-border/80",
        isCompact && "gap-2.5 p-3",
        density === "comfortable" && "gap-3 p-4",
        isSpacious && "gap-4 p-5",
        isListMode && "md:rounded-[1.35rem]",
        isTerminal && "opacity-60",
        isWaitingLive &&
          "border-amber-300/60 bg-gradient-to-br from-amber-50/70 to-card ring-1 ring-amber-300/40"
      )}
      onClick={() => onClick(meeting)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick(meeting);
      }}
    >
      <div
        className={cn(
          "flex flex-col",
          isCompact ? "gap-2.5" : "gap-3",
          isListMode && "md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] md:gap-x-5"
        )}
      >
        {/* Top row: patient + actions + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar
              className={cn(
                "shrink-0 border-2 border-background",
                isCompact && "size-8",
                density === "comfortable" && "size-9",
                isSpacious && "size-10"
              )}
            >
              <AvatarFallback
                className={cn(
                  "font-bold",
                  isCompact ? "text-xs" : "text-sm",
                  config.bg,
                  config.text
                )}
              >
                {getInitial(meeting.patient?.first_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h4
                className={cn(
                  "font-semibold text-foreground truncate",
                  isCompact ? "text-sm" : "text-[15px]",
                  meeting.status === "cancelled" && "line-through"
                )}
              >
                {patientName}
              </h4>
              <p className={cn("truncate text-muted-foreground", isCompact ? "text-xs" : "text-sm")}>
                {meeting.description || tr(language, "General consultation", "ปรึกษาทั่วไป")}
              </p>
              {livePresenceInfo && (
                <span
                  className={cn(
                    "mt-1 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
                    isCompact ? "text-[10px]" : "text-xs",
                    livePresenceInfo.tone === "waiting" &&
                      "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                    livePresenceInfo.tone === "active" &&
                      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                    livePresenceInfo.tone === "left" &&
                      "bg-slate-500/15 text-slate-700 dark:text-slate-300",
                    livePresenceInfo.tone === "offline" &&
                      "bg-slate-500/15 text-slate-700 dark:text-slate-300"
                  )}
                  title={livePresenceInfo.label}
                >
                  {livePresenceInfo.label}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canWrite && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(meeting);
                  }}
                  title={tr(language, "Edit", "แก้ไข")}
                >
                  <HugeiconsIcon icon={PencilEdit01Icon} className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(meeting);
                  }}
                  disabled={loading}
                  title={tr(language, "Duplicate", "ทำซ้ำ")}
                >
                  <HugeiconsIcon icon={Layers01Icon} className="size-3.5" />
                </Button>
              </>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(meeting);
                }}
                disabled={loading}
                title={tr(language, "Delete", "ลบ")}
              >
                <HugeiconsIcon icon={Delete01Icon} className="size-3.5" />
              </Button>
            )}
            <StatusBadge status={statusForBadge} language={language} />
          </div>
        </div>

        {/* Info row */}
        <div className={cn("flex flex-col text-muted-foreground", isCompact ? "gap-1 text-xs" : "gap-1.5 text-sm")}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground/85">
              <HugeiconsIcon icon={Calendar01Icon} className="size-3.5" />
              <span>{appointmentDateLabel}</span>
            </span>
            <span className="text-muted-foreground/50" aria-hidden="true">
              •
            </span>
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
              {appointmentTimeLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={Stethoscope02Icon} className="size-3.5" />
              {doctorName}
            </span>
            {meeting.room && (
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon icon={DoorIcon} className="size-3.5" />
                {meeting.room}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Cancel reason */}
      {meeting.status === "cancelled" && meeting.reason && (
        <div className={cn("flex items-start gap-2 rounded-lg bg-muted/50 text-muted-foreground", isCompact ? "px-2.5 py-2 text-xs" : "px-3 py-2 text-sm")}>
          <HugeiconsIcon icon={NoteIcon} className="size-3.5 mt-0.5 shrink-0" />
          <span>{meeting.reason}</span>
        </div>
      )}

      {isWaitingLive && (
        <div className={cn("rounded-lg border border-amber-500/30 bg-amber-500/10", isCompact ? "px-2.5 py-2" : "px-3 py-2")}>
          <div className={cn("flex items-start gap-2 text-amber-700 dark:text-amber-300", isCompact ? "text-xs" : "text-sm")}>
            <HugeiconsIcon icon={Clock01Icon} className="size-3.5 mt-0.5 shrink-0" />
            <span>
              {isDoctorLeftWaiting
                ? tr(
                    language,
                    "Doctor left room while patient is still waiting. Rejoin now.",
                    "หมอออกจากห้องแล้ว แต่คนไข้ยังรออยู่ สามารถกลับเข้าห้องได้ทันที"
                  )
                : tr(
                    language,
                    "Patient is already in the waiting room. You can start the call now.",
                    "คนไข้อยู่ในห้องรอแล้ว สามารถเริ่มคอลได้ทันที"
                  )}
            </span>
          </div>
          <Button
            size="sm"
            className={cn(
              "mt-2 gap-1.5 bg-amber-600 text-white hover:bg-amber-700",
              isCompact ? "h-7 text-xs" : "h-8 text-sm"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onStartCall(meeting);
            }}
            disabled={loading || isTerminal}
          >
            <HugeiconsIcon icon={CallIcon} className="size-3.5" />
            {tr(language, "Start call now", "เริ่มคอลตอนนี้")}
          </Button>
        </div>
      )}

      {livePresenceInfo?.tone === "offline" && !isWaitingLive && (
        <div className={cn("rounded-lg border border-slate-400/30 bg-slate-500/10", isCompact ? "px-2.5 py-2" : "px-3 py-2")}>
          <div className={cn("flex items-start gap-2 text-slate-700 dark:text-slate-300", isCompact ? "text-xs" : "text-sm")}>
            <HugeiconsIcon icon={AlertCircleIcon} className="size-3.5 mt-0.5 shrink-0" />
            <span>
              {tr(
                language,
                "Patient is currently offline. Ask patient to re-open the room link.",
                "ตอนนี้คนไข้ออฟไลน์ แนะนำให้คนไข้กดลิงก์เข้าห้องใหม่อีกครั้ง"
              )}
            </span>
          </div>
        </div>
      )}

      {livePresenceInfo?.tone === "left" && !isWaitingLive && (
        <div className={cn("rounded-lg border border-slate-400/30 bg-slate-500/10", isCompact ? "px-2.5 py-2" : "px-3 py-2")}>
          <div className={cn("flex items-start gap-2 text-slate-700 dark:text-slate-300", isCompact ? "text-xs" : "text-sm")}>
            <HugeiconsIcon icon={AlertCircleIcon} className="size-3.5 mt-0.5 shrink-0" />
            <span>
              {tr(
                language,
                "Patient left the room. If the visit should continue, ask patient to re-open the room link.",
                "คนไข้ออกจากห้องแล้ว หากต้องการตรวจต่อ ให้คนไข้กดลิงก์เข้าห้องใหม่อีกครั้ง"
              )}
            </span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div
        className={cn(
          "mt-auto flex flex-wrap items-center gap-2 border-t border-border/50 pt-1",
          isListMode && "md:justify-between"
        )}
        role="group"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {canWrite ? (
          <>
            {nextStatuses
              .filter((s) => s !== "cancelled")
              .map((nextStatus) => (
                <StatusActionButton
                  key={nextStatus}
                  nextStatus={nextStatus}
                  onClick={() => onStatusChange(meeting, nextStatus)}
                  loading={loading}
                  language={language}
                />
              ))}
            {nextStatuses.includes("cancelled") && (
              <StatusActionButton
                nextStatus="cancelled"
                onClick={() => onCancelClick(meeting)}
                loading={loading}
                language={language}
              />
            )}
            {undoTarget && (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-1.5 text-muted-foreground hover:text-foreground",
                  isCompact ? "h-7 text-xs" : "h-8 text-sm"
                )}
                onClick={() => onStatusChange(meeting, undoTarget)}
                disabled={loading}
              >
                <HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-3.5" />
                {tr(language, "Undo", "ย้อนกลับ")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className={cn("gap-1.5", isCompact ? "h-7 text-xs" : "h-8 text-sm")}
              onClick={() => onStartCall(meeting)}
              disabled={loading || isTerminal}
            >
              <HugeiconsIcon icon={CallIcon} className="size-3.5" />
              {tr(language, "Start Call", "เริ่มคอล")}
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{tr(language, "Read only", "ดูได้อย่างเดียว")}</span>
        )}
      </div>
    </div>
  );
}

/* ── Status Summary Cards ── */
function StatusSummary({
  meetings,
  activeFilter,
  onFilterChange,
  language,
}: {
  meetings: Meeting[];
  activeFilter: MeetingStatus | "all";
  onFilterChange: (filter: MeetingStatus | "all") => void;
  language: AppLanguage;
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: meetings.filter((meeting) => getPresenceAwareStatus(meeting) !== "cancelled").length,
    };
    for (const s of MEETING_STATUSES) c[s] = 0;
    meetings.forEach((m) => {
      const effectiveStatus = getPresenceAwareStatus(m);
      c[effectiveStatus] = (c[effectiveStatus] || 0) + 1;
    });
    return c;
  }, [meetings]);

  const items: { key: MeetingStatus | "all"; label: string; count: number }[] = [
    { key: "all", label: tr(language, "All", "ทั้งหมด"), count: counts.all },
    { key: "scheduled", label: tr(language, "Scheduled", "กำหนดการ"), count: counts.scheduled || 0 },
    { key: "waiting", label: tr(language, "Checked In", "เช็กอินแล้ว"), count: counts.waiting || 0 },
    { key: "in_progress", label: tr(language, "In Progress", "กำลังตรวจ"), count: counts.in_progress || 0 },
    { key: "overtime", label: tr(language, "Overtime", "เกินเวลา"), count: counts.overtime || 0 },
    { key: "completed", label: tr(language, "Completed", "เสร็จสิ้น"), count: counts.completed || 0 },
    { key: "cancelled", label: tr(language, "Cancelled", "ยกเลิก"), count: counts.cancelled || 0 },
  ];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      {items.map((item) => {
        const active = activeFilter === item.key;
        const config =
          item.key === "all" ? null : getStatusConfig(item.key as MeetingStatus, language);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onFilterChange(item.key)}
            aria-pressed={active}
            title={`${item.label}: ${item.count}`}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap",
              "border",
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-card text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {config && (
              <span
                className={cn("size-2 rounded-full", config.dot)}
              />
            )}
            {item.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0 text-xs font-bold",
                active
                  ? "bg-background/20 text-background"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {item.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Queue View
   ══════════════════════════════════════════════════════════ */
export function QueueView({
  onRefresh,
  onEditMeeting,
  onGoToCalendar,
}: {
  onRefresh: () => Promise<void>;
  onEditMeeting: (meeting: Meeting) => void;
  onGoToCalendar: (meeting: Meeting) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const currentUserId = useAuthStore((s) => s.userId);
  const language = useLanguageStore((s) => s.language);
  const meetings = useCalendarStore((s) => s.meetings);
  const setMeetings = useCalendarStore((s) => s.setMeetings);

  const [statusFilter, setStatusFilter] = useState<MeetingStatus | "all">("all");
  const [dateFilter, setDateFilter] = useState<"today" | "all">("today");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [displayMode, setDisplayMode] = useState<QueueDisplayMode>("cards");
  const [density, setDensity] = useState<QueueDensity>("comfortable");
  const [focusFilter, setFocusFilter] = useState<QueueFocusFilter>("all");
  const isAdmin = role === "admin";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedDisplayMode = window.localStorage.getItem(QUEUE_VIEW_STORAGE_KEY);
    const storedDensity = window.localStorage.getItem(QUEUE_DENSITY_STORAGE_KEY);

    if (storedDisplayMode === "cards" || storedDisplayMode === "list") {
      setDisplayMode(storedDisplayMode);
    }

    if (
      storedDensity === "compact" ||
      storedDensity === "comfortable" ||
      storedDensity === "spacious"
    ) {
      setDensity(storedDensity);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_VIEW_STORAGE_KEY, displayMode);
  }, [displayMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_DENSITY_STORAGE_KEY, density);
  }, [density]);

  const canWriteMeeting = useCallback(
    (meeting: Meeting) => {
      if (isAdmin) return true;
      return role === "doctor" && Boolean(currentUserId) && meeting.doctor_id === currentUserId;
    },
    [isAdmin, role, currentUserId]
  );

  const canDeleteMeeting = isAdmin;

  const isUpcomingMeeting = useCallback(
    (meeting: Meeting) => {
      const meetingTime = new Date(meeting.date_time).getTime();
      if (Number.isNaN(meetingTime)) return false;

      const now = Date.now();
      const diff = meetingTime - now;
      const effectiveStatus = getPresenceAwareStatus(meeting);

      return diff >= 0 && diff <= 1000 * 60 * 60 && effectiveStatus === "scheduled";
    },
    []
  );

  // Filter meetings
  const filteredMeetings = useMemo(() => {
    let filtered = [...meetings];

    // Date filter
    if (dateFilter === "today") {
      filtered = filtered.filter((m) =>
        isToday(new Date(m.date_time))
      );
    }

    if (focusFilter !== "all") {
      filtered = filtered.filter((meeting) => {
        const effectiveStatus = getPresenceAwareStatus(meeting);

        if (focusFilter === "waiting") {
          return isPatientWaitingLive(meeting);
        }

        if (focusFilter === "upcoming") {
          return isUpcomingMeeting(meeting);
        }

        return (
          isPatientWaitingLive(meeting) ||
          effectiveStatus === "in_progress" ||
          effectiveStatus === "overtime"
        );
      });
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((m) => {
        const effectiveStatus = getPresenceAwareStatus(m);
        return effectiveStatus === statusFilter;
      });
    } else {
      filtered = filtered.filter((meeting) => getPresenceAwareStatus(meeting) !== "cancelled");
    }

    // Sort: active statuses first, then by time
    const statusOrder: Record<MeetingStatus, number> = {
      in_progress: 1,
      overtime: 2,
      scheduled: 3,
      completed: 4,
      cancelled: 5,
      waiting: 6,
    };

    filtered.sort((a, b) => {
      const waitingA = isPatientWaitingLive(a) ? -1 : 0;
      const waitingB = isPatientWaitingLive(b) ? -1 : 0;
      if (waitingA !== waitingB) return waitingA - waitingB;
      const oa = statusOrder[getPresenceAwareStatus(a)] ?? 3;
      const ob = statusOrder[getPresenceAwareStatus(b)] ?? 3;
      if (oa !== ob) return oa - ob;
      return new Date(a.date_time).getTime() - new Date(b.date_time).getTime();
    });

    return filtered;
  }, [meetings, statusFilter, dateFilter, focusFilter, isUpcomingMeeting]);

  // Date-filtered meetings for summary counts
  const dateScopedMeetings = useMemo(() => {
    if (dateFilter === "today") {
      return meetings.filter((m) => isToday(new Date(m.date_time)));
    }
    return meetings;
  }, [meetings, dateFilter]);

  const handleStatusFilterChange = useCallback(
    (nextFilter: MeetingStatus | "all") => {
      const resolvedFilter = statusFilter === nextFilter ? "all" : nextFilter;
      setStatusFilter(resolvedFilter);

      if (resolvedFilter === "all" || dateFilter !== "today") {
        return;
      }

      const todayCount = dateScopedMeetings.filter(
        (meeting) => {
          const effectiveStatus = getPresenceAwareStatus(meeting);
          return effectiveStatus === resolvedFilter;
        }
      ).length;

      if (todayCount > 0) {
        return;
      }

      const allDatesCount = meetings.filter(
        (meeting) => {
          const effectiveStatus = getPresenceAwareStatus(meeting);
          return effectiveStatus === resolvedFilter;
        }
      ).length;

      if (allDatesCount > 0) {
        setDateFilter("all");
        const statusLabel =
          language === "th"
            ? MEETING_STATUS_LABELS_TH[resolvedFilter]
            : MEETING_STATUS_LABELS[resolvedFilter];
        toast.info(tr(language, `Switched to All Dates for ${statusLabel}`, `สลับเป็นทุกช่วงวันสำหรับสถานะ ${statusLabel}`), {
          description: tr(
            language,
            `No ${statusLabel.toLowerCase()} meetings today, but found ${allDatesCount} in all dates.`,
            `ไม่พบสถานะ ${statusLabel} ในวันนี้ แต่พบทั้งหมด ${allDatesCount} รายการในทุกช่วงวัน`
          ),
          duration: 5000,
        });
        return;
      }

      const statusLabel =
        language === "th"
          ? MEETING_STATUS_LABELS_TH[resolvedFilter]
          : MEETING_STATUS_LABELS[resolvedFilter];
      toast.info(tr(language, `No ${statusLabel.toLowerCase()} meetings`, `ไม่พบนัดหมายสถานะ ${statusLabel}`), {
        description: tr(language, "Try another status or create a new meeting.", "ลองเลือกสถานะอื่นหรือสร้างนัดหมายใหม่"),
        duration: 4000,
      });
    },
    [statusFilter, dateFilter, dateScopedMeetings, meetings, language]
  );

  const handleStatusChange = useCallback(
    async (meeting: Meeting, newStatus: MeetingStatus) => {
      if (!token || updatingId) return;
      if (!canWriteMeeting(meeting)) {
        toast.error(tr(language, "This meeting is read-only for your account", "บัญชีของคุณดูได้อย่างเดียวสำหรับนัดหมายนี้"));
        return;
      }
      setUpdatingId(meeting.id);
      try {
        const updated = await updateMeeting(
          meeting.id,
          { status: newStatus },
          token
        );
        setMeetings(
          meetings.map((m) => (m.id === meeting.id ? updated : m))
        );
        const statusLabel =
          language === "th"
            ? MEETING_STATUS_LABELS_TH[newStatus]
            : MEETING_STATUS_LABELS[newStatus];
        toast.success(tr(language, `Status updated to ${statusLabel}`, `อัปเดตสถานะเป็น ${statusLabel}`));
      } catch {
        toast.error(tr(language, "Failed to update status", "อัปเดตสถานะไม่สำเร็จ"));
      } finally {
        setUpdatingId(null);
      }
    },
    [token, updatingId, meetings, setMeetings, canWriteMeeting, language]
  );

  const handleDuplicate = useCallback(
    async (meeting: Meeting) => {
      if (!token || duplicatingId) return;
      if (!canWriteMeeting(meeting)) {
        toast.error(tr(language, "This meeting is read-only for your account", "บัญชีของคุณดูได้อย่างเดียวสำหรับนัดหมายนี้"));
        return;
      }

      const doctorId = meeting.doctor_id || meeting.doctor?.id || "";
      const patientId = meeting.user_id || meeting.patient?.id || "";
      if (!doctorId || !patientId) {
        toast.error(tr(language, "Cannot duplicate: missing doctor or patient information", "ทำซ้ำไม่ได้: ข้อมูลแพทย์หรือผู้ป่วยไม่ครบ"));
        return;
      }

      setDuplicatingId(meeting.id);
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
        toast.success(tr(language, "Meeting duplicated", "ทำซ้ำนัดหมายแล้ว"));
        await onRefresh();
      } catch {
        toast.error(tr(language, "Failed to duplicate meeting", "ทำซ้ำนัดหมายไม่สำเร็จ"));
      } finally {
        setDuplicatingId(null);
      }
    },
    [token, duplicatingId, setMeetings, onRefresh, canWriteMeeting, language]
  );

  const handleCancel = useCallback(
    async (meeting: Meeting) => {
      if (!token || updatingId) return;
      if (!canWriteMeeting(meeting)) {
        toast.error(tr(language, "This meeting is read-only for your account", "บัญชีของคุณดูได้อย่างเดียวสำหรับนัดหมายนี้"));
        return;
      }
      setUpdatingId(meeting.id);
      try {
        const updated = await updateMeeting(
          meeting.id,
          { status: "cancelled", reason: tr(language, "Cancelled by admin", "ยกเลิกโดยผู้ดูแลระบบ") },
          token
        );
        setMeetings(
          meetings.map((m) => (m.id === meeting.id ? updated : m))
        );
        toast.success(
          tr(
            language,
            "Appointment cancelled. It is now in the Cancelled tab.",
            "ยกเลิกนัดหมายแล้ว รายการนี้อยู่ในแท็บ ยกเลิก"
          )
        );
      } catch {
        toast.error(tr(language, "Failed to cancel appointment", "ยกเลิกนัดหมายไม่สำเร็จ"));
      } finally {
        setUpdatingId(null);
      }
    },
    [token, updatingId, meetings, setMeetings, canWriteMeeting, language]
  );

  const requestCancel = useCallback(
    (meeting: Meeting) => {
      const patientName = meeting.patient
        ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
        : tr(language, "this patient", "ผู้ป่วยรายนี้");
      toast.warningAction(tr(language, "Cancel appointment?", "ยกเลิกนัดหมายใช่ไหม?"), {
        description: tr(language, `Cancel appointment for ${patientName}?`, `ยกเลิกนัดหมายของ ${patientName} ใช่หรือไม่?`),
        button: {
          title: tr(language, "Cancel Appointment", "ยืนยันยกเลิกนัดหมาย"),
          onClick: () => {
            void handleCancel(meeting);
          },
        },
        duration: 9000,
      });
    },
    [handleCancel, language]
  );

  const handleDelete = useCallback(
    async (meeting: Meeting) => {
      if (!token || deleting) return;
      if (!canDeleteMeeting) {
        toast.error(tr(language, "Only admin can delete meetings", "เฉพาะผู้ดูแลระบบเท่านั้นที่ลบนัดหมายได้"));
        return;
      }
      setDeleting(true);
      try {
        await deleteMeeting(meeting.id, token);
        setMeetings(meetings.filter((m) => m.id !== meeting.id));
        toast.success(tr(language, "Appointment deleted", "ลบนัดหมายแล้ว"));
      } catch {
        toast.error(tr(language, "Failed to delete appointment", "ลบนัดหมายไม่สำเร็จ"));
      } finally {
        setDeleting(false);
      }
    },
    [token, deleting, meetings, setMeetings, canDeleteMeeting, language]
  );

  const handleStartCall = useCallback(
    (meeting: Meeting) => {
      if (role !== "doctor") {
        toast.error(tr(language, "Only doctor accounts can start calls", "เฉพาะบัญชีแพทย์เท่านั้นที่เริ่มคอลได้"));
        return;
      }
      if (!canWriteMeeting(meeting)) {
        toast.error(tr(language, "This meeting is read-only for your account", "บัญชีของคุณดูได้อย่างเดียวสำหรับนัดหมายนี้"));
        return;
      }
      const callParams = new URLSearchParams();
      const pn = [meeting.patient?.first_name, meeting.patient?.last_name].filter(Boolean).join(" ");
      if (pn) callParams.set("pn", pn);
      if (meeting.date_time) callParams.set("pt", meeting.date_time);
      const qs = callParams.toString();
      window.location.assign(`/meetings/call/${meeting.id}${qs ? `?${qs}` : ""}`);
    },
    [role, language, canWriteMeeting]
  );

  const requestDelete = useCallback(
    (meeting: Meeting) => {
      const patientName = meeting.patient
        ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
        : tr(language, "this patient", "ผู้ป่วยรายนี้");
      toast.destructiveAction(tr(language, "Delete appointment?", "ลบนัดหมายใช่ไหม?"), {
        description: tr(
          language,
          `Delete appointment for ${patientName}? This action cannot be undone.`,
          `ลบนัดหมายของ ${patientName} ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้`
        ),
        button: {
          title: tr(language, "Delete", "ลบ"),
          onClick: () => {
            void handleDelete(meeting);
          },
        },
        duration: 9000,
      });
    },
    [handleDelete, language]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Queue Controls */}
      <div className="px-4 md:px-6 py-3 border-b border-border space-y-3">
        <div className="rounded-2xl border border-border/80 bg-muted/20 p-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {tr(language, "Range", "ช่วงเวลา")}
              </span>
              <div className="inline-flex items-center rounded-full border border-border bg-background p-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 rounded-full px-3 text-sm",
                    dateFilter === "today" && "bg-foreground text-background hover:bg-foreground/90"
                  )}
                  onClick={() => setDateFilter("today")}
                >
                  {tr(language, "Today", "วันนี้")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 rounded-full px-3 text-sm",
                    dateFilter === "all" && "bg-foreground text-background hover:bg-foreground/90"
                  )}
                  onClick={() => setDateFilter("all")}
                >
                  {tr(language, "All Dates", "ทุกช่วงวัน")}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {tr(language, "Focus", "โฟกัส")}
              </span>
              <div className="inline-flex items-center rounded-full border border-border bg-background p-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 rounded-full px-3 text-sm",
                    focusFilter === "all" && "bg-background shadow-sm ring-1 ring-primary/25 text-foreground"
                  )}
                  onClick={() => setFocusFilter("all")}
                >
                  {tr(language, "All work", "ทั้งหมด")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 rounded-full px-3 text-sm",
                    focusFilter === "attention" && "bg-background shadow-sm ring-1 ring-primary/25 text-foreground"
                  )}
                  onClick={() => setFocusFilter("attention")}
                >
                  {tr(language, "Needs attention", "ต้องทำตอนนี้")}
                </Button>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center justify-center gap-2 rounded-full border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <HugeiconsIcon icon={Settings01Icon} className="size-3.5 text-muted-foreground" />
                <span>{tr(language, "View options", "ปรับมุมมอง")}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{tr(language, "Layout", "รูปแบบแสดงผล")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={displayMode}
                  onValueChange={(value) => setDisplayMode(value as QueueDisplayMode)}
                >
                  <DropdownMenuRadioItem value="cards">
                    {tr(language, "Cards", "การ์ด")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="list">
                    {tr(language, "List", "รายการ")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{tr(language, "Card density", "ขนาดการ์ด")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={density}
                  onValueChange={(value) => setDensity(value as QueueDensity)}
                >
                  <DropdownMenuRadioItem value="compact">
                    {tr(language, "Compact", "กะทัดรัด")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="comfortable">
                    {tr(language, "Comfortable", "มาตรฐาน")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="spacious">
                    {tr(language, "Spacious", "โปร่ง")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{tr(language, "Quick focus", "โฟกัสงานด่วน")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={focusFilter}
                  onValueChange={(value) => setFocusFilter(value as QueueFocusFilter)}
                >
                  <DropdownMenuRadioItem value="all">
                    {tr(language, "All work", "ทั้งหมด")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="attention">
                    {tr(language, "Needs attention", "ต้องทำตอนนี้")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="waiting">
                    {tr(language, "Patient waiting", "คนไข้รออยู่")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="upcoming">
                    {tr(language, "Due soon", "ใกล้ถึงเวลา")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="ml-auto text-sm text-muted-foreground">
              {tr(
                language,
                `${filteredMeetings.length} meeting${filteredMeetings.length !== 1 ? "s" : ""}`,
                `${filteredMeetings.length} นัดหมาย`
              )}
            </span>
          </div>
        </div>

        {/* Status filter pills */}
        <StatusSummary
          meetings={dateScopedMeetings}
          activeFilter={statusFilter}
          onFilterChange={handleStatusFilterChange}
          language={language}
        />
        <p className="text-sm text-muted-foreground">
          {tr(
            language,
            "Tip: start with Needs attention, then refine with status filters if needed.",
            "เคล็ดลับ: เริ่มจาก ต้องทำตอนนี้ ก่อน แล้วค่อยกรองต่อด้วยสถานะเมื่อจำเป็น"
          )}
        </p>
      </div>

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {filteredMeetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <HugeiconsIcon icon={Calendar01Icon} className="size-12 opacity-30" />
            <p className="text-sm">{tr(language, "No meetings found", "ไม่พบนัดหมาย")}</p>
            <p className="text-sm">
              {dateFilter === "today"
                ? tr(language, "No meetings scheduled for today. Try switching to 'All Dates'.", "ไม่มีนัดหมายสำหรับวันนี้ ลองสลับเป็น 'ทุกช่วงวัน'")
                : tr(language, "No meetings match the current filter.", "ไม่มีนัดหมายตรงกับตัวกรองปัจจุบัน")}
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "grid",
              displayMode === "list" && "grid-cols-1 gap-3.5",
              displayMode === "cards" && density === "compact" && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3",
              displayMode === "cards" && density === "comfortable" && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3",
              displayMode === "cards" && density === "spacious" && "grid-cols-1 xl:grid-cols-2 gap-4"
            )}
          >
            {filteredMeetings.map((meeting) => (
              <QueueCard
                key={meeting.id}
                meeting={meeting}
                onStatusChange={handleStatusChange}
                onCancelClick={requestCancel}
                onDuplicate={handleDuplicate}
                onStartCall={handleStartCall}
                onEdit={onEditMeeting}
                onDelete={requestDelete}
                onClick={setSelectedMeeting}
                loading={updatingId === meeting.id || duplicatingId === meeting.id}
                canWrite={canWriteMeeting(meeting)}
                canDelete={canDeleteMeeting}
                language={language}
                displayMode={displayMode}
                density={density}
              />
            ))}
          </div>
        )}
      </div>

      {/* Event Detail Sheet (reused from calendar) */}
      <EventDetailSheet
        meeting={selectedMeeting}
        open={!!selectedMeeting}
        onOpenChange={(open) => {
          if (!open) setSelectedMeeting(null);
        }}
        onEdit={(meeting) => {
          setSelectedMeeting(null);
          onEditMeeting(meeting);
        }}
        onGoToCalendar={(meeting) => {
          setSelectedMeeting(null);
          onGoToCalendar(meeting);
        }}
        onRefresh={onRefresh}
      />
    </div>
  );
}
