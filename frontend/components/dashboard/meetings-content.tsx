"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addMonths, addWeeks, isSameMonth } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Add01Icon,
  ProfileIcon,
  Cancel01Icon,
  Briefcase01Icon,
  PaintBoardIcon,
  Database01Icon,
  QuillWrite01Icon,
  Calendar01Icon,
  FilterIcon,
  Clock01Icon,
  UserIcon,
  Stethoscope02Icon,
  DoorIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowDown01Icon,
  Notification01Icon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { CalendarView, type CalendarSlotSelection } from "./calendar-view";
import { MonthCalendarView } from "./month-calendar-view";
import { useCalendarStore } from "@/store/calendar-store";
import { useAuthStore } from "@/store/auth-store";
import {
  canWriteClinicalData,
  fetchAllMeetings,
  fetchAllPatients,
  fetchPatients,
  createMeeting,
  updateMeeting,
  fetchUsers,
  fetchCurrentUser,
  getErrorMessage,
  type Meeting,
  type Patient,
  type User,
  type MeetingCreatePayload,
  type MeetingUpdatePayload,
} from "@/lib/api";
import { getMeetingLinkMode, resolveMeetingRoomValue } from "./meeting-link";
import { toast } from "@/components/ui/toast";
import { includesSearchQuery, normalizeSearchText } from "@/lib/search";
import {
  combineLocalDateAndTimeToIso,
  formatLocalDateKey,
  parseLocalDateKey,
} from "@/lib/meeting-datetime";
import { getPresenceAwareStatus } from "./meeting-presence";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import {
  scheduleZegoUIKitPreload,
} from "@/lib/zego-uikit";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";
const formatDateLabel = (
  date: Date,
  language: AppLanguage,
  options: Intl.DateTimeFormatOptions
) => date.toLocaleDateString(localeOf(language), options);

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

function formatDoctorDisplayName(doctor: Pick<User, "first_name" | "last_name" | "email">): string {
  const fullName = `${doctor.first_name || ""} ${doctor.last_name || ""}`.trim();
  return fullName || doctor.email;
}

function formatPatientDisplayName(patient: Pick<Patient, "first_name" | "last_name" | "email" | "id">): string {
  const fullName = `${patient.first_name || ""} ${patient.last_name || ""}`.trim();
  return fullName || patient.email || patient.id;
}

const ACTIVE_MEETING_REFRESH_INTERVAL_MS = 5_000;
const NEAR_MEETING_REFRESH_INTERVAL_MS = 10_000;
const IDLE_MEETING_REFRESH_INTERVAL_MS = 30_000;
const NEAR_MEETING_WINDOW_MS = 15 * 60 * 1_000;

const AnimatedCalendar = dynamic(
  () =>
    import("@/components/ui/calender").then((module) => ({
      default: module.AnimatedCalendar,
    })),
  {
    loading: () => (
      <div className="h-10 w-full rounded-md border bg-muted/60 animate-pulse" />
    ),
    ssr: false,
  }
);

const AnimatedCalendarStandalone = dynamic(
  () =>
    import("@/components/ui/calender").then((module) => ({
      default: module.AnimatedCalendarStandalone,
    })),
  {
    loading: () => (
      <div className="h-[340px] w-[328px] rounded-[26px] border border-slate-200/80 bg-white/90 animate-pulse" />
    ),
    ssr: false,
  }
);

const QueueView = dynamic(
  () =>
    import("./queue-view").then((module) => ({
      default: module.QueueView,
    })),
  {
    loading: () => (
      <div className="flex-1 px-4 py-4">
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-[320px] w-full rounded-xl" />
        </div>
      </div>
    ),
    ssr: false,
  }
);

function isJoinableMeetingStatus(status: Meeting["status"]): boolean {
  return status !== "completed" && status !== "cancelled";
}

function isActivelyWaitingMeeting(meeting: Meeting): boolean {
  const effectiveStatus = getPresenceAwareStatus(meeting);
  if (!isJoinableMeetingStatus(effectiveStatus)) {
    return false;
  }

  const presenceState = meeting.room_presence?.state;
  if (
    presenceState === "patient_waiting" ||
    presenceState === "doctor_left_patient_waiting" ||
    presenceState === "doctor_only" ||
    presenceState === "both_in_room"
  ) {
    return true;
  }

  return effectiveStatus === "waiting" || effectiveStatus === "in_progress";
}

function isNearMeetingWindow(meeting: Meeting, now: number): boolean {
  if (!isJoinableMeetingStatus(meeting.status) || isActivelyWaitingMeeting(meeting)) {
    return false;
  }

  const meetingTime = new Date(meeting.date_time).getTime();
  if (Number.isNaN(meetingTime)) {
    return false;
  }

  const millisecondsUntilMeeting = meetingTime - now;
  return (
    millisecondsUntilMeeting >= -NEAR_MEETING_WINDOW_MS &&
    millisecondsUntilMeeting <= NEAR_MEETING_WINDOW_MS
  );
}

function resolveDoctorRoleType(value: string): DoctorPickerItem["roleType"] {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("cardio") ||
    normalized.includes("surg") ||
    normalized.includes("consult") ||
    normalized.includes("special")
  ) {
    return "creator";
  }
  if (
    normalized.includes("resident") ||
    normalized.includes("intern") ||
    normalized.includes("fellow")
  ) {
    return "designer";
  }
  if (
    normalized.includes("department") ||
    normalized.includes("ward") ||
    normalized.includes("unit")
  ) {
    return "data";
  }
  return "pm";
}

interface PickerCommandItem {
  id: string;
  label: string;
  description?: string;
}

interface DoctorPickerItem extends PickerCommandItem {
  online: boolean;
  role: string;
  status: string;
  roleType: "pm" | "designer" | "data" | "creator";
  avatar?: string;
}

interface PatientPickerItem extends PickerCommandItem {
  active: boolean;
  status: string;
  avatar?: string;
}

interface CreateEventDraft {
  selectedDateKey: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  patientId: string;
  doctorId: string;
  description: string;
  room: string;
  note: string;
}

function getCreateEventDraftKey(userId: string | null): string {
  return `meetings-create-event-draft:${userId ?? "anonymous"}`;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function readCreateEventDraft(userId: string | null): CreateEventDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(getCreateEventDraftKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const draft = parsed as Partial<CreateEventDraft> & {
      selectedDateISO?: string;
    };
    const selectedDateKey =
      typeof draft.selectedDateKey === "string"
        ? draft.selectedDateKey
        : typeof draft.selectedDateISO === "string"
          ? formatLocalDateKey(new Date(draft.selectedDateISO))
          : null;
    if (!selectedDateKey) return null;

    const parsedDate = parseLocalDateKey(selectedDateKey);
    if (!parsedDate) return null;

    const startHour = clampInt(draft.startHour, 9, 0, 23);
    const startMinute = clampInt(draft.startMinute, 0, 0, 59);
    const fallbackEndHour = Math.min(startHour + 1, 23);
    const endHour = clampInt(draft.endHour, fallbackEndHour, 0, 23);
    const endMinute = clampInt(draft.endMinute, startMinute, 0, 59);

    return {
      selectedDateKey,
      startHour,
      startMinute,
      endHour,
      endMinute,
      patientId: typeof draft.patientId === "string" ? draft.patientId : "",
      doctorId: typeof draft.doctorId === "string" ? draft.doctorId : "",
      description: typeof draft.description === "string" ? draft.description : "",
      room: typeof draft.room === "string" ? draft.room : "",
      note: typeof draft.note === "string" ? draft.note : "",
    };
  } catch {
    return null;
  }
}

function writeCreateEventDraft(userId: string | null, draft: CreateEventDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getCreateEventDraftKey(userId), JSON.stringify(draft));
  } catch {
    // no-op
  }
}

function clearCreateEventDraft(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getCreateEventDraftKey(userId));
  } catch {
    // no-op
  }
}

function PatientDirectoryDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  items,
  selectedId,
  loading,
  onSelect,
  language,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  items: PatientPickerItem[];
  selectedId?: string;
  loading: boolean;
  onSelect: (item: PatientPickerItem) => void;
  language: AppLanguage;
}) {
  const [expanded, setExpanded] = useState(false);
  const filteredAllPatients = useMemo(
    () => {
      const normalizedQuery = normalizeSearchText(query);
      if (!normalizedQuery) return items;
      return items.filter(
        (patient) =>
          includesSearchQuery(patient.label, query) ||
          includesSearchQuery(patient.status, query) ||
          includesSearchQuery(patient.description || "", query)
      );
    },
    [items, query]
  );
  const activeItems = useMemo(
    () => items.filter((item) => item.active),
    [items]
  );
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setExpanded(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );
  const handlePatientSelect = useCallback(
    (patient: PatientPickerItem) => {
      onSelect(patient);
      handleOpenChange(false);
    },
    [onSelect, handleOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-muted/50" showCloseButton={false}>
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="text-sm font-semibold text-foreground">
            {tr(language, "Select Patient", "เลือกผู้ป่วย")}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl text-muted-foreground"
            onClick={() => handleOpenChange(false)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2.2} />
          </Button>
        </div>

        <div className="p-4">
          <div className="relative w-full rounded-[28px] border border-border bg-background pb-5">
            <div className="px-6 pb-3 pt-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                  {tr(language, "Active Patients", "ผู้ป่วยที่พร้อมติดต่อ")}
                  <span className="mt-0.5 rounded-full bg-muted px-2 py-1 text-xs font-normal leading-none text-muted-foreground">
                    {activeItems.length}
                  </span>
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full border-border/50 text-muted-foreground hover:bg-muted/50"
                  onClick={() => setExpanded((prev) => !prev)}
                >
                  <HugeiconsIcon icon={Add01Icon} size={18} strokeWidth={2.5} />
                </Button>
              </div>

              <div className="relative mb-4">
                <HugeiconsIcon
                  icon={Search01Icon}
                  className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60"
                  size={16}
                />
                <Input
                  placeholder={tr(language, "Search patients...", "ค้นหาผู้ป่วย...")}
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  className="h-11 w-full rounded-2xl border-none bg-muted/40 pl-11 pr-4 text-base text-foreground placeholder:text-muted-foreground/50 box-border transition-all focus-visible:ring-1 focus-visible:ring-border"
                />
              </div>
            </div>

            <div className="max-h-[280px] overflow-y-auto px-6 pb-20">
              <motion.div
                initial={false}
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
                className="space-y-0.5"
              >
                {loading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {tr(language, "Searching patients...", "กำลังค้นหาผู้ป่วย...")}
                  </p>
                ) : activeItems.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {tr(language, "No active patients found.", "ไม่พบผู้ป่วยที่พร้อมติดต่อ")}
                  </p>
                ) : (
                  activeItems.map((patient) => (
                    <PatientMemberItem
                      key={`active-${patient.id}`}
                      member={patient}
                      selectedId={selectedId}
                      onSelect={handlePatientSelect}
                    />
                  ))
                )}
              </motion.div>
            </div>

            <motion.div
              layout
              initial={false}
              animate={{
                height: expanded ? "calc(100% - 20px)" : "68px",
                width: expanded ? "calc(100% - 20px)" : "calc(100% - 40px)",
                bottom: expanded ? "10px" : "20px",
                left: expanded ? "10px" : "20px",
                borderRadius: expanded ? "32px" : "24px",
              }}
              transition={{
                type: "spring",
                stiffness: 240,
                damping: 30,
                mass: 0.8,
                ease: "easeInOut",
              }}
              className="group/bar absolute z-50 flex flex-col overflow-hidden border border-border bg-card shadow-none"
              style={{ cursor: expanded ? "default" : "pointer" }}
              onClick={() => !expanded && setExpanded(true)}
            >
              <div
                className={cn(
                  "flex h-[68px] shrink-0 items-center justify-between px-3 transition-colors",
                  expanded ? "border-b border-border/40" : "hover:bg-muted/20"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground/80 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-transform group-hover/bar:scale-105">
                    <HugeiconsIcon icon={ProfileIcon} size={20} strokeWidth={2} />
                  </div>
                  <motion.div layout="position">
                    <h4 className="text-base font-medium leading-none tracking-tight text-foreground">
                      {tr(language, "Patient Directory", "ไดเรกทอรีผู้ป่วย")}
                    </h4>
                    <p className="mt-1 text-xs font-normal leading-none text-muted-foreground">
                      {tr(
                        language,
                        `${items.length} patients registered`,
                        `มีผู้ป่วยในระบบ ${items.length} คน`
                      )}
                    </p>
                  </motion.div>
                </div>

                <div className="flex items-center gap-3">
                  {!expanded && (
                    <div className="flex items-center gap-0">
                      <div className="flex -space-x-3">
                        {items.slice(0, 3).map((patient) => (
                          <motion.div
                            key={`sum-${patient.id}`}
                            layoutId={`patient-avatar-${patient.id}`}
                            className="flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-background bg-muted text-[11px] font-semibold text-muted-foreground shadow-sm"
                          >
                            {getNameInitials(patient.label)}
                          </motion.div>
                        ))}
                        <div className="relative z-0 flex h-10 w-10 items-center justify-center rounded-full bg-muted shadow-sm ring-1 ring-background">
                          <span className="text-sm font-normal leading-none text-muted-foreground">
                            +{Math.max(items.length - 3, 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {expanded && (
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground transition-all hover:text-foreground active:scale-90"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpanded(false);
                      }}
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={18}
                        strokeWidth={2.5}
                      />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-1 flex-col overflow-hidden">
                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="px-5 py-4"
                    >
                      <div className="relative">
                        <HugeiconsIcon
                          icon={Search01Icon}
                          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/50"
                          size={15}
                        />
                        <Input
                          placeholder={tr(language, "Search patients...", "ค้นหาผู้ป่วย...")}
                          value={query}
                          onChange={(event) => onQueryChange(event.target.value)}
                          className="h-10 w-full rounded-xl border-none bg-muted/30 pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 box-border transition-all focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex-1 overflow-y-auto px-5 py-2">
                  <motion.div
                    initial="hidden"
                    animate={expanded ? "visible" : "hidden"}
                    variants={{
                      visible: {
                        transition: { staggerChildren: 0.03, delayChildren: 0.1 },
                      },
                      hidden: {
                        transition: { staggerChildren: 0.02, staggerDirection: -1 },
                      },
                    }}
                    className="space-y-0.5"
                  >
                    {filteredAllPatients.map((patient) => (
                      <PatientMemberItem
                        key={`list-${patient.id}`}
                        member={patient}
                        selectedId={selectedId}
                        onSelect={handlePatientSelect}
                      />
                    ))}
                    {filteredAllPatients.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {tr(language, "No patients found.", "ไม่พบผู้ป่วย")}
                      </p>
                    )}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const sweepSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 35,
  mass: 0.5,
};

function getNameInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const DoctorRoleBadge = ({
  type,
  label,
}: {
  type: DoctorPickerItem["roleType"];
  label: string;
}) => {
  const styles = {
    pm: {
      bg: "bg-[#FFFCEB]",
      text: "text-[#856404]",
      border: "border-[#FFEBA5]",
      icon: Briefcase01Icon,
    },
    designer: {
      bg: "bg-[#F0F7FF]",
      text: "text-[#004085]",
      border: "border-[#B8DAFF]",
      icon: PaintBoardIcon,
    },
    data: {
      bg: "bg-[#F3FAF4]",
      text: "text-[#155724]",
      border: "border-[#C3E6CB]",
      icon: Database01Icon,
    },
    creator: {
      bg: "bg-[#FCF5FF]",
      text: "text-[#522785]",
      border: "border-[#E8D1FF]",
      icon: QuillWrite01Icon,
    },
  };

  const style = styles[type];
  const Icon = style.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 shrink-0",
        style.bg,
        style.text,
        style.border
      )}
    >
      <HugeiconsIcon icon={Icon} size={12} strokeWidth={1.8} />
      <span className="max-w-[72px] truncate whitespace-nowrap text-xs font-normal uppercase tracking-tight sm:max-w-none">
        {label}
      </span>
    </div>
  );
};

const DoctorMemberItem = ({
  member,
  selectedId,
  onSelect,
}: {
  member: DoctorPickerItem;
  selectedId?: string;
  onSelect: (item: DoctorPickerItem) => void;
}) => (
  <motion.button
    type="button"
    onClick={() => onSelect(member)}
    variants={{
      hidden: { opacity: 0, x: 10, y: 15, rotate: 1 },
      visible: { opacity: 1, x: 0, y: 0, rotate: 0 },
    }}
    transition={sweepSpring}
    style={{ originX: 1, originY: 1 }}
    className={cn(
      "group flex w-full items-center border-b border-border/40 py-4 text-left first:pt-0 last:border-0",
      selectedId === member.id && "rounded-xl bg-accent/40 px-2"
    )}
  >
    <div className="relative mr-4 shrink-0">
      {member.avatar ? (
        <Image
          src={member.avatar}
          alt={member.label}
          width={48}
          height={48}
          className="h-12 w-12 rounded-full ring-2 ring-background shadow-sm grayscale-[0.1] transition-all duration-300 group-hover:grayscale-0"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full ring-2 ring-background bg-muted text-xs font-semibold text-foreground">
          {getNameInitials(member.label)}
        </div>
      )}
      {member.online && (
        <div className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background shadow-sm">
          <div className="h-2 w-2 rounded-full bg-green-500" />
        </div>
      )}
    </div>
    <div className="min-w-0 flex-1">
      <h3 className="mb-1.5 truncate text-base font-semibold leading-none tracking-tight text-foreground">
        {member.label}
      </h3>
      <div className="flex items-center gap-1.5 opacity-80">
        {member.online && <div className="h-1.5 w-1.5 rounded-full bg-green-500" />}
        <p
          className={cn(
            "text-sm font-medium leading-none",
            member.online ? "text-green-600" : "text-muted-foreground"
          )}
        >
          {member.status}
        </p>
      </div>
    </div>
    <div className="shrink-0">
      <DoctorRoleBadge type={member.roleType} label={member.role} />
    </div>
  </motion.button>
);

const PatientMemberItem = ({
  member,
  selectedId,
  onSelect,
}: {
  member: PatientPickerItem;
  selectedId?: string;
  onSelect: (item: PatientPickerItem) => void;
}) => (
  <motion.button
    type="button"
    onClick={() => onSelect(member)}
    variants={{
      hidden: { opacity: 0, x: 10, y: 15, rotate: 1 },
      visible: { opacity: 1, x: 0, y: 0, rotate: 0 },
    }}
    transition={sweepSpring}
    style={{ originX: 1, originY: 1 }}
    className={cn(
      "group flex w-full items-center border-b border-border/40 py-4 text-left first:pt-0 last:border-0",
      selectedId === member.id && "rounded-xl bg-accent/40 px-2"
    )}
  >
    <div className="relative mr-4 shrink-0">
      {member.avatar ? (
        <Image
          src={member.avatar}
          alt={member.label}
          width={48}
          height={48}
          className="h-12 w-12 rounded-full ring-2 ring-background shadow-sm grayscale-[0.1] transition-all duration-300 group-hover:grayscale-0"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full ring-2 ring-background bg-muted text-xs font-semibold text-foreground">
          {getNameInitials(member.label)}
        </div>
      )}
      {member.active && (
        <div className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background shadow-sm">
          <div className="h-2 w-2 rounded-full bg-green-500" />
        </div>
      )}
    </div>
    <div className="min-w-0 flex-1">
      <h3 className="mb-1.5 truncate text-base font-semibold leading-none tracking-tight text-foreground">
        {member.label}
      </h3>
      <div className="flex items-center gap-1.5 opacity-80">
        {member.active && <div className="h-1.5 w-1.5 rounded-full bg-green-500" />}
        <p
          className={cn(
            "text-sm font-medium leading-none",
            member.active ? "text-green-600" : "text-muted-foreground"
          )}
        >
          {member.status}
        </p>
      </div>
    </div>
    <div className="shrink-0">
      {selectedId === member.id && (
        <HugeiconsIcon icon={Tick02Icon} className="size-4 text-primary" />
      )}
    </div>
  </motion.button>
);

function DoctorDirectoryDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  items,
  selectedId,
  loading,
  onSelect,
  language,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  items: DoctorPickerItem[];
  selectedId?: string;
  loading: boolean;
  onSelect: (item: DoctorPickerItem) => void;
  language: AppLanguage;
}) {
  const [expanded, setExpanded] = useState(false);
  const filteredAllDoctors = useMemo(
    () => {
      const normalizedQuery = normalizeSearchText(query);
      if (!normalizedQuery) return items;
      return items.filter(
        (doctor) =>
          includesSearchQuery(doctor.label, query) ||
          includesSearchQuery(doctor.role, query) ||
          includesSearchQuery(doctor.description || "", query)
      );
    },
    [items, query]
  );
  const activeItems = useMemo(
    () => items.filter((item) => item.online),
    [items]
  );
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setExpanded(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );
  const handleDoctorSelect = useCallback(
    (doctor: DoctorPickerItem) => {
      onSelect(doctor);
      handleOpenChange(false);
    },
    [onSelect, handleOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-muted/50" showCloseButton={false}>
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="text-sm font-semibold text-foreground">
            {tr(language, "Select Doctor", "เลือกแพทย์")}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl text-muted-foreground"
            onClick={() => handleOpenChange(false)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2.2} />
          </Button>
        </div>

        <div className="p-4">
          <div className="relative w-full rounded-[28px] border border-border bg-background pb-5">
            <div className="px-6 pb-3 pt-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                  {tr(language, "Active Doctors", "แพทย์ที่พร้อมใช้งาน")}
                  <span className="mt-0.5 rounded-full bg-muted px-2 py-1 text-xs font-normal leading-none text-muted-foreground">
                    {activeItems.length}
                  </span>
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full border-border/50 text-muted-foreground hover:bg-muted/50"
                  onClick={() => setExpanded((prev) => !prev)}
                >
                  <HugeiconsIcon icon={Add01Icon} size={18} strokeWidth={2.5} />
                </Button>
              </div>

              <div className="relative mb-4">
                <HugeiconsIcon
                  icon={Search01Icon}
                  className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60"
                  size={16}
                />
                <Input
                  placeholder={tr(language, "Search doctors...", "ค้นหาแพทย์...")}
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  className="h-11 w-full rounded-2xl border-none bg-muted/40 pl-11 pr-4 text-base text-foreground placeholder:text-muted-foreground/50 box-border transition-all focus-visible:ring-1 focus-visible:ring-border"
                />
              </div>
            </div>

            <div className="max-h-[280px] overflow-y-auto px-6 pb-20">
              <motion.div
                initial={false}
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
                className="space-y-0.5"
              >
                {loading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {tr(language, "Searching doctors...", "กำลังค้นหาแพทย์...")}
                  </p>
                ) : activeItems.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {tr(language, "No active doctors found.", "ไม่พบแพทย์ที่พร้อมใช้งาน")}
                  </p>
                ) : (
                  activeItems.map((doctor) => (
                    <DoctorMemberItem
                      key={`active-${doctor.id}`}
                      member={doctor}
                      selectedId={selectedId}
                      onSelect={handleDoctorSelect}
                    />
                  ))
                )}
              </motion.div>
            </div>

            <motion.div
              layout
              initial={false}
              animate={{
                height: expanded ? "calc(100% - 20px)" : "68px",
                width: expanded ? "calc(100% - 20px)" : "calc(100% - 40px)",
                bottom: expanded ? "10px" : "20px",
                left: expanded ? "10px" : "20px",
                borderRadius: expanded ? "32px" : "24px",
              }}
              transition={{
                type: "spring",
                stiffness: 240,
                damping: 30,
                mass: 0.8,
                ease: "easeInOut",
              }}
              className="group/bar absolute z-50 flex flex-col overflow-hidden border border-border bg-card shadow-none"
              style={{ cursor: expanded ? "default" : "pointer" }}
              onClick={() => !expanded && setExpanded(true)}
            >
              <div
                className={cn(
                  "flex h-[68px] shrink-0 items-center justify-between px-3 transition-colors",
                  expanded ? "border-b border-border/40" : "hover:bg-muted/20"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground/80 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-transform group-hover/bar:scale-105">
                    <HugeiconsIcon icon={ProfileIcon} size={20} strokeWidth={2} />
                  </div>
                  <motion.div layout="position">
                    <h4 className="text-base font-medium leading-none tracking-tight text-foreground">
                      {tr(language, "Doctor Directory", "ไดเรกทอรีแพทย์")}
                    </h4>
                    <p className="mt-1 text-xs font-normal leading-none text-muted-foreground">
                      {tr(
                        language,
                        `${items.length} doctors registered`,
                        `มีแพทย์ในระบบ ${items.length} คน`
                      )}
                    </p>
                  </motion.div>
                </div>

                <div className="flex items-center gap-3">
                  {!expanded && (
                    <div className="flex items-center gap-0">
                      <div className="flex -space-x-3">
                        {items.slice(0, 3).map((doctor) => (
                          <motion.div
                            key={`sum-${doctor.id}`}
                            layoutId={`avatar-${doctor.id}`}
                            className="flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-background bg-muted text-[11px] font-semibold text-muted-foreground shadow-sm"
                          >
                            {getNameInitials(doctor.label)}
                          </motion.div>
                        ))}
                        <div className="relative z-0 flex h-10 w-10 items-center justify-center rounded-full bg-muted shadow-sm ring-1 ring-background">
                          <span className="text-sm font-normal leading-none text-muted-foreground">
                            +{Math.max(items.length - 3, 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {expanded && (
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground transition-all hover:text-foreground active:scale-90"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpanded(false);
                      }}
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={18}
                        strokeWidth={2.5}
                      />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-1 flex-col overflow-hidden">
                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="px-5 py-4"
                    >
                      <div className="relative">
                        <HugeiconsIcon
                          icon={Search01Icon}
                          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/50"
                          size={15}
                        />
                        <Input
                          placeholder={tr(language, "Search doctors...", "ค้นหาแพทย์...")}
                          value={query}
                          onChange={(event) => onQueryChange(event.target.value)}
                          className="h-10 w-full rounded-xl border-none bg-muted/30 pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 box-border transition-all focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex-1 overflow-y-auto px-5 py-2">
                  <motion.div
                    initial="hidden"
                    animate={expanded ? "visible" : "hidden"}
                    variants={{
                      visible: {
                        transition: { staggerChildren: 0.03, delayChildren: 0.1 },
                      },
                      hidden: {
                        transition: { staggerChildren: 0.02, staggerDirection: -1 },
                      },
                    }}
                    className="space-y-0.5"
                  >
                    {filteredAllDoctors.map((doctor) => (
                      <DoctorMemberItem
                        key={`list-${doctor.id}`}
                        member={doctor}
                        selectedId={selectedId}
                        onSelect={handleDoctorSelect}
                      />
                    ))}
                    {filteredAllDoctors.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {tr(language, "No doctors found.", "ไม่พบแพทย์")}
                      </p>
                    )}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════
// Schedule Popover (Square UI schedule-popover.tsx)
// ══════════════════════════════════════════════════════════
function SchedulePopover({
  children,
  onSchedule,
  language,
}: {
  children: React.ReactNode;
  onSchedule?: (date: Date, startTime: string, endTime: string) => void;
  language: AppLanguage;
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
            <h4 className="mb-3 text-base font-semibold">{tr(language, "Schedule Meeting", "นัดหมายการประชุม")}</h4>
            <p className="mb-4 text-sm text-muted-foreground">
              {tr(language, "Quick schedule a meeting or event", "สร้างนัดหมายหรืออีเวนต์อย่างรวดเร็ว")}
            </p>
          </div>

          <div className="space-y-3">
            {/* Date */}
            <div className="grid gap-2">
              <Label className="text-sm">{tr(language, "Date", "วันที่")}</Label>
              <Popover
                open={datePickerOpen}
                onOpenChange={setDatePickerOpen}
              >
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className={cn(
                        "h-10 w-full justify-start text-left text-sm font-normal",
                        !date && "text-muted-foreground"
                      )}
                    >
                      <HugeiconsIcon
                        icon={Calendar01Icon}
                        className="mr-2 size-4"
                      />
                      {date ? (
                        formatDateLabel(date, language, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      ) : (
                        <span>{tr(language, "Pick a date", "เลือกวันที่")}</span>
                      )}
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(selectedDate: Date | undefined) => {
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
                <Label className="text-sm">{tr(language, "Start", "เริ่ม")}</Label>
                <div className="relative">
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
                  />
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="h-10 pl-8 text-sm"
                    placeholder="09:00"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-sm">{tr(language, "End", "สิ้นสุด")}</Label>
                <div className="relative">
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
                  />
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="h-10 pl-8 text-sm"
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
                className="h-9 justify-start gap-2 text-sm"
              >
                <HugeiconsIcon icon={UserGroupIcon} className="size-3.5" />
                <span>{tr(language, "Add participants", "เพิ่มผู้เข้าร่วม")}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 justify-start gap-2 text-sm"
              >
                <HugeiconsIcon icon={Calendar01Icon} className="size-3.5" />
                <span>{tr(language, "Add video call", "เพิ่มวิดีโอคอล")}</span>
              </Button>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 flex-1 text-sm"
                onClick={() => setOpen(false)}
              >
                {tr(language, "Cancel", "ยกเลิก")}
              </Button>
              <Button
                size="sm"
                className="h-9 flex-1 text-sm"
                onClick={handleSchedule}
                disabled={!date || !startTime || !endTime}
              >
                {tr(language, "Schedule", "นัดหมาย")}
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
  userRole,
  initialSlot,
  editMeeting,
  onCreated,
  token,
  language,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patients: Patient[];
  doctors: User[];
  currentUserId: string | null;
  userRole: string | null;
  initialSlot?: CalendarSlotSelection | null;
  editMeeting?: Meeting | null;
  onCreated: (meeting?: Meeting) => void | Promise<void>;
  token: string;
  language: AppLanguage;
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
  const [doctorQuery, setDoctorQuery] = useState("");
  const [patientQuery, setPatientQuery] = useState("");
  const [doctorSearchResults, setDoctorSearchResults] = useState<User[]>([]);
  const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
  const [doctorSearchLoading, setDoctorSearchLoading] = useState(false);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [doctorPickerOpen, setDoctorPickerOpen] = useState(false);
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const meetingLinkMode = getMeetingLinkMode();
  const isDoctorUser = userRole === "doctor";

  const selectedDoctor = useMemo(
    () =>
      doctors.find((u) => u.id === doctorId) ||
      doctorSearchResults.find((u) => u.id === doctorId) ||
      null,
    [doctorId, doctors, doctorSearchResults]
  );

  const selectedPatient = useMemo(
    () =>
      patients.find((p) => p.id === patientId) ||
      patientSearchResults.find((p) => p.id === patientId) ||
      null,
    [patientId, patients, patientSearchResults]
  );

  const visibleDoctors = useMemo(() => {
    const query = normalizeSearchText(doctorQuery);
    if (!query) return doctors;
    if (query.length < 2) {
      return doctors.filter((doctor) => {
        const display = formatDoctorDisplayName(doctor);
        return (
          includesSearchQuery(display, doctorQuery) ||
          includesSearchQuery(doctor.email || "", doctorQuery)
        );
      });
    }
    return doctorSearchResults;
  }, [doctorQuery, doctors, doctorSearchResults]);

  const visiblePatients = useMemo(() => {
    const query = normalizeSearchText(patientQuery);
    if (!query) return patients;
    if (query.length < 2) {
      return patients.filter((patient) => {
        const display = formatPatientDisplayName(patient);
        return (
          includesSearchQuery(display, patientQuery) ||
          includesSearchQuery(patient.email || "", patientQuery)
        );
      });
    }
    return patientSearchResults;
  }, [patientQuery, patients, patientSearchResults]);

  const doctorPickerItems = useMemo<DoctorPickerItem[]>(
    () =>
      visibleDoctors.map((doctor) => {
        const roleLabel = doctor.specialty || doctor.department || tr(language, "Doctor", "แพทย์");
        return {
          id: doctor.id,
          label: formatDoctorDisplayName(doctor),
          description: doctor.email || undefined,
          online: Boolean(doctor.is_active),
          role: roleLabel,
          roleType: resolveDoctorRoleType(roleLabel),
          status: doctor.is_active
            ? tr(language, "Online", "ออนไลน์")
            : tr(language, "Offline", "ออฟไลน์"),
          avatar: doctor.avatar_url || undefined,
        };
      }),
    [visibleDoctors, language]
  );

  const patientPickerItems = useMemo<PatientPickerItem[]>(
    () =>
      visiblePatients.map((patient) => {
        const hasContact = Boolean((patient.email || "").trim() || (patient.phone || "").trim());
        return {
          id: patient.id,
          label: formatPatientDisplayName(patient),
          description: patient.email || patient.phone || undefined,
          active: hasContact,
          status: hasContact
            ? tr(language, "Contact available", "มีข้อมูลติดต่อ")
            : tr(language, "No contact info", "ยังไม่มีข้อมูลติดต่อ"),
        };
      }),
    [visiblePatients, language]
  );

  const meetingLinkHelperText = useMemo(() => {
    if (meetingLinkMode === "off") {
      return tr(
        language,
        "Auto meeting link is currently off. Enter a room name or link manually.",
        "ระบบสร้างลิงก์อัตโนมัติปิดอยู่ตอนนี้ กรุณากรอกห้องหรือลิงก์ประชุมเอง"
      );
    }
    if (meetingLinkMode === "jitsi") {
      return tr(
        language,
        "Leave this field blank and the system will auto-create a Jitsi link.",
        "ปล่อยช่องนี้ว่างไว้ ระบบจะสร้างลิงก์ Jitsi อัตโนมัติให้"
      );
    }
    if (meetingLinkMode === "internal") {
      return tr(
        language,
        "Leave this field blank and the system will auto-create an internal meeting room link.",
        "ปล่อยช่องนี้ว่างไว้ ระบบจะสร้างลิงก์ห้องประชุมภายในให้อัตโนมัติ"
      );
    }
    return tr(
      language,
      "Leave this field blank and the system will auto-create a meeting link from your template.",
      "ปล่อยช่องนี้ว่างไว้ ระบบจะสร้างลิงก์ประชุมจากเทมเพลตให้อัตโนมัติ"
    );
  }, [meetingLinkMode, language]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setIsDraftHydrated(false);
      setDoctorPickerOpen(false);
      setPatientPickerOpen(false);
      setDoctorQuery("");
      setPatientQuery("");
      setDoctorSearchResults([]);
      setPatientSearchResults([]);
      setDoctorSearchLoading(false);
      setPatientSearchLoading(false);

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
        setIsDraftHydrated(true);
      } else {
        const savedDraft = readCreateEventDraft(currentUserId);
        if (savedDraft) {
          setSelectedDate(
            parseLocalDateKey(savedDraft.selectedDateKey) ?? new Date()
          );
          setStartHour(savedDraft.startHour);
          setStartMinute(savedDraft.startMinute);
          setEndHour(savedDraft.endHour);
          setEndMinute(savedDraft.endMinute);
          setPatientId(savedDraft.patientId);
          setDoctorId(savedDraft.doctorId || currentUserId || (doctors.length > 0 ? doctors[0].id : ""));
          setDescription(savedDraft.description);
          setRoom(savedDraft.room);
          setNote(savedDraft.note);
        } else {
          const presetDate = initialSlot?.date
            ? new Date(initialSlot.date)
            : new Date();
          const presetStartHour = initialSlot?.startHour ?? 9;
          const presetStartMinute = initialSlot?.startMinute ?? 0;
          const presetEndHour = initialSlot?.endHour ?? 10;
          const presetEndMinute = initialSlot?.endMinute ?? 0;

          setSelectedDate(presetDate);
          setStartHour(presetStartHour);
          setStartMinute(presetStartMinute);
          setEndHour(presetEndHour);
          setEndMinute(presetEndMinute);
          setPatientId("");
          setDoctorId(currentUserId || (doctors.length > 0 ? doctors[0].id : ""));
          setDescription("");
          setRoom("");
          setNote("");
        }
        setIsDraftHydrated(true);
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
  }, [endHour, endMinute, startHour, startMinute]);

  useEffect(() => {
    if (open) return;
    setDoctorPickerOpen(false);
    setPatientPickerOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open || editMeeting || !isDraftHydrated) return;

    writeCreateEventDraft(currentUserId, {
      selectedDateKey: formatLocalDateKey(selectedDate),
      startHour,
      startMinute,
      endHour,
      endMinute,
      patientId,
      doctorId: isDoctorUser ? currentUserId || doctorId : doctorId,
      description,
      room,
      note,
    });
  }, [
    open,
    editMeeting,
    isDraftHydrated,
    currentUserId,
    selectedDate,
    startHour,
    startMinute,
    endHour,
    endMinute,
    patientId,
    doctorId,
    description,
    room,
    note,
    isDoctorUser,
  ]);

  useEffect(() => {
    if (!open || !doctorPickerOpen || isDoctorUser) return;
    const query = normalizeSearchText(doctorQuery);
    if (query.length < 2) {
      setDoctorSearchResults([]);
      setDoctorSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setDoctorSearchLoading(true);
      try {
        const response = await fetchUsers(
          {
            page: 1,
            limit: 100,
            q: query,
            role: "doctor",
            clinical_only: true,
            sort: "first_name",
            order: "asc",
          },
          token
        );
        if (!cancelled) {
          setDoctorSearchResults(response.items ?? []);
        }
      } catch {
        if (!cancelled) {
          setDoctorSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setDoctorSearchLoading(false);
        }
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, doctorPickerOpen, isDoctorUser, doctorQuery, token]);

  useEffect(() => {
    if (!open || !patientPickerOpen) return;
    const query = normalizeSearchText(patientQuery);
    if (query.length < 2) {
      setPatientSearchResults([]);
      setPatientSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setPatientSearchLoading(true);
      try {
        const response = await fetchPatients(
          {
            page: 1,
            limit: 100,
            q: query,
            sort: "first_name",
            order: "asc",
          },
          token
        );
        if (!cancelled) {
          setPatientSearchResults(response.items ?? []);
        }
      } catch {
        if (!cancelled) {
          setPatientSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setPatientSearchLoading(false);
        }
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, patientPickerOpen, patientQuery, token]);

  const dateTimeISO = useMemo(() => {
    return combineLocalDateAndTimeToIso(selectedDate, startHour, startMinute);
  }, [selectedDate, startHour, startMinute]);

  const effectiveDoctorId = isDoctorUser ? currentUserId || doctorId : doctorId;
  const canSubmit = patientId && effectiveDoctorId && selectedDate;

  const handleOpenDoctorPicker = useCallback(() => {
    if (isDoctorUser) return;
    setDoctorQuery("");
    setDoctorPickerOpen(true);
  }, [isDoctorUser]);

  const handleOpenPatientPicker = useCallback(() => {
    setPatientQuery("");
    setPatientPickerOpen(true);
  }, []);

  const handleSelectDoctor = useCallback((item: DoctorPickerItem) => {
    setDoctorId(item.id);
    setDoctorPickerOpen(false);
  }, []);

  const handleSelectPatient = useCallback((item: PatientPickerItem) => {
    setPatientId(item.id);
    setPatientPickerOpen(false);
  }, []);

  const handleCancelCreateEvent = useCallback(() => {
    if (!editMeeting) {
      clearCreateEventDraft(currentUserId);
    }
    onOpenChange(false);
  }, [editMeeting, currentUserId, onOpenChange]);

  const handleClearCreateEventForm = useCallback(() => {
    if (editMeeting || submitting) return;

    clearCreateEventDraft(currentUserId);
    setPatientId("");
    setDoctorId(currentUserId || (doctors.length > 0 ? doctors[0].id : ""));
    setDescription("");
    setRoom("");
    setNote("");
    setDoctorQuery("");
    setPatientQuery("");
    setDoctorPickerOpen(false);
    setPatientPickerOpen(false);
    setDoctorSearchResults([]);
    setPatientSearchResults([]);
    setDoctorSearchLoading(false);
    setPatientSearchLoading(false);
  }, [editMeeting, submitting, currentUserId, doctors]);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      if (editMeeting) {
        // Update existing meeting
        const payload: MeetingUpdatePayload = {
          date_time: dateTimeISO,
          description: description || undefined,
          doctor_id: effectiveDoctorId,
          note: note || undefined,
          room: resolveMeetingRoomValue(room),
          user_id: patientId,
        };
        const updatedMeeting = await updateMeeting(editMeeting.id, payload, token);
        toast.success(tr(language, "Appointment updated successfully", "อัปเดตนัดหมายสำเร็จ"));
        onOpenChange(false);
        await onCreated(updatedMeeting);
      } else {
        // Create new meeting
        const payload: MeetingCreatePayload = {
          date_time: dateTimeISO,
          description: description || undefined,
          doctor_id: effectiveDoctorId,
          note: note || undefined,
          room: resolveMeetingRoomValue(room),
          user_id: patientId,
        };
        const createdMeeting = await createMeeting(payload, token);
        clearCreateEventDraft(currentUserId);
        toast.success(tr(language, "Appointment scheduled successfully", "นัดหมายสำเร็จ"));
        onOpenChange(false);
        await onCreated(createdMeeting);
      }
    } catch (err: unknown) {
      const message = getErrorMessage(
        err,
        tr(language, "Failed to create appointment", "สร้างนัดหมายไม่สำเร็จ")
      );
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pb-3 pt-5">
          <DialogTitle className="text-base">
            {editMeeting
              ? tr(language, "Edit Appointment", "แก้ไขนัดหมาย")
              : tr(language, "Create Event", "สร้างอีเวนต์")}
          </DialogTitle>
          <DialogDescription>
            {editMeeting
              ? tr(language, "Update the appointment details below", "อัปเดตรายละเอียดนัดหมายด้านล่าง")
              : tr(language, "Book a new consultation or follow-up", "สร้างนัดหมายใหม่หรือการติดตามผล")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 pb-2">
          {/* ── Date & Time Selection ── */}
          <div className="space-y-2">
            <Label className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {tr(language, "Date & Time Selection", "เลือกวันและเวลา")}
            </Label>
            <AnimatedCalendar
              mode="single"
              value={selectedDate}
              onChange={(value) => {
                if (value instanceof Date) {
                  setSelectedDate(value);
                }
              }}
              localeStrings={{
                today: tr(language, "Today", "วันนี้"),
                clear: tr(language, "Clear", "ล้าง"),
                selectTime: tr(language, "Select time", "เลือกเวลา"),
                backToCalendar: tr(language, "Back to calendar", "กลับไปปฏิทิน"),
                selected: tr(language, "selected", "ที่เลือก"),
              }}
              showWeekNumbers
              showTodayButton
              showClearButton={false}
              closeOnSelect
              className="w-full"
            />
            <p className="text-sm text-muted-foreground">
              {tr(
                language,
                "Select a date, then set start and end time below.",
                "เลือกวันที่ก่อน แล้วตั้งเวลาเริ่มและเวลาสิ้นสุดด้านล่าง"
              )}
            </p>
          </div>

          {/* ── Time Pickers ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {tr(language, "Start Time", "เวลาเริ่ม")}
              </Label>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3.5 py-2 text-sm">
                <HugeiconsIcon
                  icon={Clock01Icon}
                  className="size-4 text-[var(--med-primary-light)] shrink-0"
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
              <Label className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {tr(language, "End Time", "เวลาสิ้นสุด")}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {tr(language, "Doctor", "แพทย์")} <span className="text-red-400">*</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full justify-between"
                onClick={handleOpenDoctorPicker}
                disabled={isDoctorUser}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <HugeiconsIcon
                    icon={Stethoscope02Icon}
                    className="size-4 shrink-0 text-[var(--med-primary-light)]"
                  />
                  <span className={cn("truncate", !selectedDoctor && "text-muted-foreground")}>
                    {selectedDoctor
                      ? formatDoctorDisplayName(selectedDoctor)
                      : tr(language, "Choose doctor", "เลือกแพทย์")}
                  </span>
                </span>
                <HugeiconsIcon icon={Search01Icon} className="size-4 text-muted-foreground" />
              </Button>
              {!isDoctorUser && (
                <p className="text-sm text-muted-foreground">
                  {tr(
                    language,
                    "Click to open doctor search panel.",
                    "กดปุ่มเพื่อเปิดหน้าค้นหาแพทย์"
                  )}
                </p>
              )}
              {isDoctorUser && (
                <p className="text-sm text-muted-foreground">
                  {tr(language, "Doctor is locked to your account.", "แพทย์ถูกล็อกตามบัญชีของคุณ")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {tr(language, "Patient", "ผู้ป่วย")} <span className="text-red-400">*</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full justify-between"
                onClick={handleOpenPatientPicker}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <HugeiconsIcon
                    icon={UserIcon}
                    className="size-4 shrink-0 text-emerald-500"
                  />
                  <span className={cn("truncate", !selectedPatient && "text-muted-foreground")}>
                    {selectedPatient
                      ? formatPatientDisplayName(selectedPatient)
                      : tr(language, "Choose patient", "เลือกผู้ป่วย")}
                  </span>
                </span>
                <HugeiconsIcon icon={Search01Icon} className="size-4 text-muted-foreground" />
              </Button>
              <p className="text-sm text-muted-foreground">
                {tr(
                  language,
                  "Click to open patient search panel.",
                  "กดปุ่มเพื่อเปิดหน้าค้นหาผู้ป่วย"
                )}
              </p>
            </div>
          </div>

          {/* ── Description & Room ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {tr(language, "Description", "รายละเอียด")}
              </Label>
              <Textarea
                placeholder={tr(language, "Follow-up consultation", "ติดตามอาการ")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="field-sizing-fixed h-16 max-h-24 resize-none overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {tr(language, "Room / Meeting Link", "ห้อง / ลิงก์ประชุม")}
                </Label>
                <span
                  className={cn(
                    "inline-flex h-6 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium uppercase tracking-[0.06em]",
                    meetingLinkMode === "off"
                      ? "bg-muted text-muted-foreground"
                      : "bg-sky-100 text-sky-700"
                  )}
                >
                  {meetingLinkMode === "off"
                    ? tr(language, "Manual mode", "โหมดกรอกเอง")
                    : tr(language, "Auto link", "ลิงก์อัตโนมัติ")}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3.5 py-2 text-sm">
                <HugeiconsIcon
                  icon={DoorIcon}
                  className="size-4 text-amber-500 shrink-0"
                />
                <input
                  placeholder={tr(language, "https://meet.example.com/room or Room 101", "https://meet.example.com/room หรือ ห้อง 101")}
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {meetingLinkHelperText}
              </p>
            </div>
          </div>

          {/* ── Notes ── */}
          <div className="space-y-2">
            <Label className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {tr(language, "Notes", "บันทึก")}
            </Label>
            <Textarea
              placeholder={tr(language, "Additional notes or instructions...", "หมายเหตุหรือคำสั่งเพิ่มเติม...")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={6}
              className="field-sizing-fixed h-36 max-h-44 resize-none overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            />
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-2 flex items-center justify-between border-t bg-muted/30 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground gap-1.5"
              onClick={handleCancelCreateEvent}
            >
              {tr(language, "Cancel", "ยกเลิก")}
            </Button>
            {!editMeeting && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleClearCreateEventForm}
                disabled={submitting}
              >
                {tr(language, "Clear form", "ล้างฟอร์ม")}
              </Button>
            )}
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="gap-2 px-5 bg-[var(--med-primary-dark)] border border-[var(--med-primary-deep)] text-white shadow-sm transition-all duration-200 hover:bg-[var(--med-primary)] hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm disabled:translate-y-0 disabled:shadow-sm"
          >
            {submitting ? (
              <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
            )}
            {editMeeting
              ? tr(language, "Update", "อัปเดต")
              : tr(language, "Schedule", "นัดหมาย")}
          </Button>
        </div>
        </DialogContent>
      </Dialog>

      <DoctorDirectoryDialog
        open={open && doctorPickerOpen && !isDoctorUser}
        onOpenChange={setDoctorPickerOpen}
        query={doctorQuery}
        onQueryChange={setDoctorQuery}
        items={doctorPickerItems}
        selectedId={doctorId}
        loading={doctorSearchLoading}
        onSelect={handleSelectDoctor}
        language={language}
      />

      <PatientDirectoryDialog
        open={open && patientPickerOpen}
        onOpenChange={setPatientPickerOpen}
        query={patientQuery}
        onQueryChange={setPatientQuery}
        items={patientPickerItems}
        selectedId={patientId}
        loading={patientSearchLoading}
        onSelect={handleSelectPatient}
        language={language}
      />
    </>
  );
}

// ══════════════════════════════════════════════════════════
// Main Meetings Content
// ══════════════════════════════════════════════════════════
export function MeetingsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const userRole = useAuthStore((state) => state.role);
  const clearToken = useAuthStore((state) => state.clearToken);
  const language = useLanguageStore((state) => state.language);
  const canManageMeetings = canWriteClinicalData(userRole);

  // Pre-warm the ZEGO SDK bundle so it's cached before the doctor clicks "Start call".
  // On 3G this can take 20-40s, so starting early is critical.
  useEffect(() => {
    return scheduleZegoUIKitPreload({
      enabled: userRole === "doctor",
    });
  }, [userRole]);

  const currentWeekStart = useCalendarStore((s) => s.currentWeekStart);
  const goToToday = useCalendarStore((s) => s.goToToday);
  const goToPreviousWeek = useCalendarStore((s) => s.goToPreviousWeek);
  const goToNextWeek = useCalendarStore((s) => s.goToNextWeek);
  const goToDate = useCalendarStore((s) => s.goToDate);
  const searchQuery = useCalendarStore((s) => s.searchQuery);
  const setSearchQuery = useCalendarStore((s) => s.setSearchQuery);
  const eventTypeFilter = useCalendarStore((s) => s.eventTypeFilter);
  const setEventTypeFilter = useCalendarStore((s) => s.setEventTypeFilter);
  const includeCancelled = useCalendarStore((s) => s.includeCancelled);
  const setIncludeCancelled = useCalendarStore((s) => s.setIncludeCancelled);
  const setMeetings = useCalendarStore((s) => s.setMeetings);
  const meetings = useCalendarStore((s) => s.meetings);

  const [viewMode, setViewMode] = useState<"calendar" | "month" | "queue">("calendar");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [createInitialSlot, setCreateInitialSlot] =
    useState<CalendarSlotSelection | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<User[]>([]);
  const [doctorScope, setDoctorScope] = useState<
    "all-visible" | "my-meetings" | "care-team"
  >("my-meetings");
  const meetingsRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const meetingsRefreshTimeoutRef = useRef<number | null>(null);
  const urlStateHydratedRef = useRef(false);

  const weekEnd = addWeeks(currentWeekStart, 1);
  const weekStartLabel = formatDateLabel(currentWeekStart, language, {
    month: "short",
    day: "numeric",
  });
  const weekEndLabel = formatDateLabel(
    new Date(weekEnd.getTime() - 86400000),
    language,
    { month: "short", day: "numeric", year: "numeric" }
  );

  const visibleMeetings = useMemo(
    () =>
      includeCancelled
        ? meetings
        : meetings.filter((meeting) => meeting.status !== "cancelled"),
    [includeCancelled, meetings]
  );

  const todayMeetingsCount = visibleMeetings.filter(
    (m) => new Date(m.date_time).toDateString() === new Date().toDateString()
  ).length;
  const currentMonthMeetingsCount = visibleMeetings.filter((meeting) =>
    isSameMonth(new Date(meeting.date_time), currentWeekStart)
  ).length;
  const totalEventsCount = visibleMeetings.length;

  const hasActiveFilters = eventTypeFilter !== "all" || includeCancelled;
  const currentViewLabel =
    viewMode === "calendar"
      ? tr(language, "Week", "สัปดาห์")
      : viewMode === "month"
        ? tr(language, "Month", "เดือน")
        : tr(language, "Queue", "คิว");
  const headerTitle =
    viewMode === "month"
      ? formatDateLabel(currentWeekStart, language, {
        month: "long",
        year: "numeric",
      })
      : formatDateLabel(currentWeekStart, language, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
  const toolbarDateLabel =
    viewMode === "month"
      ? formatDateLabel(currentWeekStart, language, {
        month: "short",
        year: "numeric",
      })
      : `${weekStartLabel} - ${weekEndLabel}`;

  const goToPrimaryPeriod = useCallback(() => {
    goToToday();
  }, [goToToday]);

  const goToPreviousPeriod = useCallback(() => {
    if (viewMode === "month") {
      goToDate(addMonths(currentWeekStart, -1));
      return;
    }

    goToPreviousWeek();
  }, [currentWeekStart, goToDate, goToPreviousWeek, viewMode]);

  const goToNextPeriod = useCallback(() => {
    if (viewMode === "month") {
      goToDate(addMonths(currentWeekStart, 1));
      return;
    }

    goToNextWeek();
  }, [currentWeekStart, goToDate, goToNextWeek, viewMode]);

  const loadMeetings = useCallback(
    async (background = false) => {
      if (!token) return;
      if (meetingsRefreshPromiseRef.current) {
        return meetingsRefreshPromiseRef.current;
      }

      if (!background) setLoading(true);

      const refreshPromise = (async () => {
        try {
          const doctorFilter =
            userRole === "doctor" && doctorScope === "my-meetings" && userId
              ? userId
              : undefined;

          const allMeetings = await fetchAllMeetings(
            { doctor_id: doctorFilter },
            token,
            { maxItems: 5000 }
          );

          const scopedItems =
            userRole === "doctor" && doctorScope === "care-team" && userId
              ? allMeetings.filter((item) => item.doctor_id !== userId)
              : allMeetings;

          setMeetings(scopedItems);
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status === 401) {
            clearToken();
            router.replace("/login");
          }
        } finally {
          if (!background) setLoading(false);
        }
      })().finally(() => {
        meetingsRefreshPromiseRef.current = null;
      });

      meetingsRefreshPromiseRef.current = refreshPromise;
      return refreshPromise;
    },
    [token, setMeetings, clearToken, router, userRole, userId, doctorScope]
  );

  const resolveMeetingsRefreshInterval = useCallback(() => {
    if (!meetings.length) {
      return IDLE_MEETING_REFRESH_INTERVAL_MS;
    }

    const now = Date.now();
    if (meetings.some(isActivelyWaitingMeeting)) {
      return ACTIVE_MEETING_REFRESH_INTERVAL_MS;
    }
    if (meetings.some((meeting) => isNearMeetingWindow(meeting, now))) {
      return NEAR_MEETING_REFRESH_INTERVAL_MS;
    }
    return IDLE_MEETING_REFRESH_INTERVAL_MS;
  }, [meetings]);

  const handleMeetingCreated = useCallback(
    async (meeting?: Meeting) => {
      // If we have a date (new meeting), go to it
      // But if we just edited an existing one, user might want to stay in current view
      if (meeting?.date_time && viewMode !== "queue") {
        goToDate(new Date(meeting.date_time));
      }

      // We do NOT reset search/filter here anymore to preserve context
      // unless it's a brand new navigation

      // Refresh list in background so view doesn't flicker/reset
      await loadMeetings(true);
    },
    [goToDate, viewMode, loadMeetings]
  );

  const handleSlotSelect = useCallback((slot: CalendarSlotSelection) => {
    if (!canManageMeetings) {
      toast.error(
        tr(language, "This meeting view is read-only for your account", "บัญชีของคุณดูนัดหมายได้อย่างเดียว")
      );
      return;
    }
    setCreateInitialSlot(slot);
    setCreateOpen(true);
  }, [canManageMeetings, language]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  useEffect(() => {
    if (urlStateHydratedRef.current) {
      return;
    }

    const requestedView = searchParams.get("view");
    const requestedDate = searchParams.get("date");

    if (requestedView === "week") {
      setViewMode("calendar");
    } else if (requestedView === "month" || requestedView === "queue") {
      setViewMode(requestedView);
    }

    if (requestedDate) {
      const parsedDate = parseLocalDateKey(requestedDate);
      if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
        goToDate(parsedDate);
      }
    }

    urlStateHydratedRef.current = true;
  }, [goToDate, searchParams]);

  useEffect(() => {
    if (!urlStateHydratedRef.current) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    const urlView =
      viewMode === "calendar" ? "week" : viewMode === "month" ? "month" : "queue";
    const urlDate =
      viewMode === "month"
        ? formatLocalDateKey(
            new Date(
              currentWeekStart.getFullYear(),
              currentWeekStart.getMonth(),
              15
            )
          )
        : formatLocalDateKey(currentWeekStart);

    params.set("view", urlView);
    params.set("date", urlDate);

    const nextUrl = `${pathname}?${params.toString()}`;
    const currentUrl = `${pathname}?${searchParams.toString()}`;

    if (nextUrl !== currentUrl) {
      router.replace(nextUrl, { scroll: false });
    }
  }, [currentWeekStart, pathname, router, searchParams, viewMode]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const clearScheduledRefresh = () => {
      if (meetingsRefreshTimeoutRef.current !== null) {
        window.clearTimeout(meetingsRefreshTimeoutRef.current);
        meetingsRefreshTimeoutRef.current = null;
      }
    };

    const scheduleNextRefresh = () => {
      clearScheduledRefresh();
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }
      meetingsRefreshTimeoutRef.current = window.setTimeout(() => {
        void loadMeetings(true).finally(() => {
          if (!cancelled) {
            scheduleNextRefresh();
          }
        });
      }, resolveMeetingsRefreshInterval());
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadMeetings(true).finally(() => {
          if (!cancelled) {
            scheduleNextRefresh();
          }
        });
        return;
      }
      clearScheduledRefresh();
    };

    scheduleNextRefresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      clearScheduledRefresh();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [token, loadMeetings, resolveMeetingsRefreshInterval]);

  // Load patients & doctors for form
  useEffect(() => {
    if (!token) return;
    fetchAllPatients({ sort: "first_name", order: "asc" }, token, {
      maxItems: 5000,
    })
      .then((items) => setPatients(items))
      .catch(() => { });
    // Doctors can't access /users endpoint; use /auth/me for their own info.
    // Read-only roles should not preload doctor options for a form they cannot submit.
    if (userRole === "doctor") {
      fetchCurrentUser(token)
        .then((me) => setDoctors([{ id: me.id, email: me.email, first_name: me.first_name, last_name: me.last_name, role: me.role, is_active: true }]))
        .catch(() => { });
      return;
    }

    if (canManageMeetings) {
      fetchUsers({ page: 1, limit: 100, role: "doctor", clinical_only: true, sort: "first_name", order: "asc" }, token)
        .then((res) => setDoctors(res.items))
        .catch(() => { });
      return;
    }

    setDoctors([]);
  }, [canManageMeetings, token, userRole]);

  return (
    <main className="flex h-full w-full flex-1 flex-col overflow-hidden">
      <div className="sticky top-0 z-40 border-b border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.94))] shadow-[0_18px_42px_rgba(15,23,42,0.04)] supports-[backdrop-filter]:bg-white/82 supports-[backdrop-filter]:backdrop-blur-xl">
        {/* ══════════════════════════════════════════════════
            Calendar Header (Square UI calendar-header.tsx)
            ══════════════════════════════════════════════════ */}
        <div className="border-b border-slate-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))]">
          <div className="px-3 py-2.5 md:px-4 md:py-3">
            <div className="flex items-center justify-between gap-3 md:gap-4">
              {/* Left: title area */}
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[1.08rem] font-semibold tracking-[-0.03em] text-slate-950 md:text-[1.28rem]">
                    {headerTitle}
                  </h1>
                  <p className="mt-1 hidden text-sm text-slate-500 md:block">
                    {viewMode === "month"
                      ? tr(
                        language,
                        `${currentMonthMeetingsCount} meetings this month • ${totalEventsCount} total events`,
                        `เดือนนี้ ${currentMonthMeetingsCount} นัดหมาย • ทั้งหมด ${totalEventsCount} รายการ`
                      )
                      : tr(
                        language,
                        `${todayMeetingsCount} meetings today • ${totalEventsCount} total events`,
                        `วันนี้ ${todayMeetingsCount} นัดหมาย • ทั้งหมด ${totalEventsCount} รายการ`
                      )}
                  </p>
                </div>
              </motion.div>

              {/* Right: actions */}
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: 0.04, ease: "easeOut" }}
                className="flex shrink-0 items-center gap-1 rounded-[20px] border border-slate-200/80 bg-white/82 p-1 shadow-[0_10px_26px_rgba(15,23,42,0.06)] supports-[backdrop-filter]:bg-white/72 supports-[backdrop-filter]:backdrop-blur"
              >
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative size-8 shrink-0 rounded-2xl text-slate-600 transition-[transform,background-color,color] duration-200 hover:-translate-y-0.5 hover:bg-slate-100 hover:text-slate-950 active:scale-[0.98] md:size-9"
                      >
                        <HugeiconsIcon icon={Notification01Icon} className="size-4" />
                        {todayMeetingsCount > 0 && (
                          <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-rose-500 shadow-[0_0_0_3px_rgba(255,255,255,0.95)]" />
                        )}
                      </Button>
                    }
                  />
                  <PopoverContent align="end" className="w-80 p-0">
                    <div className="p-3 border-b border-border">
                      <p className="text-sm font-semibold">{tr(language, "Notifications", "การแจ้งเตือน")}</p>
                    </div>
                    <div className="divide-y divide-border">
                      <div className="flex flex-col items-start gap-1 p-3">
                        <div className="flex items-center gap-2 w-full">
                          <HugeiconsIcon icon={Tick02Icon} className="size-4 text-green-500" />
                          <span className="text-sm font-medium flex-1">
                            {tr(language, "Meeting confirmed", "ยืนยันนัดหมายแล้ว")}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {tr(language, "2m ago", "2 นาทีที่แล้ว")}
                          </span>
                        </div>
                        <p className="pl-6 text-sm text-muted-foreground">
                          {tr(
                            language,
                            "Daily checkin has been confirmed for tomorrow at 9:00 AM",
                            "เช็กอินรายวันได้รับการยืนยันสำหรับพรุ่งนี้เวลา 9:00 น."
                          )}
                        </p>
                      </div>
                      <div className="flex flex-col items-start gap-1 p-3">
                        <div className="flex items-center gap-2 w-full">
                          <HugeiconsIcon icon={Clock01Icon} className="size-4 text-blue-500" />
                          <span className="text-sm font-medium flex-1">
                            {tr(language, "Reminder", "การแจ้งเตือน")}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {tr(language, "15m ago", "15 นาทีที่แล้ว")}
                          </span>
                        </div>
                        <p className="pl-6 text-sm text-muted-foreground">
                          {tr(
                            language,
                            "Team Standup starts in 30 minutes",
                            "ประชุมทีมเริ่มในอีก 30 นาที"
                          )}
                        </p>
                      </div>
                      <div className="flex flex-col items-start gap-1 p-3">
                        <div className="flex items-center gap-2 w-full">
                          <HugeiconsIcon icon={Calendar01Icon} className="size-4 text-orange-500" />
                          <span className="text-sm font-medium flex-1">
                            {tr(language, "Event updated", "อัปเดตอีเวนต์แล้ว")}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {tr(language, "1h ago", "1 ชั่วโมงที่แล้ว")}
                          </span>
                        </div>
                        <p className="pl-6 text-sm text-muted-foreground">
                          {tr(
                            language,
                            "Design Workshop time has been changed to 2:00 PM",
                            "เวลาเวิร์กช็อปออกแบบถูกเปลี่ยนเป็น 14:00 น."
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="p-2 border-t border-border text-center">
                      <span className="text-sm text-muted-foreground">
                        {tr(language, "View all notifications", "ดูการแจ้งเตือนทั้งหมด")}
                      </span>
                    </div>
                  </PopoverContent>
                </Popover>
                {canManageMeetings ? (
                  <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.985 }}>
                    <Button
                      size="icon"
                      className="size-8 shrink-0 rounded-2xl border border-slate-900 bg-slate-900 text-white shadow-[0_14px_28px_rgba(15,23,42,0.16)] transition-[transform,box-shadow,background-color] hover:bg-slate-800 hover:shadow-[0_18px_34px_rgba(15,23,42,0.18)] md:h-9 md:w-auto md:px-3 md:gap-2"
                      onClick={() => {
                        setCreateInitialSlot(null);
                        setCreateOpen(true);
                      }}
                    >
                      <HugeiconsIcon icon={Add01Icon} className="size-4" />
                      <span className="hidden text-sm lg:inline">{tr(language, "Create Event", "สร้างอีเวนต์")}</span>
                    </Button>
                  </motion.div>
                ) : null}
              </motion.div>
            </div>
          </div>
        </div>
        <div className="border-b border-slate-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.94),rgba(255,255,255,0.92))] px-3 py-3 md:px-4">
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.1, ease: "easeOut" }}
            className="flex flex-wrap items-center gap-2 rounded-[22px] border border-slate-200/80 bg-white/84 p-1.5 shadow-[0_12px_26px_rgba(15,23,42,0.05)] supports-[backdrop-filter]:bg-white/72 supports-[backdrop-filter]:backdrop-blur"
          >
            <div className="flex items-center gap-1.5 rounded-[18px] border border-slate-200/80 bg-slate-50/80 p-1">
              <Button
                variant="outline"
                className="h-9 rounded-2xl border-slate-200/80 bg-white/90 px-3.5 text-sm font-semibold text-slate-700 shadow-none transition-colors hover:bg-white"
                onClick={goToPrimaryPeriod}
              >
                {tr(language, "Today", "วันนี้")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-2xl text-slate-500 transition-[transform,background-color,color] duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-slate-900"
                onClick={goToPreviousPeriod}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-2xl text-slate-500 transition-[transform,background-color,color] duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-slate-900"
                onClick={goToNextPeriod}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Button>
            </div>

            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    className="h-9 shrink-0 justify-start gap-2 rounded-2xl border-slate-200/80 bg-white/80 px-3.5 text-left text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50"
                  >
                    <HugeiconsIcon icon={Calendar01Icon} className="size-4 text-slate-400" />
                    <span className="text-sm text-slate-800">
                      {toolbarDateLabel}
                    </span>
                  </Button>
                }
              />
              <PopoverContent
                className="w-auto rounded-[28px] border border-sky-200/80 bg-white p-1.5 shadow-[0_18px_46px_rgba(15,23,42,0.12)]"
                align="start"
              >
                <AnimatedCalendarStandalone
                  mode="single"
                  value={currentWeekStart}
                  onChange={(value: Date | undefined) => {
                    if (value instanceof Date) {
                      goToDate(value);
                      setDatePickerOpen(false);
                    }
                  }}
                  localeStrings={{
                    today: tr(language, "Today", "วันนี้"),
                    clear: tr(language, "Clear", "ล้าง"),
                    selectTime: tr(language, "Select time", "เลือกเวลา"),
                    backToCalendar: tr(language, "Back to calendar", "กลับไปปฏิทิน"),
                    selected: tr(language, "selected", "ที่เลือก"),
                  }}
                  showWeekNumbers
                  showTodayButton
                  showClearButton={false}
                  closeOnSelect
                  className="w-full"
                />
              </PopoverContent>
            </Popover>

            <div className="relative min-w-[220px] flex-1 basis-[280px]">
              <HugeiconsIcon
                icon={Search01Icon}
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              />
              <Input
                placeholder={tr(language, "Search appointments...", "ค้นหานัดหมาย...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 rounded-2xl border-slate-200/80 bg-slate-50/80 pl-9 pr-4 text-sm shadow-none placeholder:text-slate-400"
              />
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/80 px-3.5 text-sm font-medium text-slate-700 shadow-none transition-colors hover:bg-slate-50">
                  <span>{currentViewLabel}</span>
                  <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5 text-slate-400" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 rounded-2xl p-1.5">
                  <DropdownMenuLabel>{tr(language, "View mode", "มุมมอง")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setViewMode("calendar")}>
                    <HugeiconsIcon icon={Calendar01Icon} className="size-4 text-sky-500" />
                    <span>{tr(language, "Week", "สัปดาห์")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode("month")}>
                    <HugeiconsIcon icon={Calendar01Icon} className="size-4 text-indigo-500" />
                    <span>{tr(language, "Month", "เดือน")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode("queue")}>
                    <HugeiconsIcon icon={UserGroupIcon} className="size-4 text-slate-500" />
                    <span>{tr(language, "Queue", "คิว")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {canManageMeetings ? (
                <SchedulePopover
                  language={language}
                  onSchedule={() => {
                    setCreateInitialSlot(null);
                    setCreateOpen(true);
                  }}
                >
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 rounded-2xl border-slate-200/80 bg-white/80 px-3.5 text-sm font-medium text-slate-700 shadow-none transition-colors hover:bg-slate-50 md:w-auto md:gap-2"
                  >
                    <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
                    <span className="hidden md:inline">{tr(language, "Schedule", "นัดหมาย")}</span>
                  </Button>
                </SchedulePopover>
              ) : null}

              <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className={cn(
                        "h-9 gap-2 rounded-2xl border-slate-200/80 bg-white/80 px-3.5 text-sm font-medium text-slate-700 shadow-none transition-colors",
                        hasActiveFilters && "border-sky-200 bg-sky-50 text-sky-800"
                      )}
                    >
                      <HugeiconsIcon icon={FilterIcon} className="size-4" />
                      <span className="hidden text-sm sm:inline">{tr(language, "Filter", "ตัวกรอง")}</span>
                      {hasActiveFilters && (
                        <span className="size-1.5 rounded-full bg-primary" />
                      )}
                    </Button>
                  }
                />
                <PopoverContent
                  className="w-[280px] p-4"
                  align="end"
                >
                  <div className="space-y-4 w-full">
                    {userRole === "doctor" ? (
                      <div>
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                          <HugeiconsIcon
                            icon={UserGroupIcon}
                            className="size-4 text-muted-foreground"
                          />
                          {tr(language, "Scope", "ขอบเขต")}
                        </h4>
                        <div className="space-y-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8.5 w-full justify-between px-3"
                            onClick={() => setDoctorScope("my-meetings")}
                          >
                            <span className="text-sm">{tr(language, "My Meetings", "นัดหมายของฉัน")}</span>
                            {doctorScope === "my-meetings" ? (
                              <HugeiconsIcon icon={Tick02Icon} className="size-4 text-primary" />
                            ) : null}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8.5 w-full justify-between px-3"
                            onClick={() => setDoctorScope("care-team")}
                          >
                            <span className="text-sm">{tr(language, "Care Team", "ทีมดูแล")}</span>
                            {doctorScope === "care-team" ? (
                              <HugeiconsIcon icon={Tick02Icon} className="size-4 text-primary" />
                            ) : null}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8.5 w-full justify-between px-3"
                            onClick={() => setDoctorScope("all-visible")}
                          >
                            <span className="text-sm">{tr(language, "All Visible", "มองเห็นทั้งหมด")}</span>
                            {doctorScope === "all-visible" ? (
                              <HugeiconsIcon icon={Tick02Icon} className="size-4 text-primary" />
                            ) : null}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {userRole === "doctor" ? <Separator /> : null}

                    <div>
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <HugeiconsIcon
                          icon={Calendar01Icon}
                          className="size-4 text-muted-foreground"
                        />
                        {tr(language, "Room Assignment", "การกำหนดห้อง")}
                      </h4>
                      <div className="space-y-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8.5 w-full justify-between px-3"
                          onClick={() => setEventTypeFilter("all")}
                        >
                          <span className="text-sm">{tr(language, "All events", "ทุกอีเวนต์")}</span>
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
                          className="h-8.5 w-full justify-between px-3"
                          onClick={() => setEventTypeFilter("with-room")}
                        >
                          <div className="flex items-center gap-2.5">
                            <HugeiconsIcon
                              icon={DoorIcon}
                              className="size-4 text-cyan-500"
                            />
                            <span className="text-sm">{tr(language, "With room", "มีห้อง")}</span>
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
                          className="h-8.5 w-full justify-between px-3"
                          onClick={() => setEventTypeFilter("without-room")}
                        >
                          <div className="flex items-center gap-2.5">
                            <HugeiconsIcon
                              icon={DoorIcon}
                              className="size-4 text-muted-foreground"
                            />
                            <span className="text-sm">{tr(language, "Without room", "ไม่มีห้อง")}</span>
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

                    <Separator />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">
                            {tr(language, "Show cancelled", "แสดงนัดที่ยกเลิก")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tr(
                              language,
                              "Cancelled appointments are hidden from the main calendar until you turn this on.",
                              "นัดที่ยกเลิกจะถูกซ่อนจากปฏิทินหลักไว้ก่อน จนกว่าคุณจะเปิดตัวเลือกนี้"
                            )}
                          </p>
                        </div>
                        <Switch
                          checked={includeCancelled}
                          onCheckedChange={setIncludeCancelled}
                          aria-label={tr(language, "Show cancelled appointments", "แสดงนัดที่ยกเลิก")}
                        />
                      </div>
                    </div>

                    {hasActiveFilters && (
                      <>
                        <Separator />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8.5 w-full"
                          onClick={() => {
                            setEventTypeFilter("all");
                            setIncludeCancelled(false);
                          }}
                        >
                          {tr(language, "Clear all filters", "ล้างตัวกรองทั้งหมด")}
                        </Button>
                      </>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          Calendar Grid / Queue View
          ══════════════════════════════════════════════════ */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-3xl space-y-3 px-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-[360px] w-full rounded-xl" />
          </div>
        </div>
      ) : viewMode === "calendar" ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <CalendarView
            onSlotSelect={handleSlotSelect}
            onEditMeeting={(meeting) => {
              if (!canManageMeetings) {
                return;
              }
              setEditMeeting(meeting);
              setCreateInitialSlot(null);
              setCreateOpen(true);
            }}
            onRefresh={loadMeetings}
          />
        </div>
      ) : viewMode === "month" ? (
        <div className="flex-1 flex flex-col overflow-auto">
          <MonthCalendarView
            onEditMeeting={(meeting) => {
              if (!canManageMeetings) {
                return;
              }
              setEditMeeting(meeting);
              setCreateInitialSlot(null);
              setCreateOpen(true);
            }}
            onSlotSelect={handleSlotSelect}
            onGoToWeek={(date) => {
              goToDate(date);
              setViewMode("calendar");
            }}
            onRefresh={loadMeetings}
          />
        </div>
      ) : (
        <QueueView
          onRefresh={loadMeetings}
          onEditMeeting={(meeting) => {
            if (!canManageMeetings) {
              return;
            }
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
          userRole={userRole}
          initialSlot={createInitialSlot}
          editMeeting={editMeeting}
          onCreated={handleMeetingCreated}
          token={token}
          language={language}
        />
      )}
    </main>
  );
}
