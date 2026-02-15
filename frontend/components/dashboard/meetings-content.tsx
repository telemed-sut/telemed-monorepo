"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format, addWeeks, setHours, setMinutes } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Settings01Icon,
  Add01Icon,
  Calendar01Icon,
  FilterIcon,
  Clock01Icon,
  UserIcon,
  Stethoscope02Icon,
  DoorIcon,
  Note01Icon,
  Notification01Icon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { CalendarView, type CalendarSlotSelection } from "./calendar-view";
import { QueueView } from "./queue-view";
import { useCalendarStore } from "@/store/calendar-store";
import { useAuthStore } from "@/store/auth-store";
import {
  fetchMeetings,
  createMeeting,
  updateMeeting,
  fetchPatients,
  fetchUsers,
  fetchCurrentUser,
  type Meeting,
  type Patient,
  type User,
  type MeetingCreatePayload,
  type MeetingUpdatePayload,
} from "@/lib/api";
import { getMeetingLinkMode, resolveMeetingRoomValue } from "./meeting-link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ── Time picker helpers ── */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

function padTime(n: number) {
  return n.toString().padStart(2, "0");
}

function formatHour12(h: number) {
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr} ${ampm}`;
}

// ══════════════════════════════════════════════════════════
// Schedule Popover (Square UI schedule-popover.tsx)
// ══════════════════════════════════════════════════════════
function SchedulePopover({
  children,
  onSchedule,
}: {
  children: React.ReactNode;
  onSchedule?: (date: Date, startTime: string, endTime: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const handleSchedule = () => {
    if (!date || !startTime || !endTime) return;
    onSchedule?.(date, startTime, endTime);
    setOpen(false);
    setDate(new Date());
    setStartTime("");
    setEndTime("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={children as React.ReactElement} />
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-3">Schedule Meeting</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Quick schedule a meeting or event
            </p>
          </div>

          <div className="space-y-3">
            {/* Date */}
            <div className="grid gap-2">
              <Label className="text-xs">Date</Label>
              <Popover
                open={datePickerOpen}
                onOpenChange={setDatePickerOpen}
              >
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal h-9",
                        !date && "text-muted-foreground"
                      )}
                    >
                      <HugeiconsIcon
                        icon={Calendar01Icon}
                        className="mr-2 size-4"
                      />
                      {date ? (
                        format(date, "PPP")
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(selectedDate) => {
                      setDate(selectedDate);
                      setDatePickerOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Start / End time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-xs">Start</Label>
                <div className="relative">
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
                  />
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="pl-8 h-9 text-xs"
                    placeholder="09:00"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">End</Label>
                <div className="relative">
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
                  />
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="pl-8 h-9 text-xs"
                    placeholder="10:00"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Add participants / video call */}
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 justify-start gap-2 text-xs"
              >
                <HugeiconsIcon icon={UserGroupIcon} className="size-3.5" />
                <span>Add participants</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 justify-start gap-2 text-xs"
              >
                <HugeiconsIcon icon={Calendar01Icon} className="size-3.5" />
                <span>Add video call</span>
              </Button>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 h-8 text-xs"
                onClick={handleSchedule}
                disabled={!date || !startTime || !endTime}
              >
                Schedule
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ══════════════════════════════════════════════════════════
// Create Event Dialog (full form with all required fields)
// ══════════════════════════════════════════════════════════
function CreateEventDialog({
  open,
  onOpenChange,
  patients,
  doctors,
  currentUserId,
  initialSlot,
  editMeeting,
  onCreated,
  token,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patients: Patient[];
  doctors: User[];
  currentUserId: string | null;
  initialSlot?: CalendarSlotSelection | null;
  editMeeting?: Meeting | null;
  onCreated: (meeting?: Meeting) => void | Promise<void>;
  token: string;
}) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [startHour, setStartHour] = useState(9);
  const [startMinute, setStartMinute] = useState(0);
  const [endHour, setEndHour] = useState(10);
  const [endMinute, setEndMinute] = useState(0);
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState(currentUserId || "");
  const [description, setDescription] = useState("");
  const [room, setRoom] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const meetingLinkMode = getMeetingLinkMode();

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (editMeeting) {
        // Pre-fill from existing meeting
        const editDate = new Date(editMeeting.date_time);
        setSelectedDate(editDate);
        setStartHour(editDate.getHours());
        setStartMinute(editDate.getMinutes());
        const editEndHour = editDate.getHours() + 1;
        setEndHour(editEndHour > 23 ? 23 : editEndHour);
        setEndMinute(editDate.getMinutes());
        setPatientId(editMeeting.user_id || "");
        setDoctorId(editMeeting.doctor_id || currentUserId || "");
        setDescription(editMeeting.description || "");
        setRoom(editMeeting.room || "");
        setNote(editMeeting.note || "");
      } else {
        const presetDate = initialSlot?.date
          ? new Date(initialSlot.date)
          : new Date();
        const presetStartHour = initialSlot?.startHour ?? 9;
        const presetStartMinute = initialSlot?.startMinute ?? 0;

        setSelectedDate(presetDate);
        setStartHour(presetStartHour);
        setStartMinute(presetStartMinute);
        setEndHour(10);
        setEndMinute(0);
        setPatientId("");
        setDoctorId(currentUserId || (doctors.length > 0 ? doctors[0].id : ""));
        setDescription("");
        setRoom("");
        setNote("");
      }
    }
  }, [open, currentUserId, doctors, initialSlot, editMeeting]);

  // Auto-bump end time when start changes
  useEffect(() => {
    const endTotal = endHour * 60 + endMinute;
    const startTotal = startHour * 60 + startMinute;
    if (endTotal <= startTotal) {
      const newEnd = startTotal + 60;
      setEndHour(Math.min(Math.floor(newEnd / 60), 23));
      setEndMinute(newEnd % 60);
    }
  }, [startHour, startMinute]);

  const dateTimeISO = useMemo(() => {
    const dt = setMinutes(setHours(selectedDate, startHour), startMinute);
    return dt.toISOString();
  }, [selectedDate, startHour, startMinute]);

  const canSubmit = patientId && doctorId && selectedDate;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      if (editMeeting) {
        // Update existing meeting
        const payload: MeetingUpdatePayload = {
          date_time: dateTimeISO,
          description: description || undefined,
          doctor_id: doctorId,
          note: note || undefined,
          room: resolveMeetingRoomValue(room),
          user_id: patientId,
        };
        const updatedMeeting = await updateMeeting(editMeeting.id, payload, token);
        toast.success("Appointment updated successfully");
        onOpenChange(false);
        await onCreated(updatedMeeting);
      } else {
        // Create new meeting
        const payload: MeetingCreatePayload = {
          date_time: dateTimeISO,
          description: description || undefined,
          doctor_id: doctorId,
          note: note || undefined,
          room: resolveMeetingRoomValue(room),
          user_id: patientId,
        };
        const createdMeeting = await createMeeting(payload, token);
        toast.success("Appointment scheduled successfully");
        onOpenChange(false);
        await onCreated(createdMeeting);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create appointment";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-base">{editMeeting ? "Edit Appointment" : "Create Event"}</DialogTitle>
          <DialogDescription>
            {editMeeting ? "Update the appointment details below" : "Book a new consultation or follow-up"}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-2 space-y-5">
          {/* ── Date Picker ── */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Date
            </Label>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger className="inline-flex items-center w-full gap-3 rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm hover:bg-accent/50 transition-colors">
                <HugeiconsIcon
                  icon={Calendar01Icon}
                  className="size-4 text-[#7ac2f0]"
                />
                <span className="font-medium">
                  {format(selectedDate, "EEEE, MMMM do, yyyy")}
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (date) {
                      setSelectedDate(date);
                      setDatePickerOpen(false);
                    }
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* ── Time Pickers ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Start Time
              </Label>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3.5 py-2 text-sm">
                <HugeiconsIcon
                  icon={Clock01Icon}
                  className="size-4 text-[#7ac2f0] shrink-0"
                />
                <select
                  value={startHour}
                  onChange={(e) => setStartHour(parseInt(e.target.value))}
                  className="bg-transparent font-medium outline-none appearance-none cursor-pointer flex-1"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {formatHour12(h)}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">:</span>
                <select
                  value={startMinute}
                  onChange={(e) => setStartMinute(parseInt(e.target.value))}
                  className="bg-transparent font-medium outline-none appearance-none cursor-pointer w-12"
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {padTime(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                End Time
              </Label>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3.5 py-2 text-sm">
                <HugeiconsIcon
                  icon={Clock01Icon}
                  className="size-4 text-muted-foreground shrink-0"
                />
                <select
                  value={endHour}
                  onChange={(e) => setEndHour(parseInt(e.target.value))}
                  className="bg-transparent font-medium outline-none appearance-none cursor-pointer flex-1"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {formatHour12(h)}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">:</span>
                <select
                  value={endMinute}
                  onChange={(e) => setEndMinute(parseInt(e.target.value))}
                  className="bg-transparent font-medium outline-none appearance-none cursor-pointer w-12"
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {padTime(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Doctor & Patient ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Doctor <span className="text-red-400">*</span>
              </Label>
              <Select
                value={doctorId}
                onValueChange={(v) => setDoctorId(v ?? "")}
              >
                <SelectTrigger className="h-10">
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon
                      icon={Stethoscope02Icon}
                      className="size-4 text-[#7ac2f0]"
                    />
                    <SelectValue>
                      {doctorId
                        ? (() => {
                          const d = doctors.find((u) => u.id === doctorId);
                          return d
                            ? `Dr. ${d.first_name || ""} ${d.last_name || ""}`.trim()
                            : "Select";
                        })()
                        : "Select doctor"}
                    </SelectValue>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      Dr. {u.first_name || ""} {u.last_name || ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Patient <span className="text-red-400">*</span>
              </Label>
              <Select
                value={patientId}
                onValueChange={(v) => setPatientId(v ?? "")}
              >
                <SelectTrigger className="h-10">
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon
                      icon={UserIcon}
                      className="size-4 text-emerald-500"
                    />
                    <SelectValue>
                      {patientId
                        ? (() => {
                          const p = patients.find(
                            (pt) => pt.id === patientId
                          );
                          return p
                            ? `${p.first_name} ${p.last_name}`
                            : "Select";
                        })()
                        : "Select patient"}
                    </SelectValue>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Description & Room ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Description
              </Label>
              <Input
                placeholder="Follow-up consultation"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Room / Meeting Link
              </Label>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3.5 py-2 text-sm">
                <HugeiconsIcon
                  icon={DoorIcon}
                  className="size-4 text-amber-500 shrink-0"
                />
                <input
                  placeholder="https://meet.example.com/room or Room 101"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {meetingLinkMode === "off"
                  ? "Auto-generate link: disabled (set NEXT_PUBLIC_MEETING_LINK_MODE to enable)"
                  : `Auto-generate link: ${meetingLinkMode} mode when left blank`}
              </p>
            </div>
          </div>

          {/* ── Notes ── */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Notes
            </Label>
            <Textarea
              placeholder="Additional notes or instructions..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-6 py-4 mt-2 border-t bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="bg-[#7ac2f0] text-white hover:bg-[#5aade0] gap-2 px-5"
          >
            {submitting ? (
              <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
            )}
            {editMeeting ? "Update" : "Schedule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════
// Main Meetings Content
// ══════════════════════════════════════════════════════════
export function MeetingsContent() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const userRole = useAuthStore((state) => state.role);
  const clearToken = useAuthStore((state) => state.clearToken);

  const currentWeekStart = useCalendarStore((s) => s.currentWeekStart);
  const goToToday = useCalendarStore((s) => s.goToToday);
  const goToDate = useCalendarStore((s) => s.goToDate);
  const searchQuery = useCalendarStore((s) => s.searchQuery);
  const setSearchQuery = useCalendarStore((s) => s.setSearchQuery);
  const eventTypeFilter = useCalendarStore((s) => s.eventTypeFilter);
  const setEventTypeFilter = useCalendarStore((s) => s.setEventTypeFilter);
  const setMeetings = useCalendarStore((s) => s.setMeetings);
  const meetings = useCalendarStore((s) => s.meetings);

  const [viewMode, setViewMode] = useState<"calendar" | "queue">("calendar");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [createInitialSlot, setCreateInitialSlot] =
    useState<CalendarSlotSelection | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<User[]>([]);

  const weekEnd = addWeeks(currentWeekStart, 1);
  const weekStart = format(currentWeekStart, "MMM dd");
  const weekEndLabel = format(
    new Date(weekEnd.getTime() - 86400000),
    "MMM dd yyyy"
  );

  const todayMeetingsCount = meetings.filter(
    (m) => new Date(m.date_time).toDateString() === new Date().toDateString()
  ).length;
  const totalEventsCount = meetings.length;

  const hasActiveFilters = eventTypeFilter !== "all";

  const loadMeetings = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetchMeetings({ page: 1, limit: 1000 }, token);
      setMeetings(res.items);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        clearToken();
        router.replace("/login");
      }
    } finally {
      setLoading(false);
    }
  }, [token, setMeetings, clearToken, router]);

  const handleMeetingCreated = useCallback(
    async (meeting?: Meeting) => {
      if (meeting?.date_time) {
        goToDate(new Date(meeting.date_time));
      }

      if (searchQuery) {
        setSearchQuery("");
      }
      if (eventTypeFilter !== "all") {
        setEventTypeFilter("all");
      }

      await loadMeetings();
    },
    [
      goToDate,
      searchQuery,
      setSearchQuery,
      eventTypeFilter,
      setEventTypeFilter,
      loadMeetings,
    ]
  );

  const handleSlotSelect = useCallback((slot: CalendarSlotSelection) => {
    setCreateInitialSlot(slot);
    setCreateOpen(true);
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // Load patients & doctors for form
  useEffect(() => {
    if (!token) return;
    fetchPatients({ page: 1, limit: 100 }, token)
      .then((res) => setPatients(res.items))
      .catch(() => { });
    // Doctors can't access /users endpoint; use /auth/me for their own info
    if (userRole === "doctor") {
      fetchCurrentUser(token)
        .then((me) => setDoctors([{ id: me.id, email: me.email, first_name: me.first_name, last_name: me.last_name, role: me.role, is_active: true }]))
        .catch(() => { });
    } else {
      fetchUsers({ page: 1, limit: 100 }, token)
        .then((res) => setDoctors(res.items))
        .catch(() => { });
    }
  }, [token, userRole]);

  return (
    <main className="w-full flex-1 overflow-hidden flex flex-col">
      <div className="sticky top-0 z-40 bg-background">
        {/* ══════════════════════════════════════════════════
            Calendar Header (Square UI calendar-header.tsx)
            ══════════════════════════════════════════════════ */}
        <div className="border-b border-border bg-background">
          <div className="px-3 md:px-6 py-2.5 md:py-3">
          <div className="flex items-center justify-between gap-2 md:gap-3 flex-nowrap">
            {/* Left: title area */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <h1 className="text-sm md:text-base lg:text-lg font-semibold text-foreground truncate mb-0 md:mb-1">
                  {format(currentWeekStart, "MMMM dd, yyyy")}
                </h1>
                <p className="hidden md:block text-xs text-muted-foreground">
                  You have {todayMeetingsCount} meeting
                  {todayMeetingsCount !== 1 ? "s" : ""} and{" "}
                  {totalEventsCount} event
                  {totalEventsCount !== 1 ? "s" : ""} today 🗓️
                </p>
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-1 md:gap-1.5 lg:gap-2 shrink-0">
              {/* Notification bell */}
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative size-7 md:size-8 shrink-0"
                    >
                      <HugeiconsIcon
                        icon={Notification01Icon}
                        className="size-4"
                      />
                      {todayMeetingsCount > 0 && (
                        <span className="absolute top-1 right-1 size-1 bg-red-500 rounded-full" />
                      )}
                    </Button>
                  }
                />
                <PopoverContent align="end" className="w-80 p-0">
                  <div className="p-3 border-b border-border">
                    <p className="text-sm font-semibold">Notifications</p>
                  </div>
                  <div className="divide-y divide-border">
                    <div className="flex flex-col items-start gap-1 p-3">
                      <div className="flex items-center gap-2 w-full">
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="size-4 text-green-500"
                        />
                        <span className="text-sm font-medium flex-1">
                          Meeting confirmed
                        </span>
                        <span className="text-xs text-muted-foreground">
                          2m ago
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">
                        Daily checkin has been confirmed for tomorrow at 9:00 AM
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1 p-3">
                      <div className="flex items-center gap-2 w-full">
                        <HugeiconsIcon
                          icon={Clock01Icon}
                          className="size-4 text-blue-500"
                        />
                        <span className="text-sm font-medium flex-1">
                          Reminder
                        </span>
                        <span className="text-xs text-muted-foreground">
                          15m ago
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">
                        Team Standup starts in 30 minutes
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1 p-3">
                      <div className="flex items-center gap-2 w-full">
                        <HugeiconsIcon
                          icon={Calendar01Icon}
                          className="size-4 text-orange-500"
                        />
                        <span className="text-sm font-medium flex-1">
                          Event updated
                        </span>
                        <span className="text-xs text-muted-foreground">
                          1h ago
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">
                        Design Workshop time has been changed to 2:00 PM
                      </p>
                    </div>
                  </div>
                  <div className="p-2 border-t border-border text-center">
                    <span className="text-xs text-muted-foreground">
                      View all notifications
                    </span>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Schedule popover */}
              <SchedulePopover
                onSchedule={() => {
                  setCreateInitialSlot(null);
                  setCreateOpen(true);
                }}
              >
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7 md:size-8 shrink-0 md:w-auto md:px-2 md:gap-1.5"
                >
                  <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
                  <span className="hidden lg:inline text-xs">Schedule</span>
                </Button>
              </SchedulePopover>

              {/* View mode toggle: Calendar / Queue */}
              <div className="flex items-center rounded-lg border border-border p-0.5 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7 md:size-8 rounded-md transition-colors",
                    viewMode === "calendar" && "bg-muted text-foreground"
                  )}
                  onClick={() => setViewMode("calendar")}
                  title="Calendar view"
                >
                  <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7 md:size-8 rounded-md transition-colors",
                    viewMode === "queue" && "bg-muted text-foreground"
                  )}
                  onClick={() => setViewMode("queue")}
                  title="Queue view"
                >
                  <HugeiconsIcon icon={UserGroupIcon} className="size-4" />
                </Button>
              </div>

              {/* + Create Event */}
              <Button
                size="icon"
                className="size-7 md:size-8 shrink-0 md:w-auto md:px-2 md:gap-1.5 bg-foreground text-background hover:bg-foreground/90"
                onClick={() => {
                  setCreateInitialSlot(null);
                  setCreateOpen(true);
                }}
              >
                <HugeiconsIcon icon={Add01Icon} className="size-4" />
                <span className="hidden lg:inline text-xs">Create Event</span>
              </Button>
            </div>
          </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════
            Calendar Controls (Square UI calendar-controls.tsx)
            ══════════════════════════════════════════════════ */}
        {viewMode === "calendar" && (
          <div className="px-3 md:px-6 py-4 border-b border-border bg-background">
            <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          {/* Search with settings icon */}
          <div className="relative flex-1 min-w-[200px] max-w-[280px] shrink-0">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            />
            <Input
              placeholder="Search in calendar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9 h-8 bg-background"
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 size-6"
            >
              <HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
            </Button>
          </div>

          {/* Today button */}
          <Button
            variant="outline"
            className="h-8 px-3 shrink-0"
            onClick={goToToday}
          >
            Today
          </Button>

          {/* Date range picker */}
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className={cn(
                    "h-8 px-3 gap-2 justify-start text-left font-normal shrink-0",
                    "hover:bg-accent"
                  )}
                >
                  <HugeiconsIcon
                    icon={Calendar01Icon}
                    className="size-4 text-muted-foreground"
                  />
                  <span className="text-xs text-foreground">
                    {weekStart} - {weekEndLabel}
                  </span>
                </Button>
              }
            />
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={currentWeekStart}
                onSelect={(date) => {
                  if (date) {
                    goToDate(date);
                    setDatePickerOpen(false);
                  }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <div className="ml-auto" />

          {/* Filter button */}
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className={cn(
                    "h-8 px-3 gap-2",
                    hasActiveFilters && "bg-accent"
                  )}
                >
                  <HugeiconsIcon icon={FilterIcon} className="size-4" />
                  <span className="hidden sm:inline text-xs">Filter</span>
                  {hasActiveFilters && (
                    <span className="size-1.5 rounded-full bg-primary" />
                  )}
                </Button>
              }
            />
            <PopoverContent
              className="p-4 w-[288px]"
              align="end"
            >
              <div className="space-y-4 w-full">
                <div>
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <HugeiconsIcon
                      icon={Calendar01Icon}
                      className="size-4 text-muted-foreground"
                    />
                    Room Assignment
                  </h4>
                  <div className="space-y-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between h-9 px-3"
                      onClick={() => setEventTypeFilter("all")}
                    >
                      <span className="text-sm">All events</span>
                      {eventTypeFilter === "all" && (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="size-4 text-primary"
                        />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between h-9 px-3"
                      onClick={() => setEventTypeFilter("with-room")}
                    >
                      <div className="flex items-center gap-2.5">
                        <HugeiconsIcon
                          icon={DoorIcon}
                          className="size-4 text-cyan-500"
                        />
                        <span className="text-sm">With room</span>
                      </div>
                      {eventTypeFilter === "with-room" && (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="size-4 text-primary"
                        />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between h-9 px-3"
                      onClick={() => setEventTypeFilter("without-room")}
                    >
                      <div className="flex items-center gap-2.5">
                        <HugeiconsIcon
                          icon={DoorIcon}
                          className="size-4 text-muted-foreground"
                        />
                        <span className="text-sm">Without room</span>
                      </div>
                      {eventTypeFilter === "without-room" && (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="size-4 text-primary"
                        />
                      )}
                    </Button>
                  </div>
                </div>

                {hasActiveFilters && (
                  <>
                    <Separator />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-9"
                      onClick={() => {
                        setEventTypeFilter("all");
                      }}
                    >
                      Clear all filters
                    </Button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════
          Calendar Grid / Queue View
          ══════════════════════════════════════════════════ */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="space-y-4 w-full max-w-3xl px-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-[400px] w-full rounded-xl" />
          </div>
        </div>
      ) : viewMode === "calendar" ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <CalendarView
            onSlotSelect={handleSlotSelect}
            onEditMeeting={(meeting) => {
              setEditMeeting(meeting);
              setCreateInitialSlot(null);
              setCreateOpen(true);
            }}
            onRefresh={loadMeetings}
          />
        </div>
      ) : (
        <QueueView
          onRefresh={loadMeetings}
          onEditMeeting={(meeting) => {
            setEditMeeting(meeting);
            setCreateInitialSlot(null);
            setCreateOpen(true);
          }}
          onGoToCalendar={(meeting) => {
            goToDate(new Date(meeting.date_time));
            setViewMode("calendar");
          }}
        />
      )}

      {/* Create Event Dialog */}
      {token && (
        <CreateEventDialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) {
              setCreateInitialSlot(null);
              setEditMeeting(null);
            }
          }}
          patients={patients}
          doctors={doctors}
          currentUserId={userId}
          initialSlot={createInitialSlot}
          editMeeting={editMeeting}
          onCreated={handleMeetingCreated}
          token={token}
        />
      )}
    </main>
  );
}
