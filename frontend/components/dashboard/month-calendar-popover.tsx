"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  setHours,
  setMinutes,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar01Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  Delete01Icon,
  DoorIcon,
  NoteIcon,
  Search01Icon,
  Stethoscope02Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  createMeeting,
  deleteMeeting,
  updateMeeting,
  type Meeting,
  type MeetingCreatePayload,
  type MeetingUpdatePayload,
  type MeetingStatus,
  type Patient,
  type User,
} from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";
import type { CalendarSlotSelection } from "./calendar-view";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

const TIME_PICKER_HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => index * 5);
const TIMELINE_HOUR_HEIGHT = 54;
const DAY_EVENT_MIN_HEIGHT = 40;

const CONTEXT_MENU_WIDTH = 176;
const CONTEXT_MENU_HEIGHT = 56;
const MEETING_CONTEXT_MENU_WIDTH = 200;
const MEETING_CONTEXT_MENU_HEIGHT = 184;
const COMPOSER_WIDTH = 368;
const COMPOSER_HEIGHT = 620;
const MEETING_POPOVER_COMPACT_WIDTH = 304;
const MEETING_POPOVER_COMPACT_HEIGHT = 190;
const MEETING_POPOVER_DETAIL_WIDTH = 368;
const MEETING_POPOVER_DETAIL_HEIGHT = 468;
const MAX_VISIBLE_DAY_EVENTS = 3;

type CalendarPopupView = "day" | "week" | "month" | "year";
type DraftDragMode = "day" | "week" | "month";
type MeetingPopoverVariant = "compact" | "detail";
type FloatingPanelSide = "left" | "right";

interface DayContextMenuState {
  open: boolean;
  date: Date | null;
  x: number;
  y: number;
  startHour: number;
  startMinute: number;
}

interface ComposerState {
  anchorX: number;
  anchorY: number;
  date: Date;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  description: string;
  patientId: string;
  doctorId: string;
  room: string;
  note: string;
  submitting: boolean;
}

interface MeetingContextMenuState {
  open: boolean;
  meetingId: string | null;
  x: number;
  y: number;
}

interface DraftDragState {
  mode: DraftDragMode;
  pointerOffsetMinutes: number;
  durationMinutes: number;
  originDate: Date;
  originStartMinutes: number;
}

interface MeetingDragState {
  meetingId: string;
  mode: DraftDragMode;
  pointerOffsetMinutes: number;
  durationMinutes: number;
  originalDateTime: string;
  baseStartMinutes: number;
}

interface MeetingPopoverState {
  meetingId: string;
  x: number;
  y: number;
  variant: MeetingPopoverVariant;
  side: FloatingPanelSide;
  arrowY: number;
}

interface MonthCalendarPopoverProps {
  meetings: Meeting[];
  patients: Patient[];
  doctors: User[];
  token: string | null;
  currentUserId: string | null;
  userRole: string | null;
  onMeetingCreated?: (meeting?: Meeting) => Promise<void> | void;
  onNewEvent?: (slot: CalendarSlotSelection) => void;
}

const CLOSED_CONTEXT_MENU: DayContextMenuState = {
  open: false,
  date: null,
  x: 0,
  y: 0,
  startHour: 9,
  startMinute: 0,
};

const CLOSED_MEETING_CONTEXT_MENU: MeetingContextMenuState = {
  open: false,
  meetingId: null,
  x: 0,
  y: 0,
};

const TH_STATUS_LABELS: Partial<Record<MeetingStatus, string>> = {
  scheduled: "กำหนดการ",
  waiting: "รอพบแพทย์",
  in_progress: "กำลังตรวจ",
  overtime: "เกินเวลา",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
};

function getStatusLabel(status: MeetingStatus, language: AppLanguage): string {
  if (language === "th") {
    return TH_STATUS_LABELS[status] ?? "กำหนดการ";
  }
  return (
    {
      scheduled: "Scheduled",
      waiting: "Waiting",
      in_progress: "In progress",
      overtime: "Overtime",
      completed: "Completed",
      cancelled: "Cancelled",
    }[status] ?? "Scheduled"
  );
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function getInviteesDraftKey(meetingId: string): string {
  return `month-calendar-popover-invitees:${meetingId}`;
}

function readInviteesDraft(meetingId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(getInviteesDraftKey(meetingId)) ?? "";
  } catch {
    return "";
  }
}

function writeInviteesDraft(meetingId: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value.trim()) {
      window.localStorage.setItem(getInviteesDraftKey(meetingId), value);
      return;
    }
    window.localStorage.removeItem(getInviteesDraftKey(meetingId));
  } catch {
    // no-op: local storage may be blocked
  }
}

function minutesToHourMinute(totalMinutes: number): { hour: number; minute: number } {
  const minuteClamped = Math.min(Math.max(0, totalMinutes), 23 * 60 + 55);
  const hour = Math.floor(minuteClamped / 60);
  const minute = minuteClamped % 60;
  return { hour, minute };
}

function hourMinuteToMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function roundTo5Minutes(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

function clampStartMinutes(start: number, duration: number): number {
  const maxStart = Math.max(0, 23 * 60 + 55 - duration);
  return Math.min(Math.max(0, start), maxStart);
}

function buildIsoFromDateAndMinutes(date: Date, minutesInDay: number): string {
  const clamped = Math.min(Math.max(0, minutesInDay), 23 * 60 + 55);
  const { hour, minute } = minutesToHourMinute(clamped);
  const base = new Date(date);
  base.setSeconds(0, 0);
  return setMinutes(setHours(base, hour), minute).toISOString();
}

function formatHourOption(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour} ${period}`;
}

function formatTimeLabel(dateTime: string, language: AppLanguage): string {
  return new Date(dateTime).toLocaleTimeString(localeOf(language), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildMonthGridDays(activeMonth: Date): Date[] {
  const start = startOfWeek(startOfMonth(activeMonth), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(activeMonth), { weekStartsOn: 0 });
  const days: Date[] = [];

  for (let day = start; day <= end; day = addDays(day, 1)) {
    days.push(day);
  }

  while (days.length < 42) {
    days.push(addDays(days[days.length - 1], 1));
  }

  return days.slice(0, 42);
}

function getMeetingTitle(meeting: Meeting, language: AppLanguage): string {
  if (meeting.description && meeting.description.trim().length > 0) {
    return meeting.description;
  }
  if (meeting.patient) {
    return `${meeting.patient.first_name} ${meeting.patient.last_name}`.trim();
  }
  return tr(language, "Appointment", "นัดหมาย");
}

function getMeetingDotClass(status: MeetingStatus): string {
  switch (status) {
    case "waiting":
      return "bg-amber-400";
    case "in_progress":
      return "bg-sky-400";
    case "completed":
      return "bg-emerald-400";
    case "overtime":
      return "bg-rose-400";
    case "cancelled":
      return "bg-zinc-400";
    case "scheduled":
    default:
      return "bg-fuchsia-400";
  }
}

function getMeetingChipClass(status: MeetingStatus): string {
  switch (status) {
    case "waiting":
      return "bg-amber-500/20 text-amber-100 border border-amber-400/30";
    case "in_progress":
      return "bg-sky-500/20 text-sky-100 border border-sky-400/30";
    case "completed":
      return "bg-emerald-500/20 text-emerald-100 border border-emerald-400/30";
    case "overtime":
      return "bg-rose-500/20 text-rose-100 border border-rose-400/30";
    case "cancelled":
      return "bg-zinc-500/20 text-zinc-200 border border-zinc-400/30";
    case "scheduled":
    default:
      return "bg-fuchsia-500/20 text-fuchsia-100 border border-fuchsia-400/30";
  }
}

function getMeetingStartMinutes(dateTime: string): number {
  const date = new Date(dateTime);
  return date.getHours() * 60 + date.getMinutes();
}

function getMeetingTimeRange(meeting: Meeting, language: AppLanguage): string {
  const start = new Date(meeting.date_time);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return `${start.toLocaleTimeString(localeOf(language), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })} - ${end.toLocaleTimeString(localeOf(language), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })}`;
}

function MeetingPreviewCard({
  meeting,
  language,
  variant,
  onClose,
  onUpdateMeeting,
}: {
  meeting: Meeting;
  language: AppLanguage;
  variant: MeetingPopoverVariant;
  onClose: () => void;
  onUpdateMeeting?: (
    meetingId: string,
    payload: MeetingUpdatePayload
  ) => Promise<void>;
}) {
  const title = getMeetingTitle(meeting, language);
  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name || ""} ${meeting.doctor.last_name || ""}`.trim()
    : tr(language, "Unassigned doctor", "ยังไม่ระบุแพทย์");
  const patientName = meeting.patient
    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
    : tr(language, "Unassigned patient", "ยังไม่ระบุผู้ป่วย");
  const dateLabel = new Date(meeting.date_time).toLocaleDateString(
    localeOf(language),
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  );
  const [titleInput, setTitleInput] = useState(title);
  const [roomInput, setRoomInput] = useState(meeting.room?.trim() ?? "");
  const [noteInput, setNoteInput] = useState(meeting.note?.trim() ?? "");
  const [inviteesInput, setInviteesInput] = useState(() =>
    readInviteesDraft(meeting.id)
  );
  const [savingField, setSavingField] = useState<"description" | "room" | "note" | null>(null);
  const latestDraftRef = useRef({
    title: titleInput,
    room: roomInput,
    note: noteInput,
    invitees: inviteesInput,
  });
  const savingFieldRef = useRef<"description" | "room" | "note" | null>(null);

  useEffect(() => {
    setTitleInput(title);
    setRoomInput(meeting.room?.trim() ?? "");
    setNoteInput(meeting.note?.trim() ?? "");
    setInviteesInput(readInviteesDraft(meeting.id));
  }, [meeting.id, meeting.note, meeting.room, meeting.description, title]);

  useEffect(() => {
    latestDraftRef.current = {
      title: titleInput,
      room: roomInput,
      note: noteInput,
      invitees: inviteesInput,
    };
  }, [inviteesInput, noteInput, roomInput, titleInput]);

  useEffect(() => {
    savingFieldRef.current = savingField;
  }, [savingField]);

  const persistMeetingField = async (
    field: "description" | "room" | "note",
    rawValue: string
  ) => {
    if (!onUpdateMeeting || savingField) return;

    const normalizedValue = rawValue.trim();
    let payload: MeetingUpdatePayload | null = null;

    if (field === "description") {
      const currentDescription = meeting.description?.trim() ?? "";
      const fallbackTitle = getMeetingTitle(meeting, language).trim();
      if (!currentDescription && normalizedValue === fallbackTitle) return;
      if (normalizedValue === currentDescription) return;
      payload = { description: normalizedValue || undefined };
    }

    if (field === "room") {
      const currentRoom = meeting.room?.trim() ?? "";
      if (normalizedValue === currentRoom) return;
      payload = { room: normalizedValue || undefined };
    }

    if (field === "note") {
      const currentNote = meeting.note?.trim() ?? "";
      if (normalizedValue === currentNote) return;
      payload = { note: normalizedValue || undefined };
    }

    if (!payload) return;

    try {
      savingFieldRef.current = field;
      setSavingField(field);
      await onUpdateMeeting(meeting.id, payload);
    } catch {
      if (field === "description") {
        setTitleInput(title);
      }
      if (field === "room") {
        setRoomInput(meeting.room?.trim() ?? "");
      }
      if (field === "note") {
        setNoteInput(meeting.note?.trim() ?? "");
      }
    } finally {
      savingFieldRef.current = null;
      setSavingField(null);
    }
  };

  const currentDescription = meeting.description?.trim() ?? "";
  const currentRoom = meeting.room?.trim() ?? "";
  const currentNote = meeting.note?.trim() ?? "";
  const fallbackTitle = getMeetingTitle(meeting, language).trim();

  const persistPendingDraft = useCallback(() => {
    if (!onUpdateMeeting || savingFieldRef.current) return;

    const payload: MeetingUpdatePayload = {};
    const latestTitle = latestDraftRef.current.title.trim();
    const latestRoom = latestDraftRef.current.room.trim();
    const latestNote = latestDraftRef.current.note.trim();

    if (!(latestTitle === fallbackTitle && !currentDescription) && latestTitle !== currentDescription) {
      payload.description = latestTitle || undefined;
    }
    if (latestRoom !== currentRoom) {
      payload.room = latestRoom || undefined;
    }
    if (latestNote !== currentNote) {
      payload.note = latestNote || undefined;
    }

    writeInviteesDraft(meeting.id, latestDraftRef.current.invitees);

    if (Object.keys(payload).length === 0) return;
    void onUpdateMeeting(meeting.id, payload);
  }, [
    currentDescription,
    currentNote,
    currentRoom,
    fallbackTitle,
    meeting.id,
    onUpdateMeeting,
  ]);

  useEffect(() => {
    return () => {
      persistPendingDraft();
    };
  }, [persistPendingDraft]);

  if (variant === "compact") {
    return (
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <h4 className="line-clamp-2 text-lg font-semibold leading-tight text-zinc-100">
            {title}
          </h4>
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-100">
            <span className={cn("size-2 rounded-full", getMeetingDotClass(meeting.status))} />
            <span>{getStatusLabel(meeting.status, language)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-700 bg-zinc-950/75 px-3 py-2 text-sm text-zinc-200">
          {dateLabel}
        </div>

        <div className="rounded-lg border border-zinc-700 bg-zinc-950/75 px-3 py-2 text-sm text-zinc-200">
          {getMeetingTimeRange(meeting, language)}
        </div>

        <div className="flex justify-end pt-1">
          <Button
            type="button"
            variant="outline"
            className="h-8 border-zinc-600 bg-zinc-800 px-3 text-xs text-zinc-100 hover:bg-zinc-700"
            onClick={onClose}
          >
            {tr(language, "Close", "ปิด")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-h-[452px] space-y-2.5 overflow-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex items-start gap-2 rounded-lg border border-zinc-700 bg-zinc-950/75 p-2.5">
        <input
          value={titleInput}
          onChange={(event) => setTitleInput(event.target.value)}
          onBlur={() => {
            void persistMeetingField("description", titleInput);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.currentTarget as HTMLInputElement).blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[32px] font-semibold leading-tight text-zinc-100 outline-none placeholder:text-zinc-400 md:text-3xl"
          placeholder={title}
          disabled={savingField === "description"}
        />
        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-100">
          <span className={cn("size-2 rounded-full", getMeetingDotClass(meeting.status))} />
          <span>{getStatusLabel(meeting.status, language)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-950/75 px-3 py-2 text-sm">
        <input
          value={roomInput}
          onChange={(event) => setRoomInput(event.target.value)}
          onBlur={() => {
            void persistMeetingField("room", roomInput);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.currentTarget as HTMLInputElement).blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-500"
          placeholder={tr(
            language,
            "Add Location or Video Call",
            "เพิ่มสถานที่หรือวิดีโอคอล"
          )}
          disabled={savingField === "room"}
        />
        <span className="inline-flex size-6 items-center justify-center rounded-md border border-zinc-600 bg-zinc-800/80 text-zinc-300">
          <HugeiconsIcon icon={DoorIcon} className="size-3.5" />
        </span>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-950/75 px-3 py-2.5 text-sm text-zinc-200">
        <div className="font-medium">
          {dateLabel} {getMeetingTimeRange(meeting, language)}
        </div>
        <div className="mt-1 text-zinc-300">
          {tr(
            language,
            "Alert 3 minutes before start",
            "แจ้งเตือน 3 นาทีก่อนเริ่ม"
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-950/75 px-3 py-2 text-sm">
        <p className="text-zinc-300">
          <span className="text-zinc-500">{tr(language, "Doctor", "แพทย์")}: </span>
          {doctorName}
        </p>
        <p className="mt-1 text-zinc-300">
          <span className="text-zinc-500">{tr(language, "Patient", "ผู้ป่วย")}: </span>
          {patientName}
        </p>
      </div>

      <input
        value={inviteesInput}
        onChange={(event) => setInviteesInput(event.target.value)}
        onBlur={() => {
          writeInviteesDraft(meeting.id, inviteesInput);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            writeInviteesDraft(meeting.id, inviteesInput);
            (event.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950/75 px-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-500"
        placeholder={tr(language, "Add Invitees", "เพิ่มผู้เข้าร่วม")}
      />

      <textarea
        value={noteInput}
        onChange={(event) => setNoteInput(event.target.value)}
        onBlur={() => {
          void persistMeetingField("note", noteInput);
        }}
        rows={3}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950/75 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-500 resize-none"
        placeholder={tr(
          language,
          "Add Notes, URL, or Attachments",
          "เพิ่มโน้ต URL หรือไฟล์แนบ"
        )}
        disabled={savingField === "note"}
      />
    </div>
  );
}

function MiniMonthNavigator({
  baseDate,
  selectedDate,
  onSelectDate,
  meetingsByDate,
  language,
}: {
  baseDate: Date;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  meetingsByDate: Map<string, Meeting[]>;
  language: AppLanguage;
}) {
  const monthStart = startOfMonth(baseDate);
  const monthDays = useMemo(() => buildMonthGridDays(monthStart), [monthStart]);
  const weekdayLabels = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      return {
        key: day.getDay(),
        label: day
          .toLocaleDateString(localeOf(language), { weekday: "narrow" })
          .toUpperCase(),
      };
    });
  }, [language]);

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900/95 p-3">
      <div className="mb-2 text-xs font-medium text-zinc-300">
        {monthStart.toLocaleDateString(localeOf(language), {
          month: "long",
          year: "numeric",
        })}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekdayLabels.map((item) => (
          <div key={item.key} className="text-center text-[10px] text-zinc-500">
            {item.label}
          </div>
        ))}

        {monthDays.map((day) => {
          const key = formatDateKey(day);
          const inCurrentMonth = isSameMonth(day, monthStart);
          const selected = isSameDay(day, selectedDate);
          const hasMeetings = (meetingsByDate.get(key)?.length ?? 0) > 0;

          return (
            <button
              key={key}
              type="button"
              className={cn(
                "relative flex h-7 items-center justify-center rounded text-[10px] transition-colors",
                inCurrentMonth
                  ? "text-zinc-200 hover:bg-zinc-800"
                  : "text-zinc-600 hover:bg-zinc-900/60",
                selected && "bg-rose-500 text-white hover:bg-rose-500"
              )}
              onClick={() => onSelectDate(new Date(day))}
            >
              {format(day, "d")}
              {hasMeetings ? (
                <span className="absolute bottom-0.5 size-1 rounded-full bg-fuchsia-400" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MonthCalendarPopover({
  meetings,
  patients,
  doctors,
  token,
  currentUserId,
  userRole,
  onMeetingCreated,
  onNewEvent,
}: MonthCalendarPopoverProps) {
  const language = useLanguageStore((state) => state.language);
  const isDoctorUser = userRole === "doctor";

  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<CalendarPopupView>("month");
  const [activeMonth, setActiveMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [previewMeeting, setPreviewMeeting] = useState<Meeting | null>(null);
  const [meetingPopover, setMeetingPopover] = useState<MeetingPopoverState | null>(null);
  const [contextMenu, setContextMenu] =
    useState<DayContextMenuState>(CLOSED_CONTEXT_MENU);
  const [meetingContextMenu, setMeetingContextMenu] =
    useState<MeetingContextMenuState>(CLOSED_MEETING_CONTEXT_MENU);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [draftDrag, setDraftDrag] = useState<DraftDragState | null>(null);
  const [meetingDrag, setMeetingDrag] = useState<MeetingDragState | null>(null);
  const [meetingDateOverrides, setMeetingDateOverrides] = useState<
    Record<string, string>
  >({});

  const popupContainerRef = useRef<HTMLDivElement>(null);
  const monthGridRef = useRef<HTMLDivElement>(null);
  const dayTimelineRef = useRef<HTMLDivElement>(null);
  const weekGridRef = useRef<HTMLDivElement>(null);
  const meetingDateOverridesRef = useRef<Record<string, string>>({});
  const selectedDateRef = useRef<Date>(new Date());
  const weekDaysRef = useRef<Date[]>([]);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    meetingDateOverridesRef.current = meetingDateOverrides;
  }, [meetingDateOverrides]);

  const defaultDoctorId = useMemo(() => {
    if (isDoctorUser) return currentUserId ?? "";
    return doctors[0]?.id ?? "";
  }, [isDoctorUser, currentUserId, doctors]);

  const monthGridDays = useMemo(() => buildMonthGridDays(activeMonth), [activeMonth]);

  const effectiveMeetingDateTimes = useMemo(() => {
    const map = new Map<string, string>();
    for (const meeting of meetings) {
      map.set(
        meeting.id,
        meetingDateOverrides[meeting.id] ? meetingDateOverrides[meeting.id] : meeting.date_time
      );
    }
    return map;
  }, [meetings, meetingDateOverrides]);

  const meetingsByDate = useMemo(() => {
    const map = new Map<string, Meeting[]>();

    for (const meeting of meetings) {
      const effectiveDateTime =
        effectiveMeetingDateTimes.get(meeting.id) ?? meeting.date_time;
      const key = formatDateKey(new Date(effectiveDateTime));
      const dayMeetings = map.get(key);
      if (dayMeetings) {
        dayMeetings.push(meeting);
      } else {
        map.set(key, [meeting]);
      }
    }

    for (const dayMeetings of map.values()) {
      dayMeetings.sort(
        (left, right) =>
          new Date(
            effectiveMeetingDateTimes.get(left.id) ?? left.date_time
          ).getTime() -
          new Date(
            effectiveMeetingDateTimes.get(right.id) ?? right.date_time
          ).getTime()
      );
    }

    return map;
  }, [meetings, effectiveMeetingDateTimes]);

  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }, [selectedDate]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    weekDaysRef.current = weekDays;
  }, [weekDays]);

  const weekdayLabels = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      return {
        key: day.getDay(),
        label: day.toLocaleDateString(localeOf(language), {
          weekday: "short",
        }),
      };
    });
  }, [language]);

  const selectedDayMeetings =
    meetingsByDate.get(formatDateKey(selectedDate)) ?? [];

  const getEffectiveDateTime = (meeting: Meeting): string =>
    effectiveMeetingDateTimes.get(meeting.id) ?? meeting.date_time;

  const findMeetingById = (meetingId: string | null): Meeting | null => {
    if (!meetingId) return null;

    if (previewMeeting && previewMeeting.id === meetingId) {
      return previewMeeting;
    }

    const fallbackMeeting = meetings.find((item) => item.id === meetingId);
    if (!fallbackMeeting) return null;

    return {
      ...fallbackMeeting,
      date_time:
        effectiveMeetingDateTimes.get(fallbackMeeting.id) ??
        fallbackMeeting.date_time,
    };
  };

  const meetingForPopover = meetingPopover
    ? findMeetingById(meetingPopover.meetingId)
    : null;

  const headerTitle = useMemo(() => {
    if (viewMode === "day") {
      return selectedDate.toLocaleDateString(localeOf(language), {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }

    if (viewMode === "week") {
      const weekStart = weekDays[0];
      const weekEnd = weekDays[6];
      return `${weekStart.toLocaleDateString(localeOf(language), {
        day: "numeric",
        month: "short",
      })} - ${weekEnd.toLocaleDateString(localeOf(language), {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`;
    }

    if (viewMode === "year") {
      return activeMonth.toLocaleDateString(localeOf(language), {
        year: "numeric",
      });
    }

    return activeMonth.toLocaleDateString(localeOf(language), {
      month: "long",
      year: "numeric",
    });
  }, [activeMonth, language, selectedDate, viewMode, weekDays]);

  const nowTop =
    (now.getHours() + now.getMinutes() / 60) * TIMELINE_HOUR_HEIGHT;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (composer) {
          setComposer(null);
          return;
        }
        if (meetingContextMenu.open) {
          setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
          return;
        }
        if (contextMenu.open) {
          setContextMenu(CLOSED_CONTEXT_MENU);
          return;
        }
        if (meetingPopover) {
          setMeetingPopover(null);
          return;
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!popupContainerRef.current?.contains(event.target as Node)) {
        setContextMenu(CLOSED_CONTEXT_MENU);
        setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
        setMeetingPopover(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [composer, contextMenu.open, meetingContextMenu.open, meetingPopover, open]);

  const clampInContainer = (
    x: number,
    y: number,
    panelWidth: number,
    panelHeight: number
  ) => {
    const container = popupContainerRef.current;
    if (!container) {
      return { x, y };
    }

    const rect = container.getBoundingClientRect();
    return {
      x: Math.min(Math.max(8, x), Math.max(8, rect.width - panelWidth - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, rect.height - panelHeight - 8)),
    };
  };

  const getFloatingHorizontalPlacement = (
    anchorX: number,
    panelWidth: number,
    containerWidth: number,
    gap: number
  ): { x: number; side: FloatingPanelSide } => {
    const rightX = anchorX + gap;
    const leftX = anchorX - panelWidth - gap;
    const canPlaceRight = rightX + panelWidth <= containerWidth - 8;
    const canPlaceLeft = leftX >= 8;
    const preferredSide: FloatingPanelSide =
      anchorX > containerWidth / 2 ? "left" : "right";

    if (preferredSide === "right") {
      if (canPlaceRight) return { x: rightX, side: "right" };
      if (canPlaceLeft) return { x: leftX, side: "left" };
    } else {
      if (canPlaceLeft) return { x: leftX, side: "left" };
      if (canPlaceRight) return { x: rightX, side: "right" };
    }

    const fallbackX = preferredSide === "right" ? rightX : leftX;
    return {
      x: Math.min(Math.max(8, fallbackX), Math.max(8, containerWidth - panelWidth - 8)),
      side: preferredSide,
    };
  };

  const getMeetingPopoverVariant = (
    meeting: Meeting,
    preferredVariant?: MeetingPopoverVariant
  ): MeetingPopoverVariant => {
    if (preferredVariant) return preferredVariant;

    const hasExtraDetails = Boolean(
      meeting.note?.trim() ||
        meeting.room?.trim() ||
        (meeting.description?.trim().length ?? 0) > 48
    );
    return hasExtraDetails ? "detail" : "compact";
  };

  const openMeetingPopover = (
    event: React.MouseEvent<HTMLElement>,
    meeting: Meeting,
    preferredVariant?: MeetingPopoverVariant
  ) => {
    event.stopPropagation();

    const container = popupContainerRef.current;
    if (!container) return;

    const effectiveDateTime = getEffectiveDateTime(meeting);
    const variant = getMeetingPopoverVariant(meeting, preferredVariant);
    const panelWidth =
      variant === "detail"
        ? MEETING_POPOVER_DETAIL_WIDTH
        : MEETING_POPOVER_COMPACT_WIDTH;
    const panelHeight =
      variant === "detail"
        ? MEETING_POPOVER_DETAIL_HEIGHT
        : MEETING_POPOVER_COMPACT_HEIGHT;

    const rect = container.getBoundingClientRect();
    const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const anchorX = targetRect.left - rect.left + targetRect.width / 2;
    const anchorY = targetRect.top - rect.top + targetRect.height / 2;
    const placement = getFloatingHorizontalPlacement(
      anchorX,
      panelWidth,
      rect.width,
      14
    );
    const side = placement.side;
    const rightX = targetRect.right - rect.left + 10;
    const leftX = targetRect.left - rect.left - panelWidth - 10;
    const rawX = side === "right" ? rightX : leftX;
    const rawY = anchorY - panelHeight / 2;
    const position = clampInContainer(rawX, rawY, panelWidth, panelHeight);
    const arrowY = Math.min(
      panelHeight - 14,
      Math.max(14, anchorY - position.y)
    );

    setPreviewMeeting({
      ...meeting,
      date_time: effectiveDateTime,
    });
    setMeetingPopover({
      meetingId: meeting.id,
      x: position.x,
      y: position.y,
      variant,
      side,
      arrowY,
    });
    setContextMenu(CLOSED_CONTEXT_MENU);
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
  };

  const setFocusedDate = (date: Date) => {
    setSelectedDate(new Date(date));
    setActiveMonth(startOfMonth(date));
  };

  const openContextMenuForDate = (
    event: React.MouseEvent<HTMLElement>,
    date: Date,
    startHour = 9,
    startMinute = 0
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const container = popupContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;

    const position = clampInContainer(
      rawX,
      rawY,
      CONTEXT_MENU_WIDTH,
      CONTEXT_MENU_HEIGHT
    );

    setContextMenu({
      open: true,
      date: new Date(date),
      x: position.x,
      y: position.y,
      startHour,
      startMinute,
    });
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
    setMeetingPopover(null);
  };

  const openContextMenuForMeeting = (
    event: React.MouseEvent<HTMLElement>,
    meeting: Meeting
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const container = popupContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const position = clampInContainer(
      rawX,
      rawY,
      MEETING_CONTEXT_MENU_WIDTH,
      MEETING_CONTEXT_MENU_HEIGHT
    );

    setMeetingContextMenu({
      open: true,
      meetingId: meeting.id,
      x: position.x,
      y: position.y,
    });
    setContextMenu(CLOSED_CONTEXT_MENU);
    setMeetingPopover(null);
  };

  const handleCopyMeeting = async () => {
    const meeting = findMeetingById(meetingContextMenu.meetingId);
    if (!meeting) return;

    const title = getMeetingTitle(meeting, language);
    const start = new Date(meeting.date_time);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const doctorName = meeting.doctor
      ? `Dr. ${meeting.doctor.first_name || ""} ${meeting.doctor.last_name || ""}`.trim()
      : tr(language, "Unassigned doctor", "ยังไม่ระบุแพทย์");
    const patientName = meeting.patient
      ? `${meeting.patient.first_name} ${meeting.patient.last_name}`.trim()
      : tr(language, "Unassigned patient", "ยังไม่ระบุผู้ป่วย");

    const lines: string[] = [
      title,
      `${tr(language, "Date", "วันที่")}: ${start.toLocaleDateString(localeOf(language), {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })}`,
      `${tr(language, "Time", "เวลา")}: ${start.toLocaleTimeString(localeOf(language), {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })} - ${end.toLocaleTimeString(localeOf(language), {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })}`,
      `${tr(language, "Doctor", "แพทย์")}: ${doctorName}`,
      `${tr(language, "Patient", "ผู้ป่วย")}: ${patientName}`,
    ];

    if (meeting.room?.trim()) {
      lines.push(`${tr(language, "Room", "ห้อง")}: ${meeting.room.trim()}`);
    }
    if (meeting.note?.trim()) {
      lines.push(`${tr(language, "Note", "บันทึก")}: ${meeting.note.trim()}`);
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success(
        tr(
          language,
          "Appointment details copied",
          "คัดลอกรายละเอียดนัดหมายแล้ว"
        )
      );
    } catch {
      toast.error(
        tr(language, "Failed to copy appointment", "คัดลอกนัดหมายไม่สำเร็จ")
      );
    } finally {
      setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
    }
  };

  const confirmDeleteMeeting = () => {
    const meeting = findMeetingById(meetingContextMenu.meetingId);
    if (!meeting) return;
    const meetingId = meeting.id;

    const patientName = meeting.patient
      ? `${meeting.patient.first_name} ${meeting.patient.last_name}`.trim()
      : getMeetingTitle(meeting, language);

    toast.destructiveAction(
      tr(language, "Delete appointment?", "ลบนัดหมายนี้ใช่ไหม?"),
      {
        description: tr(
          language,
          `Delete appointment for ${patientName}? This action cannot be undone.`,
          `ลบนัดหมายของ ${patientName} ใช่ไหม? การกระทำนี้ไม่สามารถย้อนกลับได้`
        ),
        button: {
          title: tr(language, "Delete", "ลบ"),
          onClick: () => {
            void (async () => {
              if (!token) {
                toast.error(
                  tr(
                    language,
                    "Session expired. Please sign in again",
                    "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"
                  )
                );
                return;
              }

              try {
                await deleteMeeting(meetingId, token);
                setMeetingDateOverrides((prev) => {
                  if (!prev[meetingId]) return prev;
                  const next = { ...prev };
                  delete next[meetingId];
                  return next;
                });
                setPreviewMeeting((prev) =>
                  prev && prev.id === meetingId ? null : prev
                );
                setMeetingPopover((prev) =>
                  prev && prev.meetingId === meetingId ? null : prev
                );
                setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
                toast.success(
                  tr(language, "Appointment deleted", "ลบนัดหมายแล้ว")
                );
                await onMeetingCreated?.();
              } catch (error: unknown) {
                const message =
                  error instanceof Error
                    ? error.message
                    : tr(
                        language,
                        "Failed to delete appointment",
                        "ลบนัดหมายไม่สำเร็จ"
                      );
                toast.error(message);
              }
            })();
          },
        },
        duration: 9000,
      }
    );
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
  };

  const openComposerForDate = (
    date: Date,
    anchorX: number,
    anchorY: number,
    startHour: number,
    startMinute: number
  ) => {
    const startTotal = startHour * 60 + startMinute;
    const endTotal = Math.min(startTotal + 60, 23 * 60 + 55);
    const positioned = clampInContainer(
      anchorX,
      anchorY,
      COMPOSER_WIDTH,
      COMPOSER_HEIGHT
    );

    setComposer({
      anchorX: positioned.x,
      anchorY: positioned.y,
      date: new Date(date),
      startHour,
      startMinute,
      endHour: Math.floor(endTotal / 60),
      endMinute: endTotal % 60,
      description: "",
      patientId: "",
      doctorId: defaultDoctorId,
      room: "",
      note: "",
      submitting: false,
    });
  };

  const openComposerFromClientPoint = (
    clientX: number,
    clientY: number,
    date: Date,
    startHour: number,
    startMinute: number
  ) => {
    const container = popupContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const relativeX = clientX - containerRect.left;
    const relativeY = clientY - containerRect.top;
    const placement = getFloatingHorizontalPlacement(
      relativeX,
      COMPOSER_WIDTH,
      containerRect.width,
      12
    );

    openComposerForDate(
      date,
      placement.x,
      relativeY + 12,
      startHour,
      startMinute
    );
  };

  const openComposerByDoubleClick = (
    clientX: number,
    clientY: number,
    date: Date,
    minuteInDay: number
  ) => {
    const snapped = clampStartMinutes(roundTo5Minutes(minuteInDay), 60);
    const { hour, minute } = minutesToHourMinute(snapped);
    setContextMenu(CLOSED_CONTEXT_MENU);
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
    setMeetingPopover(null);
    if (viewMode === "day" || viewMode === "week") {
      setFocusedDate(date);
    } else {
      setSelectedDate(new Date(date));
    }
    openComposerFromClientPoint(clientX, clientY, date, hour, minute);
  };

  const getComposerDurationMinutes = (state: ComposerState): number => {
    const start = hourMinuteToMinutes(state.startHour, state.startMinute);
    const end = hourMinuteToMinutes(state.endHour, state.endMinute);
    if (end > start) return end - start;
    return 60;
  };

  const startDraftDrag = (
    event: React.PointerEvent<HTMLElement>,
    mode: DraftDragMode
  ) => {
    if (!composer) return;
    event.preventDefault();
    event.stopPropagation();

    const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const pointerOffsetMinutes =
      mode === "month"
        ? 0
        : ((event.clientY - targetRect.top) / TIMELINE_HOUR_HEIGHT) * 60;

    setDraftDrag({
      mode,
      pointerOffsetMinutes: Math.max(0, pointerOffsetMinutes),
      durationMinutes: getComposerDurationMinutes(composer),
      originDate: new Date(composer.date),
      originStartMinutes: hourMinuteToMinutes(
        composer.startHour,
        composer.startMinute
      ),
    });
  };

  useEffect(() => {
    if (!draftDrag || !composer) return;

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handleMove = (event: PointerEvent) => {
      if (draftDrag.mode === "day") {
        const timeline = dayTimelineRef.current;
        if (!timeline) return;
        const rect = timeline.getBoundingClientRect();
        const minuteRaw =
          ((event.clientY - rect.top) / TIMELINE_HOUR_HEIGHT) * 60 -
          draftDrag.pointerOffsetMinutes;
        const minuteSnapped = roundTo5Minutes(minuteRaw);
        const startClamped = clampStartMinutes(
          minuteSnapped,
          draftDrag.durationMinutes
        );
        const endMinutes = Math.min(
          23 * 60 + 55,
          startClamped + draftDrag.durationMinutes
        );
        const startParts = minutesToHourMinute(startClamped);
        const endParts = minutesToHourMinute(endMinutes);
        setComposer((prev) =>
          prev
            ? {
                ...prev,
                startHour: startParts.hour,
                startMinute: startParts.minute,
                endHour: endParts.hour,
                endMinute: endParts.minute,
              }
            : prev
        );
        return;
      }

      if (draftDrag.mode === "week") {
        const grid = weekGridRef.current;
        if (!grid) return;
        const rect = grid.getBoundingClientRect();
        const dayRegionWidth = rect.width - 72;
        const dayWidth = dayRegionWidth / 7;
        const rawX = event.clientX - rect.left - 72;
        const dayIndex = Math.min(
          6,
          Math.max(0, Math.floor(rawX / Math.max(1, dayWidth)))
        );
        const targetDate = weekDays[dayIndex] ?? composer.date;
        const minuteRaw =
          ((event.clientY - rect.top) / TIMELINE_HOUR_HEIGHT) * 60 -
          draftDrag.pointerOffsetMinutes;
        const minuteSnapped = roundTo5Minutes(minuteRaw);
        const startClamped = clampStartMinutes(
          minuteSnapped,
          draftDrag.durationMinutes
        );
        const endMinutes = Math.min(
          23 * 60 + 55,
          startClamped + draftDrag.durationMinutes
        );
        const startParts = minutesToHourMinute(startClamped);
        const endParts = minutesToHourMinute(endMinutes);
        setComposer((prev) =>
          prev
            ? {
                ...prev,
                date: new Date(targetDate),
                startHour: startParts.hour,
                startMinute: startParts.minute,
                endHour: endParts.hour,
                endMinute: endParts.minute,
              }
            : prev
        );
        setSelectedDate(new Date(targetDate));
        return;
      }

      const pointedElement = document.elementFromPoint(
        event.clientX,
        event.clientY
      ) as HTMLElement | null;
      const dayCell = pointedElement?.closest("[data-month-date]") as
        | HTMLElement
        | null;
      const dateValue = dayCell?.dataset.monthDate;
      if (!dateValue) return;
      const targetDate = new Date(`${dateValue}T00:00:00`);
      setComposer((prev) => (prev ? { ...prev, date: targetDate } : prev));
      setSelectedDate(targetDate);
    };

    const handleUp = () => {
      setDraftDrag(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [composer, draftDrag, weekDays]);

  const startMeetingDrag = (
    event: React.PointerEvent<HTMLElement>,
    meeting: Meeting,
    mode: DraftDragMode
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const meetingDateTime = getEffectiveDateTime(meeting);
    const meetingDate = new Date(meetingDateTime);
    const startMinutes =
      meetingDate.getHours() * 60 + meetingDate.getMinutes();

    const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const pointerOffsetMinutes =
      mode === "month"
        ? 0
        : ((event.clientY - targetRect.top) / TIMELINE_HOUR_HEIGHT) * 60;

    setMeetingDrag({
      meetingId: meeting.id,
      mode,
      pointerOffsetMinutes: Math.max(0, pointerOffsetMinutes),
      durationMinutes: 60,
      originalDateTime: meetingDateTime,
      baseStartMinutes: startMinutes,
    });
    setContextMenu(CLOSED_CONTEXT_MENU);
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
    setMeetingPopover(null);
  };

  useEffect(() => {
    if (!meetingDrag) return;

    const meeting = meetings.find((item) => item.id === meetingDrag.meetingId);
    if (!meeting) return;

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const applyOverride = (date: Date, startMinutesRaw: number) => {
      const startMinutes = clampStartMinutes(
        roundTo5Minutes(startMinutesRaw),
        meetingDrag.durationMinutes
      );
      const iso = buildIsoFromDateAndMinutes(date, startMinutes);
      setMeetingDateOverrides((prev) => {
        if (prev[meetingDrag.meetingId] === iso) return prev;
        return { ...prev, [meetingDrag.meetingId]: iso };
      });
      setPreviewMeeting((prev) =>
        prev && prev.id === meetingDrag.meetingId
          ? { ...prev, date_time: iso }
          : prev
      );
      setSelectedDate(new Date(date));
    };

    const handleMove = (event: PointerEvent) => {
      if (meetingDrag.mode === "day") {
        const timeline = dayTimelineRef.current;
        if (!timeline) return;
        const rect = timeline.getBoundingClientRect();
        const minuteRaw =
          ((event.clientY - rect.top) / TIMELINE_HOUR_HEIGHT) * 60 -
          meetingDrag.pointerOffsetMinutes;
        applyOverride(selectedDateRef.current, minuteRaw);
        return;
      }

      if (meetingDrag.mode === "week") {
        const grid = weekGridRef.current;
        if (!grid) return;
        const rect = grid.getBoundingClientRect();
        const dayRegionWidth = rect.width - 72;
        const dayWidth = dayRegionWidth / 7;
        const rawX = event.clientX - rect.left - 72;
        const dayIndex = Math.min(
          6,
          Math.max(0, Math.floor(rawX / Math.max(1, dayWidth)))
        );
        const targetDate =
          weekDaysRef.current[dayIndex] ?? selectedDateRef.current;
        const minuteRaw =
          ((event.clientY - rect.top) / TIMELINE_HOUR_HEIGHT) * 60 -
          meetingDrag.pointerOffsetMinutes;
        applyOverride(targetDate, minuteRaw);
        return;
      }

      const pointedElement = document.elementFromPoint(
        event.clientX,
        event.clientY
      ) as HTMLElement | null;
      const dayCell = pointedElement?.closest("[data-month-date]") as
        | HTMLElement
        | null;
      const dateValue = dayCell?.dataset.monthDate;
      if (!dateValue) return;
      const targetDate = new Date(`${dateValue}T00:00:00`);
      const iso = buildIsoFromDateAndMinutes(
        targetDate,
        meetingDrag.baseStartMinutes
      );
      setMeetingDateOverrides((prev) => {
        if (prev[meetingDrag.meetingId] === iso) return prev;
        return { ...prev, [meetingDrag.meetingId]: iso };
      });
      setPreviewMeeting((prev) =>
        prev && prev.id === meetingDrag.meetingId
          ? { ...prev, date_time: iso }
          : prev
      );
      setSelectedDate(targetDate);
    };

    const handleUp = () => {
      const overrides = meetingDateOverridesRef.current;
      const finalDateTime =
        overrides[meetingDrag.meetingId] ?? meetingDrag.originalDateTime;
      const hasChanged = finalDateTime !== meetingDrag.originalDateTime;
      setMeetingDrag(null);

      if (!hasChanged) {
        setMeetingDateOverrides((prev) => {
          if (!prev[meetingDrag.meetingId]) return prev;
          const next = { ...prev };
          delete next[meetingDrag.meetingId];
          return next;
        });
        return;
      }

      if (!token) {
        setMeetingDateOverrides((prev) => {
          const next = { ...prev };
          delete next[meetingDrag.meetingId];
          return next;
        });
        toast.error(
          tr(
            language,
            "Session expired. Please sign in again",
            "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"
          )
        );
        return;
      }

      const finalizeUpdate = async () => {
        try {
          const updatedMeeting = await updateMeeting(
            meetingDrag.meetingId,
            { date_time: finalDateTime },
            token
          );
          toast.success(
            tr(language, "Appointment moved", "ย้ายนัดหมายสำเร็จ")
          );
          setPreviewMeeting((prev) =>
            prev && prev.id === updatedMeeting.id
              ? { ...updatedMeeting }
              : prev
          );
          await onMeetingCreated?.(updatedMeeting);
          setMeetingDateOverrides((prev) => {
            const next = { ...prev };
            delete next[meetingDrag.meetingId];
            return next;
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : tr(
                  language,
                  "Failed to move appointment",
                  "ย้ายนัดหมายไม่สำเร็จ"
                );
          toast.error(message);
          setMeetingDateOverrides((prev) => {
            const next = { ...prev };
            delete next[meetingDrag.meetingId];
            return next;
          });
        }
      };

      void finalizeUpdate();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [
    language,
    meetingDrag,
    meetings,
    onMeetingCreated,
    token,
  ]);

  const handleNewEventAction = () => {
    if (!contextMenu.date) return;

    if (viewMode === "day" || viewMode === "week") {
      setFocusedDate(contextMenu.date);
    } else {
      setSelectedDate(new Date(contextMenu.date));
    }
    const container = popupContainerRef.current;
    const defaultX = contextMenu.x + 8;
    let targetX = defaultX;

    if (container) {
      const rect = container.getBoundingClientRect();
      const placement = getFloatingHorizontalPlacement(
        contextMenu.x,
        COMPOSER_WIDTH,
        rect.width,
        8
      );
      targetX = placement.x;
    }

    openComposerForDate(
      contextMenu.date,
      targetX,
      contextMenu.y + 8,
      contextMenu.startHour,
      contextMenu.startMinute
    );

    onNewEvent?.({
      date: new Date(contextMenu.date),
      startHour: contextMenu.startHour,
      startMinute: contextMenu.startMinute,
    });

    setContextMenu(CLOSED_CONTEXT_MENU);
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
    setMeetingPopover(null);
  };

  const handleNavigate = (direction: -1 | 1) => {
    setContextMenu(CLOSED_CONTEXT_MENU);
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
    setMeetingPopover(null);

    if (viewMode === "month") {
      const nextMonth = addMonths(activeMonth, direction);
      const monthStart = startOfMonth(nextMonth);
      const maxDayInNextMonth = endOfMonth(nextMonth).getDate();
      const preferredDay = Math.min(selectedDate.getDate(), maxDayInNextMonth);
      const nextSelectedDate = new Date(monthStart);
      nextSelectedDate.setDate(preferredDay);
      setActiveMonth(monthStart);
      setSelectedDate(nextSelectedDate);
      return;
    }

    if (viewMode === "day") {
      const next = addDays(selectedDate, direction);
      setFocusedDate(next);
      return;
    }

    if (viewMode === "week") {
      const next = addWeeks(selectedDate, direction);
      setFocusedDate(next);
      return;
    }

    if (viewMode === "year") {
      const nextYear = addYears(activeMonth, direction);
      setActiveMonth(startOfYear(nextYear));
      setSelectedDate(addYears(selectedDate, direction));
      return;
    }
  };

  const handleGoToday = () => {
    const today = new Date();
    setFocusedDate(today);
    setContextMenu(CLOSED_CONTEXT_MENU);
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
    setMeetingPopover(null);
  };

  const clearFloatingPanels = () => {
    setComposer(null);
    setContextMenu(CLOSED_CONTEXT_MENU);
    setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
    setMeetingPopover(null);
  };

  const updateComposerStart = (nextHour: number, nextMinute: number) => {
    setComposer((prev) => {
      if (!prev) return prev;

      const startTotal = nextHour * 60 + nextMinute;
      const endTotal = prev.endHour * 60 + prev.endMinute;
      if (endTotal > startTotal) {
        return {
          ...prev,
          startHour: nextHour,
          startMinute: nextMinute,
        };
      }

      const bumpedEnd = Math.min(startTotal + 60, 23 * 60 + 55);
      return {
        ...prev,
        startHour: nextHour,
        startMinute: nextMinute,
        endHour: Math.floor(bumpedEnd / 60),
        endMinute: bumpedEnd % 60,
      };
    });
  };

  const handleCreateEvent = async () => {
    if (!composer) return;
    if (!token) {
      toast.error(tr(language, "Session expired. Please sign in again", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"));
      return;
    }

    const effectiveDoctorId = isDoctorUser
      ? currentUserId || composer.doctorId
      : composer.doctorId || defaultDoctorId;

    if (!composer.patientId || !effectiveDoctorId) {
      toast.error(
        tr(
          language,
          "Please select doctor and patient",
          "กรุณาเลือกแพทย์และผู้ป่วย"
        )
      );
      return;
    }

    setComposer((prev) => (prev ? { ...prev, submitting: true } : prev));

    const startDate = setMinutes(
      setHours(new Date(composer.date), composer.startHour),
      composer.startMinute
    );

    const payload: MeetingCreatePayload = {
      date_time: startDate.toISOString(),
      doctor_id: effectiveDoctorId,
      user_id: composer.patientId,
      description: composer.description.trim() || undefined,
      room: composer.room.trim() || undefined,
      note: composer.note.trim() || undefined,
    };

    try {
      const createdMeeting = await createMeeting(payload, token);
      toast.success(tr(language, "Appointment scheduled", "สร้างนัดหมายสำเร็จ"));

      setComposer(null);
      setPreviewMeeting(createdMeeting);
      setMeetingPopover(null);
      setFocusedDate(new Date(createdMeeting.date_time));

      await onMeetingCreated?.(createdMeeting);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : tr(language, "Failed to create appointment", "สร้างนัดหมายไม่สำเร็จ");
      toast.error(message);
      setComposer((prev) => (prev ? { ...prev, submitting: false } : prev));
    }
  };

  const handleUpdateMeetingFromPopover = async (
    meetingId: string,
    payload: MeetingUpdatePayload
  ) => {
    if (!token) {
      toast.error(
        tr(
          language,
          "Session expired. Please sign in again",
          "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"
        )
      );
      throw new Error("Session expired");
    }

    try {
      const updatedMeeting = await updateMeeting(meetingId, payload, token);
      setPreviewMeeting((prev) =>
        prev && prev.id === updatedMeeting.id ? { ...updatedMeeting } : prev
      );
      await onMeetingCreated?.(updatedMeeting);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : tr(
              language,
              "Failed to update appointment",
              "อัปเดตนัดหมายไม่สำเร็จ"
            );
      toast.error(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const renderMonthView = () => {
    return (
      <div className="grid h-full gap-3 grid-cols-1">
        <div>
          <div className="grid grid-cols-7 border-b border-zinc-800/90 bg-zinc-950/45">
            {weekdayLabels.map((item) => (
              <div
                key={item.key}
                className="px-2 py-2 text-center text-[11px] md:text-xs font-medium text-zinc-400"
              >
                {item.label}
              </div>
            ))}
          </div>

          <div ref={monthGridRef} className="grid grid-cols-7">
            {monthGridDays.map((day) => {
              const dateKey = formatDateKey(day);
              const dayMeetings = meetingsByDate.get(dateKey) ?? [];
              const inCurrentMonth = isSameMonth(day, activeMonth);
              const currentDay = isToday(day);
              const isDraftDay = Boolean(
                composer && isSameDay(day, composer.date)
              );
              const isGhostDraftDay = Boolean(
                draftDrag &&
                  draftDrag.mode === "month" &&
                  isSameDay(day, draftDrag.originDate)
              );

              return (
                <button
                  key={dateKey}
                  type="button"
                  data-month-date={dateKey}
                  className={cn(
                    "min-h-[78px] md:min-h-[84px] border-r border-b border-zinc-800/90 p-2 text-left align-top transition-colors last:border-r-0",
                    inCurrentMonth
                      ? "bg-zinc-900/95 hover:bg-zinc-800/70"
                      : "bg-zinc-950/70 text-zinc-500 hover:bg-zinc-900/60"
                  )}
                  onClick={() => {
                    setSelectedDate(new Date(day));
                    setMeetingPopover(null);
                  }}
                  onDoubleClick={(event) => {
                    openComposerByDoubleClick(event.clientX, event.clientY, day, 9 * 60);
                  }}
                  onContextMenu={(event) => openContextMenuForDate(event, day)}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center rounded-full px-1.5 text-[11px] md:text-xs font-medium",
                        currentDay && "bg-rose-500 px-2 py-0.5 text-white"
                      )}
                    >
                      {format(day, "d")}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {isGhostDraftDay ? (
                      <div className="pointer-events-none w-full rounded-md bg-fuchsia-500/25 px-1.5 py-1 text-left text-[10px] font-semibold text-fuchsia-100/85 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
                        <span className="truncate">
                          {composer?.description?.trim() ||
                            tr(language, "New Event", "นัดหมายใหม่")}
                        </span>
                      </div>
                    ) : null}

                    {isDraftDay ? (
                      <button
                        type="button"
                        className="w-full rounded-md bg-fuchsia-500 px-1.5 py-1 text-left text-[10px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                        onPointerDown={(event) => startDraftDrag(event, "month")}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <span className="truncate">
                          {composer?.description?.trim() ||
                            tr(language, "New Event", "นัดหมายใหม่")}
                        </span>
                      </button>
                    ) : null}

                    {dayMeetings.slice(0, MAX_VISIBLE_DAY_EVENTS).map((meeting) => {
                      const effectiveDateTime = getEffectiveDateTime(meeting);
                      return (
                        <button
                          key={meeting.id}
                          type="button"
                          className={cn(
                            "w-full cursor-grab rounded-md px-1.5 py-1 text-left text-[10px] leading-tight active:cursor-grabbing",
                            getMeetingChipClass(meeting.status)
                          )}
                          title={`${formatTimeLabel(effectiveDateTime, language)} ${getMeetingTitle(meeting, language)}`}
                          onPointerDown={(event) =>
                            startMeetingDrag(event, meeting, "month")
                          }
                          onContextMenu={(event) =>
                            openContextMenuForMeeting(event, meeting)
                          }
                          onClick={(event) => {
                            setSelectedDate(new Date(effectiveDateTime));
                            openMeetingPopover(event, meeting, "compact");
                          }}
                        >
                          <div className="flex items-center gap-1">
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                getMeetingDotClass(meeting.status)
                              )}
                            />
                            <span className="truncate">
                              {formatTimeLabel(effectiveDateTime, language)}{" "}
                              {getMeetingTitle(meeting, language)}
                            </span>
                          </div>
                        </button>
                      );
                    })}

                    {dayMeetings.length > MAX_VISIBLE_DAY_EVENTS ? (
                      <div className="px-1 text-[10px] text-zinc-400">
                        +{dayMeetings.length - MAX_VISIBLE_DAY_EVENTS} {tr(language, "more", "เพิ่มเติม")}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      </div>
    );
  };

  const renderDayView = () => {
    const timelineHeight = 24 * TIMELINE_HOUR_HEIGHT;
    const isDraftInSelectedDay = Boolean(
      composer && isSameDay(composer.date, selectedDate)
    );
    const draftStartMinutes = composer
      ? hourMinuteToMinutes(composer.startHour, composer.startMinute)
      : 0;
    const draftDurationMinutes = composer
      ? getComposerDurationMinutes(composer)
      : 60;
    const draftTop =
      (draftStartMinutes / 60) * TIMELINE_HOUR_HEIGHT + 3;
    const draftHeight = Math.max(
      DAY_EVENT_MIN_HEIGHT,
      (draftDurationMinutes / 60) * TIMELINE_HOUR_HEIGHT - 8
    );
    const isGhostDraftInSelectedDay = Boolean(
      draftDrag &&
        draftDrag.mode === "day" &&
        isSameDay(draftDrag.originDate, selectedDate)
    );
    const ghostDraftTop =
      (draftDrag ? draftDrag.originStartMinutes : 0) / 60 * TIMELINE_HOUR_HEIGHT +
      3;
    const ghostDraftHeight = Math.max(
      DAY_EVENT_MIN_HEIGHT,
      ((draftDrag ? draftDrag.durationMinutes : 60) / 60) * TIMELINE_HOUR_HEIGHT -
        8
    );
    const ghostDraftEnd = Math.min(
      23 * 60 + 55,
      (draftDrag ? draftDrag.originStartMinutes : 0) +
        (draftDrag ? draftDrag.durationMinutes : 60)
    );
    const ghostDraftEndParts = minutesToHourMinute(ghostDraftEnd);

    return (
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 overflow-hidden">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h4 className="text-sm font-semibold text-zinc-100">
              {selectedDate.toLocaleDateString(localeOf(language), {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </h4>
          </div>

          <div className="h-[460px] overflow-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div
              ref={dayTimelineRef}
              className="relative"
              style={{ height: timelineHeight }}
              onDoubleClick={(event) => {
                const timeline = dayTimelineRef.current;
                if (!timeline) return;
                const rect = timeline.getBoundingClientRect();
                const minuteRaw =
                  ((event.clientY - rect.top) / TIMELINE_HOUR_HEIGHT) * 60;
                openComposerByDoubleClick(
                  event.clientX,
                  event.clientY,
                  selectedDate,
                  minuteRaw
                );
              }}
            >
              {TIME_PICKER_HOURS.map((hour) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 border-b border-zinc-800/80"
                  style={{
                    top: hour * TIMELINE_HOUR_HEIGHT,
                    height: TIMELINE_HOUR_HEIGHT,
                  }}
                  onContextMenu={(event) => {
                    const rowRect = (
                      event.currentTarget as HTMLDivElement
                    ).getBoundingClientRect();
                    const minuteOffset = roundTo5Minutes(
                      ((event.clientY - rowRect.top) / TIMELINE_HOUR_HEIGHT) *
                        60
                    );
                    const startMinute = Math.min(55, Math.max(0, minuteOffset));
                    openContextMenuForDate(
                      event,
                      selectedDate,
                      hour,
                      startMinute
                    );
                  }}
                >
                  <span className="absolute left-3 -translate-y-1/2 top-0 text-[10px] text-zinc-500">
                    {pad2(hour)}:00
                  </span>
                </div>
              ))}
              <button
                type="button"
                className="absolute bottom-0 left-3 translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300"
                onClick={(event) => {
                  event.stopPropagation();
                  setFocusedDate(addDays(selectedDate, 1));
                  setContextMenu(CLOSED_CONTEXT_MENU);
                  setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
                  setMeetingPopover(null);
                }}
              >
                00:00
              </button>

              {isToday(selectedDate) ? (
                <div
                  className="absolute left-[70px] right-0 z-20 pointer-events-none"
                  style={{ top: nowTop }}
                >
                  <div className="flex items-center">
                    <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-medium text-white -ml-12">
                      {now.toLocaleTimeString(localeOf(language), {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </span>
                    <div className="h-[2px] flex-1 bg-rose-500" />
                  </div>
                </div>
              ) : null}

              {selectedDayMeetings.map((meeting) => {
                const effectiveDateTime = getEffectiveDateTime(meeting);
                const top =
                  (getMeetingStartMinutes(effectiveDateTime) / 60) *
                    TIMELINE_HOUR_HEIGHT +
                  3;
                const height = Math.max(DAY_EVENT_MIN_HEIGHT, TIMELINE_HOUR_HEIGHT - 8);
                return (
                  <button
                    key={meeting.id}
                    type="button"
                    className={cn(
                      "absolute left-[72px] right-3 cursor-grab rounded-lg px-2.5 py-1.5 text-left text-[11px] shadow-sm active:cursor-grabbing",
                      getMeetingChipClass(meeting.status)
                    )}
                    style={{ top, height }}
                    onPointerDown={(event) =>
                      startMeetingDrag(event, meeting, "day")
                    }
                    onContextMenu={(event) =>
                      openContextMenuForMeeting(event, meeting)
                    }
                    onClick={(event) => openMeetingPopover(event, meeting, "detail")}
                  >
                    <div className="font-medium truncate">
                      {getMeetingTitle(meeting, language)}
                    </div>
                    <div className="mt-0.5 text-[10px] opacity-90">
                      {formatTimeLabel(effectiveDateTime, language)}
                    </div>
                  </button>
                );
              })}

              {isGhostDraftInSelectedDay ? (
                <div
                  className="pointer-events-none absolute left-[72px] right-3 rounded-lg bg-fuchsia-500/25 px-2.5 py-1.5 text-left text-[11px] font-semibold text-fuchsia-100/85 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]"
                  style={{ top: ghostDraftTop, height: ghostDraftHeight }}
                >
                  <div className="truncate">
                    {composer?.description?.trim() ||
                      tr(language, "New Event", "นัดหมายใหม่")}
                  </div>
                  <div className="mt-0.5 text-[10px] text-fuchsia-100/75">
                    {pad2(Math.floor((draftDrag?.originStartMinutes ?? 0) / 60))}:
                    {pad2((draftDrag?.originStartMinutes ?? 0) % 60)}
                    {" - "}
                    {pad2(ghostDraftEndParts.hour)}:{pad2(ghostDraftEndParts.minute)}
                  </div>
                </div>
              ) : null}

              {isDraftInSelectedDay ? (
                <button
                  type="button"
                  className="absolute left-[72px] right-3 rounded-lg bg-fuchsia-500 px-2.5 py-1.5 text-left text-[11px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                  style={{ top: draftTop, height: draftHeight }}
                  onPointerDown={(event) => startDraftDrag(event, "day")}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <div className="truncate">
                    {composer?.description?.trim() ||
                      tr(language, "New Event", "นัดหมายใหม่")}
                  </div>
                  <div className="mt-0.5 text-[10px] text-white/90">
                    {pad2(composer?.startHour ?? 0)}:{pad2(composer?.startMinute ?? 0)}
                    {" - "}
                    {pad2(composer?.endHour ?? 0)}:{pad2(composer?.endMinute ?? 0)}
                  </div>
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <MiniMonthNavigator
            baseDate={selectedDate}
            selectedDate={selectedDate}
            onSelectDate={(date) => setFocusedDate(date)}
            meetingsByDate={meetingsByDate}
            language={language}
          />

          <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900/90 text-sm text-zinc-500">
            {tr(language, "No Event Selected", "ยังไม่ได้เลือกรายการ")}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const timelineHeight = 24 * TIMELINE_HOUR_HEIGHT;
    const draftDurationMinutes = composer
      ? getComposerDurationMinutes(composer)
      : 60;

    return (
      <div className="grid gap-3 grid-cols-1">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 overflow-hidden">
          <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-zinc-800 bg-zinc-950/35">
            <div />
            {weekDays.map((day) => (
              <button
                key={formatDateKey(day)}
                type="button"
                className={cn(
                  "border-l border-zinc-800 px-1 py-2 text-center text-[11px] font-medium text-zinc-200"
                )}
                onClick={() => setFocusedDate(day)}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span>
                    {day.toLocaleDateString(localeOf(language), {
                      weekday: "short",
                    })}
                  </span>
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full",
                      isToday(day) ? "bg-rose-500 font-semibold text-white" : "text-zinc-200"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-zinc-800/80 bg-zinc-950/45">
            <div className="px-2 py-1.5 text-[11px] text-zinc-400">
              {tr(language, "all-day", "ทั้งวัน")}
            </div>
            {weekDays.map((day) => {
              const dayMeetings = meetingsByDate.get(formatDateKey(day)) ?? [];
              const allDayPreview = dayMeetings.slice(0, 1);

              return (
                <div
                  key={`week-all-day-${formatDateKey(day)}`}
                  className="min-h-8 border-l border-zinc-800/80 p-0.5"
                >
                  {allDayPreview.map((meeting) => {
                    const effectiveDateTime = getEffectiveDateTime(meeting);
                    return (
                      <button
                        key={`all-day-${meeting.id}`}
                        type="button"
                        className={cn(
                          "w-full rounded-md px-1.5 py-1 text-left text-[10px] leading-tight",
                          getMeetingChipClass(meeting.status)
                        )}
                        onContextMenu={(event) =>
                          openContextMenuForMeeting(event, meeting)
                        }
                        onClick={(event) => {
                          setFocusedDate(new Date(effectiveDateTime));
                          openMeetingPopover(event, meeting, "compact");
                        }}
                      >
                        <span className="truncate block">
                          {getMeetingTitle(meeting, language)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="h-[460px] overflow-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div
              ref={weekGridRef}
              className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]"
              style={{ height: timelineHeight }}
            >
              <div className="relative border-r border-zinc-800">
                {TIME_PICKER_HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-b border-zinc-800/80 px-2"
                    style={{ height: TIMELINE_HOUR_HEIGHT }}
                  >
                    <span className="relative -top-2 text-[10px] text-zinc-500">
                      {pad2(hour)}:00
                    </span>
                  </div>
                ))}
              </div>

                {weekDays.map((day) => {
                  const dayMeetings = meetingsByDate.get(formatDateKey(day)) ?? [];
                  const isDraftDay = Boolean(composer && isSameDay(composer.date, day));
                  const isGhostDraftDay = Boolean(
                    draftDrag &&
                      draftDrag.mode === "week" &&
                      isSameDay(draftDrag.originDate, day)
                  );
                  const draftStartMinutes = composer
                    ? hourMinuteToMinutes(composer.startHour, composer.startMinute)
                    : 0;
                  const draftTop =
                    (draftStartMinutes / 60) * TIMELINE_HOUR_HEIGHT + 3;
                  const draftHeight = Math.max(
                    DAY_EVENT_MIN_HEIGHT,
                    (draftDurationMinutes / 60) * TIMELINE_HOUR_HEIGHT - 8
                  );
                  const ghostTop =
                    (draftDrag ? draftDrag.originStartMinutes : 0) / 60 *
                      TIMELINE_HOUR_HEIGHT +
                    3;
                  const ghostHeight = Math.max(
                    DAY_EVENT_MIN_HEIGHT,
                    ((draftDrag ? draftDrag.durationMinutes : 60) / 60) *
                      TIMELINE_HOUR_HEIGHT -
                      8
                  );
                  const ghostEnd = Math.min(
                    23 * 60 + 55,
                    (draftDrag ? draftDrag.originStartMinutes : 0) +
                      (draftDrag ? draftDrag.durationMinutes : 60)
                  );
                  const ghostEndParts = minutesToHourMinute(ghostEnd);
                  return (
                    <div
                      key={`week-col-${formatDateKey(day)}`}
                      className="relative border-r border-zinc-800 last:border-r-0"
                    >
                    {TIME_PICKER_HOURS.map((hour) => (
                      <div
                        key={`${formatDateKey(day)}-${hour}`}
                        className="border-b border-zinc-800/80"
                        style={{ height: TIMELINE_HOUR_HEIGHT }}
                        onContextMenu={(event) => {
                          const rowRect = (
                            event.currentTarget as HTMLDivElement
                          ).getBoundingClientRect();
                          const minuteOffset = roundTo5Minutes(
                            ((event.clientY - rowRect.top) /
                              TIMELINE_HOUR_HEIGHT) *
                              60
                          );
                          const startMinute = Math.min(
                            55,
                            Math.max(0, minuteOffset)
                          );
                          openContextMenuForDate(
                            event,
                            day,
                            hour,
                            startMinute
                          );
                        }}
                        onDoubleClick={(event) => {
                          const slotRect = (
                            event.currentTarget as HTMLDivElement
                          ).getBoundingClientRect();
                          const minuteRaw =
                            hour * 60 +
                            ((event.clientY - slotRect.top) /
                              TIMELINE_HOUR_HEIGHT) *
                              60;
                          openComposerByDoubleClick(
                            event.clientX,
                            event.clientY,
                            day,
                            minuteRaw
                          );
                        }}
                      />
                    ))}

                    {isToday(day) ? (
                      <div
                        className="absolute left-0 right-0 z-20 pointer-events-none"
                        style={{ top: nowTop }}
                      >
                        <div className="h-[2px] bg-rose-500" />
                      </div>
                    ) : null}

                    {dayMeetings.map((meeting) => {
                      const effectiveDateTime = getEffectiveDateTime(meeting);
                      const top =
                        (getMeetingStartMinutes(effectiveDateTime) / 60) *
                          TIMELINE_HOUR_HEIGHT +
                        3;
                      const height = Math.max(
                        DAY_EVENT_MIN_HEIGHT,
                        TIMELINE_HOUR_HEIGHT - 8
                      );

                      return (
                        <button
                          key={meeting.id}
                          type="button"
                          className={cn(
                            "absolute left-1 right-1 cursor-grab rounded-md px-1.5 py-1 text-left text-[10px] active:cursor-grabbing",
                            getMeetingChipClass(meeting.status)
                          )}
                          style={{ top, height }}
                          onPointerDown={(event) =>
                            startMeetingDrag(event, meeting, "week")
                          }
                          onContextMenu={(event) =>
                            openContextMenuForMeeting(event, meeting)
                          }
                          onClick={(event) => {
                            setFocusedDate(new Date(effectiveDateTime));
                            openMeetingPopover(event, meeting, "detail");
                          }}
                        >
                          <div className="truncate font-medium">
                            {getMeetingTitle(meeting, language)}
                          </div>
                          <div className="truncate opacity-85">
                            {formatTimeLabel(effectiveDateTime, language)}
                          </div>
                        </button>
                      );
                    })}

                    {isGhostDraftDay ? (
                      <div
                        className="pointer-events-none absolute left-1 right-1 rounded-md bg-fuchsia-500/25 px-1.5 py-1 text-left text-[10px] font-semibold text-fuchsia-100/85 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]"
                        style={{ top: ghostTop, height: ghostHeight }}
                      >
                        <div className="truncate">
                          {composer?.description?.trim() ||
                            tr(language, "New Event", "นัดหมายใหม่")}
                        </div>
                        <div className="truncate text-[9px] text-fuchsia-100/75">
                          {pad2(Math.floor((draftDrag?.originStartMinutes ?? 0) / 60))}:
                          {pad2((draftDrag?.originStartMinutes ?? 0) % 60)}
                          {" - "}
                          {pad2(ghostEndParts.hour)}:{pad2(ghostEndParts.minute)}
                        </div>
                      </div>
                    ) : null}

                    {isDraftDay ? (
                      <button
                        type="button"
                        className="absolute left-1 right-1 rounded-md bg-fuchsia-500 px-1.5 py-1 text-left text-[10px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                        style={{ top: draftTop, height: draftHeight }}
                        onPointerDown={(event) => startDraftDrag(event, "week")}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <div className="truncate">
                          {composer?.description?.trim() ||
                            tr(language, "New Event", "นัดหมายใหม่")}
                        </div>
                        <div className="truncate text-[9px] text-white/90">
                          {pad2(composer?.startHour ?? 0)}:{pad2(composer?.startMinute ?? 0)}
                        </div>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderYearView = () => {
    const yearStart = startOfYear(activeMonth);
    const months = Array.from({ length: 12 }, (_, index) =>
      startOfMonth(addMonths(yearStart, index))
    );

    return (
      <div className="grid h-full auto-rows-fr grid-cols-2 gap-2 lg:grid-cols-4">
        {months.map((monthStart) => {
          const days = buildMonthGridDays(monthStart);
          return (
            <div
              key={monthStart.toISOString()}
              className="flex h-full min-h-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900/90 p-2"
              onDoubleClick={() => {
                clearFloatingPanels();
                setViewMode("month");
                setActiveMonth(startOfMonth(monthStart));
                setSelectedDate(startOfMonth(monthStart));
              }}
            >
              <h4 className="mb-1.5 text-sm font-medium text-rose-400 lg:text-base">
                {monthStart.toLocaleDateString(localeOf(language), { month: "long" })}
              </h4>

              <div className="grid grid-cols-7 gap-0.5">
                {weekdayLabels.map((item) => (
                  <div
                    key={`${monthStart.toISOString()}-${item.key}`}
                    className="text-center text-[8px] text-zinc-500"
                  >
                    {item.label.slice(0, 1).toUpperCase()}
                  </div>
                ))}

                {days.map((day) => {
                  const key = formatDateKey(day);
                  const inCurrentMonth = isSameMonth(day, monthStart);
                  const hasMeetings = (meetingsByDate.get(key)?.length ?? 0) > 0;
                  const selected = isSameDay(day, selectedDate);

                  return (
                    <button
                      key={`${monthStart.toISOString()}-${key}`}
                      type="button"
                      className={cn(
                        "relative h-4 rounded text-[9px] transition-colors sm:h-5",
                        inCurrentMonth
                          ? "text-zinc-200 hover:bg-zinc-800"
                          : "text-zinc-600 hover:bg-zinc-900/60",
                        isToday(day) && "text-rose-400",
                        selected && "bg-zinc-200 text-zinc-900 hover:bg-zinc-200"
                      )}
                      onClick={(event) => {
                        setSelectedDate(new Date(day));
                        const dayMeetings = meetingsByDate.get(key) ?? [];
                        if (dayMeetings.length === 0) {
                          setPreviewMeeting(null);
                          setMeetingPopover(null);
                          return;
                        }
                        const first = dayMeetings[0];
                        openMeetingPopover(event, first, "compact");
                      }}
                      onContextMenu={(event) => openContextMenuForDate(event, day)}
                    >
                      {format(day, "d")}
                      {hasMeetings ? (
                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-fuchsia-400" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const composerDoctorId = composer
    ? isDoctorUser
      ? currentUserId || composer.doctorId
      : composer.doctorId || defaultDoctorId
    : "";

  const canSubmitComposer = Boolean(
    composer &&
      composer.patientId &&
      composerDoctorId &&
      !composer.submitting
  );

  const isMonthOrYearView = viewMode === "month" || viewMode === "year";
  const popupSizeClass =
    viewMode === "day" || viewMode === "week"
      ? "w-[min(94vw,1020px)]"
      : "h-[min(86vh,760px)] w-[min(94vw,980px)]";

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setContextMenu(CLOSED_CONTEXT_MENU);
          setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
          setComposer(null);
          setDraftDrag(null);
          setMeetingDrag(null);
          setMeetingDateOverrides({});
          setPreviewMeeting(null);
          setMeetingPopover(null);
          setViewMode("month");
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="size-7 md:size-8 shrink-0 md:w-auto md:px-2 md:gap-1.5"
          >
            <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
            <span className="hidden lg:inline text-xs">
              {tr(language, "Calendar Popup", "ปฏิทินป๊อปอัป")}
            </span>
          </Button>
        }
      />

      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          popupSizeClass,
          isMonthOrYearView
            ? "overflow-hidden"
            : "max-h-[86vh] overflow-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          "rounded-2xl border border-zinc-700 bg-zinc-900/95 p-0 text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl"
        )}
      >
        <div
          ref={popupContainerRef}
          className="relative flex h-full flex-col bg-[radial-gradient(circle_at_30%_-20%,rgba(255,255,255,0.08),transparent_35%),linear-gradient(180deg,rgba(38,38,42,0.9)_0%,rgba(24,24,27,0.96)_100%)]"
          onPointerDown={() => {
            setContextMenu(CLOSED_CONTEXT_MENU);
            setMeetingContextMenu(CLOSED_MEETING_CONTEXT_MENU);
            setMeetingPopover(null);
          }}
        >
          <div className="sticky top-0 z-40 border-b border-zinc-800/90 bg-zinc-900/95 p-4 backdrop-blur-xl md:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="size-3 rounded-full bg-[#ff5f57]" />
                  <span className="size-3 rounded-full bg-[#febc2e]" />
                  <span className="size-3 rounded-full bg-[#28c840]" />
                </div>
                <div className="inline-flex items-center rounded-full border border-zinc-700/80 bg-zinc-950/70 p-1">
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-zinc-200 transition-colors hover:bg-zinc-800"
                    aria-label={tr(language, "Calendar", "ปฏิทิน")}
                  >
                    <HugeiconsIcon icon={Calendar01Icon} className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-zinc-200 transition-colors hover:bg-zinc-800"
                    aria-label={tr(language, "Quick add", "เพิ่มด่วน")}
                    onClick={(event) =>
                      openComposerByDoubleClick(
                        event.clientX,
                        event.clientY,
                        selectedDate,
                        9 * 60
                      )
                    }
                  >
                    <HugeiconsIcon icon={Add01Icon} className="size-3.5" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-full border border-zinc-700/70 bg-zinc-950/60 text-zinc-300 hover:bg-zinc-800"
                aria-label={tr(language, "Search", "ค้นหา")}
              >
                <HugeiconsIcon icon={Search01Icon} className="size-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                  onClick={() => handleNavigate(-1)}
                  aria-label={tr(language, "Previous", "ก่อนหน้า")}
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                  onClick={() => handleNavigate(1)}
                  aria-label={tr(language, "Next", "ถัดไป")}
                >
                  <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full bg-zinc-800/95 px-3 text-xs text-zinc-100 hover:bg-zinc-700"
                  onClick={handleGoToday}
                >
                  {tr(language, "Today", "วันนี้")}
                </Button>
              </div>

              <div className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-950/70 p-1">
                {([
                  "day",
                  "week",
                  "month",
                  "year",
                ] as CalendarPopupView[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] md:text-xs font-medium capitalize",
                      viewMode === mode
                        ? "bg-zinc-200 text-zinc-900"
                        : "text-zinc-400 hover:text-zinc-100"
                    )}
                    onClick={() => {
                      setViewMode(mode);
                      clearFloatingPanels();
                      if (mode === "month") {
                        setActiveMonth(startOfMonth(selectedDate));
                      }
                      if (mode === "year") {
                        setActiveMonth(startOfYear(selectedDate));
                      }
                    }}
                  >
                    {tr(
                      language,
                      mode.charAt(0).toUpperCase() + mode.slice(1),
                      mode === "day"
                        ? "วัน"
                        : mode === "week"
                          ? "สัปดาห์"
                          : mode === "month"
                            ? "เดือน"
                            : "ปี"
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight">{headerTitle}</h3>
              <p className="text-[11px] md:text-xs text-zinc-400">
                {tr(
                  language,
                  "Right-click a date and choose New Event",
                  "คลิกขวาที่วันที่แล้วเลือก New Event"
                )}
              </p>
            </div>
          </div>

          <div className={cn("p-3 md:p-4", isMonthOrYearView && "min-h-0 flex-1 overflow-hidden")}>
            {viewMode === "month" ? renderMonthView() : null}
            {viewMode === "day" ? renderDayView() : null}
            {viewMode === "week" ? renderWeekView() : null}
            {viewMode === "year" ? renderYearView() : null}
          </div>

          {contextMenu.open && contextMenu.date ? (
            <div
              role="menu"
              className="absolute z-50 w-44 rounded-xl border border-zinc-500/70 bg-zinc-950/95 p-1 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-md"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg bg-rose-500/85 px-2.5 py-1.5 text-left text-sm font-medium text-white hover:bg-rose-500"
                onClick={handleNewEventAction}
              >
                <HugeiconsIcon icon={Add01Icon} className="size-3.5" />
                <span>{tr(language, "New Event", "นัดหมายใหม่")}</span>
              </button>
            </div>
          ) : null}

          {meetingContextMenu.open && meetingContextMenu.meetingId ? (
            <div
              role="menu"
              className="absolute z-[57] w-[200px] rounded-xl border border-zinc-500/70 bg-zinc-950/95 p-1 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-md"
              style={{ left: meetingContextMenu.x, top: meetingContextMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-100 hover:bg-zinc-800/80"
                onClick={confirmDeleteMeeting}
              >
                <HugeiconsIcon icon={Delete01Icon} className="size-3.5" />
                <span>{tr(language, "Delete", "ลบ")}</span>
              </button>

              <button
                type="button"
                disabled
                className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-500"
              >
                <span className="inline-block w-3.5 text-center text-[10px]">-</span>
                <span>{tr(language, "Cut", "ตัด")}</span>
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-100 hover:bg-zinc-800/80"
                onClick={() => {
                  void handleCopyMeeting();
                }}
              >
                <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
                <span>{tr(language, "Copy", "คัดลอก")}</span>
              </button>

              <button
                type="button"
                disabled
                className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-500"
              >
                <span className="inline-block w-3.5 text-center text-[10px]">-</span>
                <span>{tr(language, "Paste", "วาง")}</span>
              </button>

              <button
                type="button"
                disabled
                className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-500"
              >
                <span className="inline-block w-3.5 text-center text-[10px]">-</span>
                <span>{tr(language, "Duplicate", "ทำซ้ำ")}</span>
              </button>
            </div>
          ) : null}

          {meetingPopover && meetingForPopover ? (
            <div
              className={cn(
                "absolute z-[55] rounded-2xl border border-zinc-600/70 bg-zinc-900/95 p-3 shadow-[0_24px_64px_rgba(0,0,0,0.65)] backdrop-blur-md",
                meetingPopover.side === "right"
                  ? "before:absolute before:-left-1.5 before:top-[var(--arrow-y)] before:size-3 before:-translate-y-1/2 before:rotate-45 before:border-b before:border-l before:border-zinc-600/70 before:bg-zinc-900/95"
                  : "after:absolute after:-right-1.5 after:top-[var(--arrow-y)] after:size-3 after:-translate-y-1/2 after:rotate-45 after:border-t after:border-r after:border-zinc-600/70 after:bg-zinc-900/95",
                meetingPopover.variant === "detail" ? "w-[368px]" : "w-[304px]"
              )}
              style={
                {
                  left: meetingPopover.x,
                  top: meetingPopover.y,
                  "--arrow-y": `${meetingPopover.arrowY}px`,
                } as CSSProperties
              }
              onPointerDown={(event) => event.stopPropagation()}
            >
              <MeetingPreviewCard
                meeting={meetingForPopover}
                language={language}
                variant={meetingPopover.variant}
                onClose={() => setMeetingPopover(null)}
                onUpdateMeeting={handleUpdateMeetingFromPopover}
              />
            </div>
          ) : null}

          {composer ? (
            <div
              className="absolute z-[60] w-[min(92vw,368px)] max-h-[min(calc(100%-16px),620px)] overflow-y-auto rounded-2xl border border-zinc-600/70 bg-zinc-900/95 p-3 shadow-[0_24px_64px_rgba(0,0,0,0.65)] backdrop-blur-md [scrollbar-width:thin]"
              style={{ left: composer.anchorX, top: composer.anchorY }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="inline-flex min-w-[220px] items-center rounded-full bg-zinc-800 p-1">
                  <span className="flex-1 rounded-full bg-rose-500 px-3 py-1 text-center text-xs font-semibold text-white">
                    {tr(language, "Event", "อีเวนต์")}
                  </span>
                  <span className="flex-1 rounded-full px-3 py-1 text-center text-xs font-medium text-zinc-500">
                    {tr(language, "Reminder", "เตือนความจำ")}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  onClick={() => setComposer(null)}
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
                </Button>
              </div>

              <div className="space-y-2.5">
                <input
                  value={composer.description}
                  onChange={(event) =>
                    setComposer((prev) =>
                      prev ? { ...prev, description: event.target.value } : prev
                    )
                  }
                  placeholder={tr(language, "New Event", "ชื่อนัดหมาย")}
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
                />

                <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-2.5 text-xs text-zinc-200">
                  {composer.date.toLocaleDateString(localeOf(language), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  <span className="mx-2 text-zinc-500">•</span>
                  {pad2(composer.startHour)}:{pad2(composer.startMinute)} - {pad2(composer.endHour)}:{pad2(composer.endMinute)}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400">
                      {tr(language, "Start", "เริ่ม")}
                    </label>
                    <div className="flex gap-1">
                      <select
                        value={composer.startHour}
                        onChange={(event) =>
                          updateComposerStart(
                            Number(event.target.value),
                            composer.startMinute
                          )
                        }
                        className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-2 text-xs text-zinc-100 outline-none"
                      >
                        {TIME_PICKER_HOURS.map((hour) => (
                          <option key={`start-hour-${hour}`} value={hour}>
                            {formatHourOption(hour)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={composer.startMinute}
                        onChange={(event) =>
                          updateComposerStart(
                            composer.startHour,
                            Number(event.target.value)
                          )
                        }
                        className="h-9 w-20 rounded-lg border border-zinc-700 bg-zinc-950/80 px-2 text-xs text-zinc-100 outline-none"
                      >
                        {MINUTE_OPTIONS.map((minute) => (
                          <option key={`start-minute-${minute}`} value={minute}>
                            {pad2(minute)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400">
                      {tr(language, "End", "สิ้นสุด")}
                    </label>
                    <div className="flex gap-1">
                      <select
                        value={composer.endHour}
                        onChange={(event) =>
                          setComposer((prev) =>
                            prev
                              ? {
                                ...prev,
                                endHour: Number(event.target.value),
                              }
                              : prev
                          )
                        }
                        className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-2 text-xs text-zinc-100 outline-none"
                      >
                        {TIME_PICKER_HOURS.map((hour) => (
                          <option key={`end-hour-${hour}`} value={hour}>
                            {formatHourOption(hour)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={composer.endMinute}
                        onChange={(event) =>
                          setComposer((prev) =>
                            prev
                              ? {
                                ...prev,
                                endMinute: Number(event.target.value),
                              }
                              : prev
                          )
                        }
                        className="h-9 w-20 rounded-lg border border-zinc-700 bg-zinc-950/80 px-2 text-xs text-zinc-100 outline-none"
                      >
                        {MINUTE_OPTIONS.map((minute) => (
                          <option key={`end-minute-${minute}`} value={minute}>
                            {pad2(minute)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <HugeiconsIcon icon={Stethoscope02Icon} className="size-3.5" />
                    {tr(language, "Doctor", "แพทย์")}
                  </label>
                  <select
                    value={isDoctorUser ? currentUserId || composer.doctorId : composerDoctorId}
                    onChange={(event) =>
                      setComposer((prev) =>
                        prev ? { ...prev, doctorId: event.target.value } : prev
                      )
                    }
                    disabled={isDoctorUser}
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-2 text-xs text-zinc-100 outline-none disabled:opacity-65"
                  >
                    {doctors.length === 0 ? (
                      <option value="">{tr(language, "No doctors", "ไม่พบแพทย์")}</option>
                    ) : null}
                    {doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        Dr. {doctor.first_name || ""} {doctor.last_name || ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <HugeiconsIcon icon={UserIcon} className="size-3.5" />
                    {tr(language, "Patient", "ผู้ป่วย")}
                  </label>
                  <select
                    value={composer.patientId}
                    onChange={(event) =>
                      setComposer((prev) =>
                        prev ? { ...prev, patientId: event.target.value } : prev
                      )
                    }
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-2 text-xs text-zinc-100 outline-none"
                  >
                    <option value="">{tr(language, "Select patient", "เลือกผู้ป่วย")}</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.first_name} {patient.last_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <HugeiconsIcon icon={DoorIcon} className="size-3.5" />
                    {tr(language, "Room / Meeting Link", "ห้อง / ลิงก์ประชุม")}
                  </label>
                  <input
                    value={composer.room}
                    onChange={(event) =>
                      setComposer((prev) =>
                        prev ? { ...prev, room: event.target.value } : prev
                      )
                    }
                    placeholder={tr(language, "Room 101 or https://...", "ห้อง 101 หรือ https://...")}
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <HugeiconsIcon icon={NoteIcon} className="size-3.5" />
                    {tr(language, "Notes", "หมายเหตุ")}
                  </label>
                  <textarea
                    value={composer.note}
                    onChange={(event) =>
                      setComposer((prev) =>
                        prev ? { ...prev, note: event.target.value } : prev
                      )
                    }
                    rows={3}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none resize-none"
                    placeholder={tr(language, "Additional details", "รายละเอียดเพิ่มเติม")}
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 border-zinc-600 bg-zinc-900 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
                  onClick={() => setComposer(null)}
                >
                  {tr(language, "Cancel", "ยกเลิก")}
                </Button>
                <Button
                  type="button"
                  className="h-8 bg-rose-500 px-3 text-xs text-white hover:bg-rose-600 disabled:opacity-65"
                  onClick={handleCreateEvent}
                  disabled={!canSubmitComposer}
                >
                  <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
                  {composer.submitting
                    ? tr(language, "Saving...", "กำลังบันทึก...")
                    : tr(language, "Create Event", "สร้างนัดหมาย")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
