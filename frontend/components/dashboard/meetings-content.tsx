"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { addWeeks, setHours, setMinutes } from "date-fns";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { AnimatedCalendar } from "@/components/ui/calender";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Settings01Icon,
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
  Notification01Icon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { CalendarView, type CalendarSlotSelection } from "./calendar-view";
import { QueueView } from "./queue-view";
import { MonthCalendarPopover } from "./month-calendar-popover";
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
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";

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

function includesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
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
    () =>
      items.filter(
        (patient) =>
          patient.label.toLowerCase().includes(query.toLowerCase()) ||
          patient.status.toLowerCase().includes(query.toLowerCase()) ||
          (patient.description || "").toLowerCase().includes(query.toLowerCase())
      ),
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
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
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
          <div className="relative w-full rounded-[34px] border border-border bg-background pb-6">
            <div className="px-7 pb-3 pt-7">
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

            <div className="max-h-[280px] overflow-y-auto px-7 pb-24">
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
                      className="px-6 py-4"
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

                <div className="flex-1 overflow-y-auto px-6 py-2">
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
        <img
          src={member.avatar}
          alt={member.label}
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
        <img
          src={member.avatar}
          alt={member.label}
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
    () =>
      items.filter(
        (doctor) =>
          doctor.label.toLowerCase().includes(query.toLowerCase()) ||
          doctor.role.toLowerCase().includes(query.toLowerCase()) ||
          (doctor.description || "").toLowerCase().includes(query.toLowerCase())
      ),
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
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
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
          <div className="relative w-full rounded-[34px] border border-border bg-background pb-6">
            <div className="px-7 pb-3 pt-7">
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

            <div className="max-h-[280px] overflow-y-auto px-7 pb-24">
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
                      className="px-6 py-4"
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

                <div className="flex-1 overflow-y-auto px-6 py-2">
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
            <h4 className="text-sm font-semibold mb-3">{tr(language, "Schedule Meeting", "นัดหมายการประชุม")}</h4>
            <p className="text-xs text-muted-foreground mb-4">
              {tr(language, "Quick schedule a meeting or event", "สร้างนัดหมายหรืออีเวนต์อย่างรวดเร็ว")}
            </p>
          </div>

          <div className="space-y-3">
            {/* Date */}
            <div className="grid gap-2">
              <Label className="text-xs">{tr(language, "Date", "วันที่")}</Label>
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
                <Label className="text-xs">{tr(language, "Start", "เริ่ม")}</Label>
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
                <Label className="text-xs">{tr(language, "End", "สิ้นสุด")}</Label>
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
                <span>{tr(language, "Add participants", "เพิ่มผู้เข้าร่วม")}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 justify-start gap-2 text-xs"
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
                className="flex-1 h-8 text-xs"
                onClick={() => setOpen(false)}
              >
                {tr(language, "Cancel", "ยกเลิก")}
              </Button>
              <Button
                size="sm"
                className="flex-1 h-8 text-xs"
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
    const query = doctorQuery.trim();
    if (!query) return doctors;
    if (query.length < 2) {
      return doctors.filter((doctor) => {
        const display = formatDoctorDisplayName(doctor);
        return (
          includesQuery(display, query) ||
          includesQuery(doctor.email || "", query)
        );
      });
    }
    return doctorSearchResults;
  }, [doctorQuery, doctors, doctorSearchResults]);

  const visiblePatients = useMemo(() => {
    const query = patientQuery.trim();
    if (!query) return patients;
    if (query.length < 2) {
      return patients.filter((patient) => {
        const display = formatPatientDisplayName(patient);
        return (
          includesQuery(display, query) ||
          includesQuery(patient.email || "", query)
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
  }, [endHour, endMinute, startHour, startMinute]);

  useEffect(() => {
    if (open) return;
    setDoctorPickerOpen(false);
    setPatientPickerOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open || !doctorPickerOpen || isDoctorUser) return;
    const query = doctorQuery.trim();
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
    const query = patientQuery.trim();
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
    const dt = setMinutes(setHours(selectedDate, startHour), startMinute);
    return dt.toISOString();
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
        toast.success(tr(language, "Appointment scheduled successfully", "นัดหมายสำเร็จ"));
        onOpenChange(false);
        await onCreated(createdMeeting);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : tr(language, "Failed to create appointment", "สร้างนัดหมายไม่สำเร็จ");
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
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

        <div className="px-6 pb-2 space-y-5">
          {/* ── Date & Time Selection ── */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
            <p className="text-[11px] text-muted-foreground">
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
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {tr(language, "Start Time", "เวลาเริ่ม")}
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
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
                    className="size-4 shrink-0 text-[#7ac2f0]"
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
                <p className="text-[11px] text-muted-foreground">
                  {tr(
                    language,
                    "Click to open doctor search panel.",
                    "กดปุ่มเพื่อเปิดหน้าค้นหาแพทย์"
                  )}
                </p>
              )}
              {isDoctorUser && (
                <p className="text-[11px] text-muted-foreground">
                  {tr(language, "Doctor is locked to your account.", "แพทย์ถูกล็อกตามบัญชีของคุณ")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
              <p className="text-[11px] text-muted-foreground">
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
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {tr(language, "Description", "รายละเอียด")}
              </Label>
              <Input
                placeholder={tr(language, "Follow-up consultation", "ติดตามอาการ")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {tr(language, "Room / Meeting Link", "ห้อง / ลิงก์ประชุม")}
                </Label>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
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
              <p className="text-[11px] text-muted-foreground">
                {meetingLinkHelperText}
              </p>
            </div>
          </div>

          {/* ── Notes ── */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {tr(language, "Notes", "บันทึก")}
            </Label>
            <Textarea
              placeholder={tr(language, "Additional notes or instructions...", "หมายเหตุหรือคำสั่งเพิ่มเติม...")}
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
            {tr(language, "Cancel", "ยกเลิก")}
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
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const userRole = useAuthStore((state) => state.role);
  const clearToken = useAuthStore((state) => state.clearToken);
  const language = useLanguageStore((state) => state.language);

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
  const [doctorScope, setDoctorScope] = useState<
    "all-visible" | "my-meetings" | "care-team"
  >("my-meetings");

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

  const todayMeetingsCount = meetings.filter(
    (m) => new Date(m.date_time).toDateString() === new Date().toDateString()
  ).length;
  const totalEventsCount = meetings.length;

  const hasActiveFilters = eventTypeFilter !== "all";

  const loadMeetings = useCallback(
    async (background = false) => {
      if (!token) return;
      if (!background) setLoading(true);
      try {
        const doctorFilter =
          userRole === "doctor" && doctorScope === "my-meetings" && userId
            ? userId
            : undefined;

        const res = await fetchMeetings(
          { page: 1, limit: 1000, doctor_id: doctorFilter },
          token
        );

        const scopedItems =
          userRole === "doctor" && doctorScope === "care-team" && userId
            ? res.items.filter((item) => item.doctor_id !== userId)
            : res.items;

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
    },
    [token, setMeetings, clearToken, router, userRole, userId, doctorScope]
  );

  const handleMeetingCreated = useCallback(
    async (meeting?: Meeting) => {
      // If we have a date (new meeting), go to it
      // But if we just edited an existing one, user might want to stay in current view
      if (meeting?.date_time && viewMode === "calendar") {
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
    setCreateInitialSlot(slot);
    setCreateOpen(true);
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // Load patients & doctors for form
  useEffect(() => {
    if (!token) return;
    fetchPatients({ page: 1, limit: 200, sort: "first_name", order: "asc" }, token)
      .then((res) => setPatients(res.items))
      .catch(() => { });
    // Doctors can't access /users endpoint; use /auth/me for their own info
    if (userRole === "doctor") {
      fetchCurrentUser(token)
        .then((me) => setDoctors([{ id: me.id, email: me.email, first_name: me.first_name, last_name: me.last_name, role: me.role, is_active: true }]))
        .catch(() => { });
    } else {
      fetchUsers({ page: 1, limit: 100, role: "doctor", clinical_only: true, sort: "first_name", order: "asc" }, token)
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
                    {formatDateLabel(currentWeekStart, language, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </h1>
                  <p className="hidden md:block text-xs text-muted-foreground">
                    {language === "th"
                      ? `คุณมีนัดหมาย ${todayMeetingsCount} รายการ และอีเวนต์ ${totalEventsCount} รายการในวันนี้ 🗓️`
                      : `You have ${todayMeetingsCount} meeting${todayMeetingsCount !== 1 ? "s" : ""} and ${totalEventsCount} event${totalEventsCount !== 1 ? "s" : ""} today 🗓️`}
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
                      <p className="text-sm font-semibold">{tr(language, "Notifications", "การแจ้งเตือน")}</p>
                    </div>
                    <div className="divide-y divide-border">
                      <div className="flex flex-col items-start gap-1 p-3">
                        <div className="flex items-center gap-2 w-full">
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            className="size-4 text-green-500"
                          />
                          <span className="text-sm font-medium flex-1">
                            {tr(language, "Meeting confirmed", "ยืนยันนัดหมายแล้ว")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {tr(language, "2m ago", "2 นาทีที่แล้ว")}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground pl-6">
                          {tr(
                            language,
                            "Daily checkin has been confirmed for tomorrow at 9:00 AM",
                            "เช็กอินรายวันได้รับการยืนยันสำหรับพรุ่งนี้เวลา 9:00 น."
                          )}
                        </p>
                      </div>
                      <div className="flex flex-col items-start gap-1 p-3">
                        <div className="flex items-center gap-2 w-full">
                          <HugeiconsIcon
                            icon={Clock01Icon}
                            className="size-4 text-blue-500"
                          />
                          <span className="text-sm font-medium flex-1">
                            {tr(language, "Reminder", "การแจ้งเตือน")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {tr(language, "15m ago", "15 นาทีที่แล้ว")}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground pl-6">
                          {tr(
                            language,
                            "Team Standup starts in 30 minutes",
                            "ประชุมทีมเริ่มในอีก 30 นาที"
                          )}
                        </p>
                      </div>
                      <div className="flex flex-col items-start gap-1 p-3">
                        <div className="flex items-center gap-2 w-full">
                          <HugeiconsIcon
                            icon={Calendar01Icon}
                            className="size-4 text-orange-500"
                          />
                          <span className="text-sm font-medium flex-1">
                            {tr(language, "Event updated", "อัปเดตอีเวนต์แล้ว")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {tr(language, "1h ago", "1 ชั่วโมงที่แล้ว")}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground pl-6">
                          {tr(
                            language,
                            "Design Workshop time has been changed to 2:00 PM",
                            "เวลาเวิร์กช็อปออกแบบถูกเปลี่ยนเป็น 14:00 น."
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="p-2 border-t border-border text-center">
                      <span className="text-xs text-muted-foreground">
                        {tr(language, "View all notifications", "ดูการแจ้งเตือนทั้งหมด")}
                      </span>
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Schedule popover */}
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
                    className="size-7 md:size-8 shrink-0 md:w-auto md:px-2 md:gap-1.5"
                  >
                    <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
                    <span className="hidden lg:inline text-xs">{tr(language, "Schedule", "นัดหมาย")}</span>
                  </Button>
                </SchedulePopover>

                <MonthCalendarPopover
                  meetings={meetings}
                  patients={patients}
                  doctors={doctors}
                  token={token}
                  currentUserId={userId}
                  userRole={userRole}
                  onMeetingCreated={handleMeetingCreated}
                />

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
                    title={tr(language, "Calendar view", "มุมมองปฏิทิน")}
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
                    title={tr(language, "Queue view", "มุมมองคิว")}
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
                  <span className="hidden lg:inline text-xs">{tr(language, "Create Event", "สร้างอีเวนต์")}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {userRole === "doctor" && (
          <div className="px-3 md:px-6 py-3 border-b border-border bg-background">
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                {tr(language, "Scope:", "ขอบเขต:")}
              </span>
              <Button
                variant={doctorScope === "all-visible" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs whitespace-nowrap"
                onClick={() => setDoctorScope("all-visible")}
              >
                {tr(language, "All Visible", "มองเห็นทั้งหมด")}
              </Button>
              <Button
                variant={doctorScope === "my-meetings" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs whitespace-nowrap"
                onClick={() => setDoctorScope("my-meetings")}
              >
                {tr(language, "My Meetings", "นัดหมายของฉัน")}
              </Button>
              <Button
                variant={doctorScope === "care-team" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs whitespace-nowrap"
                onClick={() => setDoctorScope("care-team")}
              >
                {tr(language, "Care Team", "ทีมดูแล")}
              </Button>
            </div>
          </div>
        )}

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
                  placeholder={tr(language, "Search in calendar...", "ค้นหาในปฏิทิน...")}
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
                {tr(language, "Today", "วันนี้")}
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
                        {weekStartLabel} - {weekEndLabel}
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
                      <span className="hidden sm:inline text-xs">{tr(language, "Filter", "ตัวกรอง")}</span>
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
                        {tr(language, "Room Assignment", "การกำหนดห้อง")}
                      </h4>
                      <div className="space-y-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-between h-9 px-3"
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
                          className="w-full justify-between h-9 px-3"
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
                          className="w-full justify-between h-9 px-3"
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
                          {tr(language, "Clear all filters", "ล้างตัวกรองทั้งหมด")}
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
