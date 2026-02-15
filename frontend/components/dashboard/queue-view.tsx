"use client";

import { useState, useCallback, useMemo } from "react";
import { format, isToday, isBefore, startOfDay } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Clock01Icon,
  UserIcon,
  Stethoscope02Icon,
  DoorIcon,
  Cancel01Icon,
  Tick02Icon,
  ArrowRight01Icon,
  MoreHorizontalIcon,
  AlertCircleIcon,
  Loading03Icon,
  Calendar01Icon,
  NoteIcon,
  Layers01Icon,
  ArrowTurnBackwardIcon,
  PencilEdit01Icon,
  Delete01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/store/calendar-store";
import { useAuthStore } from "@/store/auth-store";
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

/* ── Status visual helpers ── */
function getStatusConfig(status: MeetingStatus) {
  switch (status) {
    case "waiting":
      return {
        dot: "bg-amber-500",
        bg: "bg-amber-500/10",
        text: "text-amber-600 dark:text-amber-400",
        border: "border-amber-500/30",
        label: "Waiting",
        icon: Clock01Icon,
      };
    case "in_progress":
      return {
        dot: "bg-blue-500",
        bg: "bg-blue-500/10",
        text: "text-blue-600 dark:text-blue-400",
        border: "border-blue-500/30",
        label: "In Progress",
        icon: Loading03Icon,
      };
    case "overtime":
      return {
        dot: "bg-red-500",
        bg: "bg-red-500/10",
        text: "text-red-600 dark:text-red-400",
        border: "border-red-500/30",
        label: "Overtime",
        icon: AlertCircleIcon,
      };
    case "completed":
      return {
        dot: "bg-emerald-500",
        bg: "bg-emerald-500/10",
        text: "text-emerald-600 dark:text-emerald-400",
        border: "border-emerald-500/30",
        label: "Completed",
        icon: Tick02Icon,
      };
    case "cancelled":
      return {
        dot: "bg-gray-400",
        bg: "bg-gray-400/10",
        text: "text-gray-500",
        border: "border-gray-400/30",
        label: "Cancelled",
        icon: Cancel01Icon,
      };
    case "scheduled":
    default:
      return {
        dot: "bg-cyan-500",
        bg: "bg-cyan-500/10",
        text: "text-cyan-600 dark:text-cyan-400",
        border: "border-cyan-500/30",
        label: "Scheduled",
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

function getInitial(name: string | null | undefined): string {
  return name?.charAt(0)?.toUpperCase() || "?";
}

/* ── Status Badge ── */
function StatusBadge({ status }: { status: MeetingStatus }) {
  const config = getStatusConfig(status);
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
      <span className={cn("size-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}

/* ── Action Button ── */
function StatusActionButton({
  nextStatus,
  onClick,
  loading,
}: {
  nextStatus: MeetingStatus;
  onClick: () => void;
  loading: boolean;
}) {
  const config = getStatusConfig(nextStatus);

  const labelMap: Record<string, string> = {
    waiting: "Check In",
    in_progress: "Start Visit",
    completed: "Complete",
    overtime: "Mark Overtime",
    cancelled: "Cancel",
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
          {labelMap[nextStatus] || MEETING_STATUS_LABELS[nextStatus]}
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
  onEdit,
  onDelete,
  onClick,
  loading,
}: {
  meeting: Meeting;
  onStatusChange: (meeting: Meeting, newStatus: MeetingStatus) => void;
  onCancelClick: (meeting: Meeting) => void;
  onDuplicate: (meeting: Meeting) => void;
  onEdit: (meeting: Meeting) => void;
  onDelete: (meeting: Meeting) => void;
  onClick: (meeting: Meeting) => void;
  loading: boolean;
}) {
  const config = getStatusConfig(meeting.status);
  const nextStatuses = STATUS_TRANSITIONS[meeting.status] || [];
  const undoTarget = UNDO_TRANSITIONS[meeting.status];
  const isTerminal =
    meeting.status === "completed" || meeting.status === "cancelled";

  const patientName = meeting.patient
    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
    : "Unknown Patient";
  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name || ""} ${meeting.doctor.last_name || ""}`.trim()
    : "Unassigned";

  return (
    <div
      className={cn(
        "group flex flex-col gap-3 p-4 rounded-xl border border-border bg-card transition-all cursor-pointer h-full",
        "hover:shadow-md hover:border-border/80",
        isTerminal && "opacity-60"
      )}
      onClick={() => onClick(meeting)}
    >
      {/* Top row: patient + actions + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Avatar className="size-9 shrink-0 border-2 border-background">
            <AvatarFallback
              className={cn(
                "text-sm font-bold",
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
                "text-sm font-semibold text-foreground truncate",
                meeting.status === "cancelled" && "line-through"
              )}
            >
              {patientName}
            </h4>
            <p className="text-xs text-muted-foreground truncate">
              {meeting.description || "General consultation"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Edit */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onEdit(meeting); }}
            title="Edit"
          >
            <HugeiconsIcon icon={PencilEdit01Icon} className="size-3.5" />
          </Button>
          {/* Duplicate */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onDuplicate(meeting); }}
            disabled={loading}
            title="Duplicate"
          >
            <HugeiconsIcon icon={Layers01Icon} className="size-3.5" />
          </Button>
          {/* Delete */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onDelete(meeting); }}
            disabled={loading}
            title="Delete"
          >
            <HugeiconsIcon icon={Delete01Icon} className="size-3.5" />
          </Button>
          <StatusBadge status={meeting.status} />
        </div>
      </div>

      {/* Info row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
          {formatTime12(meeting.date_time)}
        </span>
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

      {/* Cancel reason */}
      {meeting.status === "cancelled" && meeting.reason && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          <HugeiconsIcon icon={NoteIcon} className="size-3.5 mt-0.5 shrink-0" />
          <span>{meeting.reason}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1 mt-auto border-t border-border/50" onClick={(e) => e.stopPropagation()}>
        {/* Forward transitions */}
        {nextStatuses
          .filter((s) => s !== "cancelled")
          .map((nextStatus) => (
            <StatusActionButton
              key={nextStatus}
              nextStatus={nextStatus}
              onClick={() => onStatusChange(meeting, nextStatus)}
              loading={loading}
            />
          ))}
        {nextStatuses.includes("cancelled") && (
          <StatusActionButton
            nextStatus="cancelled"
            onClick={() => onCancelClick(meeting)}
            loading={loading}
          />
        )}

        {/* Undo button for terminal/overtime states */}
        {undoTarget && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onStatusChange(meeting, undoTarget)}
            disabled={loading}
          >
            <HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-3.5" />
            Undo
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Cancel Dialog ── */
function CancelMeetingDialog({
  meeting,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  meeting: Meeting | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");

  const patientName = meeting?.patient
    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
    : "this patient";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Appointment</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel the appointment for{" "}
            <strong>{patientName}</strong>? This action will be recorded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            Reason for cancellation
          </label>
          <Textarea
            placeholder="e.g. Patient requested reschedule, No show, etc."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-[80px]"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setReason("")}>
            Go Back
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm(reason);
              setReason("");
            }}
            disabled={loading || !reason.trim()}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {loading ? "Cancelling..." : "Cancel Appointment"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── Status Summary Cards ── */
function StatusSummary({
  meetings,
  activeFilter,
  onFilterChange,
}: {
  meetings: Meeting[];
  activeFilter: MeetingStatus | "all";
  onFilterChange: (filter: MeetingStatus | "all") => void;
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: meetings.length };
    for (const s of MEETING_STATUSES) c[s] = 0;
    meetings.forEach((m) => {
      c[m.status] = (c[m.status] || 0) + 1;
    });
    return c;
  }, [meetings]);

  const items: { key: MeetingStatus | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "scheduled", label: "Scheduled", count: counts.scheduled || 0 },
    { key: "waiting", label: "Waiting", count: counts.waiting || 0 },
    { key: "in_progress", label: "In Progress", count: counts.in_progress || 0 },
    { key: "overtime", label: "Overtime", count: counts.overtime || 0 },
    { key: "completed", label: "Completed", count: counts.completed || 0 },
    { key: "cancelled", label: "Cancelled", count: counts.cancelled || 0 },
  ];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      {items.map((item) => {
        const active = activeFilter === item.key;
        const config =
          item.key === "all" ? null : getStatusConfig(item.key as MeetingStatus);
        return (
          <button
            key={item.key}
            onClick={() => onFilterChange(item.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
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
                "text-[10px] font-bold px-1.5 py-0 rounded-full",
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
  const meetings = useCalendarStore((s) => s.meetings);
  const setMeetings = useCalendarStore((s) => s.setMeetings);

  const [statusFilter, setStatusFilter] = useState<MeetingStatus | "all">("all");
  const [dateFilter, setDateFilter] = useState<"today" | "all">("today");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Meeting | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Meeting | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filter meetings
  const filteredMeetings = useMemo(() => {
    let filtered = [...meetings];

    // Date filter
    if (dateFilter === "today") {
      filtered = filtered.filter((m) =>
        isToday(new Date(m.date_time))
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((m) => m.status === statusFilter);
    }

    // Sort: active statuses first, then by time
    const statusOrder: Record<MeetingStatus, number> = {
      overtime: 0,
      in_progress: 1,
      waiting: 2,
      scheduled: 3,
      completed: 4,
      cancelled: 5,
    };

    filtered.sort((a, b) => {
      const oa = statusOrder[a.status] ?? 3;
      const ob = statusOrder[b.status] ?? 3;
      if (oa !== ob) return oa - ob;
      return new Date(a.date_time).getTime() - new Date(b.date_time).getTime();
    });

    return filtered;
  }, [meetings, statusFilter, dateFilter]);

  // Date-filtered meetings for summary counts
  const dateScopedMeetings = useMemo(() => {
    if (dateFilter === "today") {
      return meetings.filter((m) => isToday(new Date(m.date_time)));
    }
    return meetings;
  }, [meetings, dateFilter]);

  const handleStatusChange = useCallback(
    async (meeting: Meeting, newStatus: MeetingStatus) => {
      if (!token || updatingId) return;
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
        toast.success(
          `Status updated to ${MEETING_STATUS_LABELS[newStatus]}`
        );
      } catch {
        toast.error("Failed to update status");
      } finally {
        setUpdatingId(null);
      }
    },
    [token, updatingId, meetings, setMeetings]
  );

  const handleDuplicate = useCallback(
    async (meeting: Meeting) => {
      if (!token || duplicatingId) return;

      const doctorId = meeting.doctor_id || meeting.doctor?.id || "";
      const patientId = meeting.user_id || meeting.patient?.id || "";
      if (!doctorId || !patientId) {
        toast.error("Cannot duplicate: missing doctor or patient information");
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
        toast.success("Meeting duplicated");
        await onRefresh();
      } catch (err) {
        console.error("Failed to duplicate meeting:", err);
        toast.error("Failed to duplicate meeting");
      } finally {
        setDuplicatingId(null);
      }
    },
    [token, duplicatingId, setMeetings, onRefresh]
  );

  const handleCancel = useCallback(
    async (reason: string) => {
      if (!token || !cancelTarget || updatingId) return;
      setUpdatingId(cancelTarget.id);
      try {
        const updated = await updateMeeting(
          cancelTarget.id,
          { status: "cancelled", reason },
          token
        );
        setMeetings(
          meetings.map((m) => (m.id === cancelTarget.id ? updated : m))
        );
        toast.success("Appointment cancelled");
        setCancelTarget(null);
      } catch {
        toast.error("Failed to cancel appointment");
      } finally {
        setUpdatingId(null);
      }
    },
    [token, cancelTarget, updatingId, meetings, setMeetings]
  );

  const handleDelete = useCallback(
    async () => {
      if (!token || !deleteTarget || deleting) return;
      setDeleting(true);
      try {
        await deleteMeeting(deleteTarget.id, token);
        setMeetings(meetings.filter((m) => m.id !== deleteTarget.id));
        toast.success("Appointment deleted");
        setDeleteTarget(null);
      } catch {
        toast.error("Failed to delete appointment");
      } finally {
        setDeleting(false);
      }
    },
    [token, deleteTarget, deleting, meetings, setMeetings]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Queue Controls */}
      <div className="px-4 md:px-6 py-3 border-b border-border space-y-3">
        {/* Date scope + sort */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant={dateFilter === "today" ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 text-xs",
                dateFilter === "today" &&
                  "bg-foreground text-background hover:bg-foreground/90"
              )}
              onClick={() => setDateFilter("today")}
            >
              Today
            </Button>
            <Button
              variant={dateFilter === "all" ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 text-xs",
                dateFilter === "all" &&
                  "bg-foreground text-background hover:bg-foreground/90"
              )}
              onClick={() => setDateFilter("all")}
            >
              All Dates
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredMeetings.length} meeting{filteredMeetings.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Status filter pills */}
        <StatusSummary
          meetings={dateScopedMeetings}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
        />
      </div>

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {filteredMeetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <HugeiconsIcon icon={Calendar01Icon} className="size-12 opacity-30" />
            <p className="text-sm">No meetings found</p>
            <p className="text-xs">
              {dateFilter === "today"
                ? "No meetings scheduled for today. Try switching to 'All Dates'."
                : "No meetings match the current filter."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredMeetings.map((meeting) => (
              <QueueCard
                key={meeting.id}
                meeting={meeting}
                onStatusChange={handleStatusChange}
                onCancelClick={setCancelTarget}
                onDuplicate={handleDuplicate}
                onEdit={onEditMeeting}
                onDelete={setDeleteTarget}
                onClick={setSelectedMeeting}
                loading={updatingId === meeting.id || duplicatingId === meeting.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cancel Dialog */}
      <CancelMeetingDialog
        meeting={cancelTarget}
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        onConfirm={handleCancel}
        loading={!!updatingId}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Appointment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this appointment
              {deleteTarget?.patient
                ? ` for ${deleteTarget.patient.first_name} ${deleteTarget.patient.last_name}`
                : ""}
              ? This action cannot be undone.
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
