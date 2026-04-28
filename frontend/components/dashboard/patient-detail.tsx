"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  Gauge,
  HeartPulse,
  Mail,
  MapPin,
  Phone,
  Play,
  RefreshCcw,
  ShieldCheck,
  Square,
  Stethoscope,
  UserRound,
  Volume2,
} from "lucide-react";

import type { AppLanguage } from "@/store/language-config";
import {
  fetchMeetings,
  fetchPatient,
  fetchPatientContactDetails,
  fetchPatientPressureReadings,
  getErrorMessage,
  type Meeting,
  type Patient,
  type PatientContactDetails,
  type PressureRecord,
  type PressureRiskLevel,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPatientWorkspaceHrefs } from "@/components/dashboard/dashboard-route-utils";
import { PatientDeviceSessionHistory } from "@/components/dashboard/patient-device-session-history";
import { getPatientLoadErrorTitle } from "@/components/dashboard/patient-load-error";
import {
  readPatientDetailCache,
  writePatientDetailCache,
} from "@/lib/patient-workspace-cache";
import { preloadPatientHeartSoundBundle } from "@/lib/patient-workspace-prefetch";
import { toast } from "@/components/ui/toast";

interface PatientDetailContentProps {
  patientId: string;
}

interface WorkspaceNavItem {
  key: string;
  label: string;
  enabled: boolean;
  onSelect?: () => void;
}

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: "primary" | "emerald" | "amber";
}

interface InfoRowProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  empty?: boolean;
}

const CONTACT_REVEAL_TIMEOUT_MS = 60_000;
const PRESSURE_POLL_INTERVAL_MS = 3_000;
const PRESSURE_DEMO_INTERVAL_MS = 1_600;
const MAX_DEMO_PRESSURE_READINGS = 10;

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

const getPressureRiskLabel = (level: PressureRiskLevel, language: AppLanguage) => {
  if (level === "danger") return tr(language, "Danger", "อันตราย");
  if (level === "moderate") return tr(language, "Moderate", "ปานกลาง");
  return tr(language, "Normal", "ปกติ");
};

const getPressureRiskTone = (level: PressureRiskLevel) => {
  if (level === "danger") {
    return {
      icon: AlertTriangle,
      bannerClass: "border-red-200 bg-card text-red-800",
      badgeClass: "border-red-200 bg-red-50 text-red-700",
      accentClass: "text-red-600",
      iconClass: "border-red-100 bg-red-50 text-red-600",
    };
  }
  if (level === "moderate") {
    return {
      icon: AlertTriangle,
      bannerClass: "border-amber-200 bg-card text-amber-800",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
      accentClass: "text-amber-600",
      iconClass: "border-amber-100 bg-amber-50 text-amber-600",
    };
  }
  return {
    icon: CheckCircle2,
    bannerClass: "border-emerald-200 bg-card text-emerald-800",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    accentClass: "text-emerald-600",
    iconClass: "border-emerald-100 bg-emerald-50 text-emerald-600",
  };
};

const getPressureRiskHint = (record: PressureRecord, language: AppLanguage) => {
  if (record.risk.level === "danger") {
    return tr(
      language,
      "Latest reading needs urgent clinical review.",
      "ค่าล่าสุดเข้าเกณฑ์ที่ต้องรีบประเมินทางคลินิก"
    );
  }
  if (record.risk.level === "moderate") {
    return tr(
      language,
      "Latest reading is outside the normal range and should be followed.",
      "ค่าล่าสุดเริ่มออกนอกช่วงปกติ ควรติดตามต่อ"
    );
  }
  return tr(
    language,
    "Latest heart rate and blood pressure are in the normal range.",
    "อัตราการเต้นหัวใจและความดันล่าสุดอยู่ในช่วงปกติ"
  );
};

const buildMockPressureReadings = (patientId: string): PressureRecord[] => {
  const now = Date.now();
  const measuredAt = new Date(now - 4 * 60 * 1000).toISOString();
  const earlierAt = new Date(now - 34 * 60 * 1000).toISOString();
  const oldestAt = new Date(now - 74 * 60 * 1000).toISOString();

  return [
    {
      id: `${patientId}-mock-pressure-1`,
      patient_id: patientId,
      device_exam_session_id: null,
      device_id: "mock-bp-device-001",
      heart_rate: 78,
      sys_rate: 130,
      dia_rate: 85,
      measured_at: measuredAt,
      created_at: measuredAt,
      risk: {
        level: "moderate",
        heart_rate_level: "normal",
        blood_pressure_level: "moderate",
        reasons: ["sys_rate between 120-139 mmHg (130)", "dia_rate between 80-89 mmHg (85)"],
      },
    },
    {
      id: `${patientId}-mock-pressure-2`,
      patient_id: patientId,
      device_exam_session_id: null,
      device_id: "mock-bp-device-001",
      heart_rate: 74,
      sys_rate: 118,
      dia_rate: 76,
      measured_at: earlierAt,
      created_at: earlierAt,
      risk: {
        level: "normal",
        heart_rate_level: "normal",
        blood_pressure_level: "normal",
        reasons: [],
      },
    },
    {
      id: `${patientId}-mock-pressure-3`,
      patient_id: patientId,
      device_exam_session_id: null,
      device_id: "mock-bp-device-001",
      heart_rate: 124,
      sys_rate: 146,
      dia_rate: 92,
      measured_at: oldestAt,
      created_at: oldestAt,
      risk: {
        level: "danger",
        heart_rate_level: "danger",
        blood_pressure_level: "danger",
        reasons: ["heart_rate above 120 bpm (124)", "sys_rate at least 140 mmHg (146)"],
      },
    },
  ];
};

const demoPressureSequence: Array<{
  heartRate: number;
  sysRate: number;
  diaRate: number;
  risk: PressureRecord["risk"];
}> = [
  {
    heartRate: 76,
    sysRate: 118,
    diaRate: 76,
    risk: {
      level: "normal",
      heart_rate_level: "normal",
      blood_pressure_level: "normal",
      reasons: [],
    },
  },
  {
    heartRate: 82,
    sysRate: 130,
    diaRate: 85,
    risk: {
      level: "moderate",
      heart_rate_level: "normal",
      blood_pressure_level: "moderate",
      reasons: ["sys_rate between 120-139 mmHg (130)", "dia_rate between 80-89 mmHg (85)"],
    },
  },
  {
    heartRate: 126,
    sysRate: 148,
    diaRate: 94,
    risk: {
      level: "danger",
      heart_rate_level: "danger",
      blood_pressure_level: "danger",
      reasons: ["heart_rate above 120 bpm (126)", "sys_rate at least 140 mmHg (148)"],
    },
  },
  {
    heartRate: 104,
    sysRate: 136,
    diaRate: 86,
    risk: {
      level: "moderate",
      heart_rate_level: "moderate",
      blood_pressure_level: "moderate",
      reasons: ["heart_rate above normal range 60-100 bpm (104)", "sys_rate between 120-139 mmHg (136)"],
    },
  },
];

const buildDemoPressureReading = (patientId: string, sequence: number): PressureRecord => {
  const sample = demoPressureSequence[sequence % demoPressureSequence.length];
  const measuredAt = new Date().toISOString();

  return {
    id: `${patientId}-demo-pressure-${sequence}-${Date.now()}`,
    patient_id: patientId,
    device_exam_session_id: null,
    device_id: "demo-bp-device-001",
    heart_rate: sample.heartRate,
    sys_rate: sample.sysRate,
    dia_rate: sample.diaRate,
    measured_at: measuredAt,
    created_at: measuredAt,
    risk: sample.risk,
  };
};

const getGenderLabel = (
  value: string | null | undefined,
  language: AppLanguage
): string => {
  if (!value) return "—";
  const normalized = value.toLowerCase();
  if (normalized === "male") return tr(language, "Male", "ชาย");
  if (normalized === "female") return tr(language, "Female", "หญิง");
  if (normalized === "other") return tr(language, "Other", "อื่น ๆ");
  return value;
};

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
}: StatTileProps) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200/80 bg-white text-emerald-700"
      : tone === "amber"
        ? "border-amber-200/80 bg-white text-amber-700"
        : "border-border/80 bg-white text-primary";

  return (
    <div className={cn("rounded-2xl border p-4", toneClass)}>
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-xl bg-muted p-2">
          <Icon className="size-4" />
        </div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-current/70">
          {label}
        </p>
      </div>
      <p className="text-lg font-semibold text-foreground sm:text-xl">{value}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{hint}</p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, detail, empty = false }: InfoRowProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3.5",
        empty ? "border-dashed border-border/70 bg-muted/15" : "border-border/80 bg-background"
      )}
    >
      <div className="rounded-xl bg-muted p-2 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p className={cn("mt-1 text-sm font-medium text-foreground", empty && "text-muted-foreground")}>
          {value}
        </p>
        {detail ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

export function PatientDetailContent({ patientId }: PatientDetailContentProps) {
  const token = useAuthStore((state) => state.token);
  const clearToken = useAuthStore((state) => state.clearToken);
  const userId = useAuthStore((state) => state.userId);
  const language = useLanguageStore((state) => state.language);
  const router = useRouter();
  const canUseProtectedCache = Boolean(token && userId);
  const cachedSnapshot = React.useMemo(
    () => (canUseProtectedCache ? readPatientDetailCache(userId, patientId) : null),
    [canUseProtectedCache, patientId, userId]
  );

  const [patient, setPatient] = useState<Patient | null>(
    () => cachedSnapshot?.patient ?? null
  );
  const [meetings, setMeetings] = useState<Meeting[]>(
    () => cachedSnapshot?.meetings ?? []
  );
  const [meetingsTotal, setMeetingsTotal] = useState(
    () => cachedSnapshot?.meetingsTotal ?? 0
  );
  const [loadingPatient, setLoadingPatient] = useState(
    () => !cachedSnapshot?.patient
  );
  const [loadingMeetings, setLoadingMeetings] = useState(
    () => !cachedSnapshot?.meetings.length
  );
  const [error, setError] = useState<string | null>(null);
  const [contactDetails, setContactDetails] = useState<PatientContactDetails | null>(null);
  const [loadingContactDetails, setLoadingContactDetails] = useState(false);
  const [contactDetailsError, setContactDetailsError] = useState<string | null>(null);
  const [contactDetailsRevealed, setContactDetailsRevealed] = useState(false);
  const [pressureReadings, setPressureReadings] = useState<PressureRecord[]>([]);
  const [pressureTotal, setPressureTotal] = useState(0);
  const [loadingPressureReadings, setLoadingPressureReadings] = useState(true);
  const [pressureReadingsError, setPressureReadingsError] = useState<string | null>(null);
  const [demoPressureReadings, setDemoPressureReadings] = useState<PressureRecord[]>([]);
  const [isPressureDemoRunning, setIsPressureDemoRunning] = useState(false);
  const pressureDemoSequenceRef = React.useRef(0);
  const patientWorkspaceHrefs = React.useMemo(
    () => getPatientWorkspaceHrefs(patientId),
    [patientId]
  );

  useEffect(() => {
    patientWorkspaceHrefs.forEach((href) => {
      router.prefetch(href);
    });
    void preloadPatientHeartSoundBundle();
  }, [patientWorkspaceHrefs, router]);

  useEffect(() => {
    setPatient(cachedSnapshot?.patient ?? null);
    setMeetings(cachedSnapshot?.meetings ?? []);
    setMeetingsTotal(cachedSnapshot?.meetingsTotal ?? 0);
    setLoadingPatient(!cachedSnapshot?.patient);
    setLoadingMeetings(!(cachedSnapshot?.meetings.length ?? 0));
    setError(null);
    setContactDetails(null);
    setContactDetailsError(null);
    setLoadingContactDetails(false);
    setContactDetailsRevealed(false);
    setPressureReadings([]);
    setPressureTotal(0);
    setLoadingPressureReadings(true);
    setPressureReadingsError(null);
    setDemoPressureReadings([]);
    setIsPressureDemoRunning(false);
    pressureDemoSequenceRef.current = 0;
  }, [cachedSnapshot]);

  useEffect(() => {
    if (!contactDetailsRevealed) {
      setContactDetails(null);
      setContactDetailsError(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setContactDetailsRevealed(false);
    }, CONTACT_REVEAL_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [contactDetailsRevealed]);

  const revealContactDetails = React.useCallback(async () => {
    if (!token) {
      router.replace("/login");
      return;
    }

    setLoadingContactDetails(true);
    setContactDetailsError(null);

    try {
      const revealed = await fetchPatientContactDetails(patientId, token);
      setContactDetails(revealed);
      setContactDetailsRevealed(true);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      const detail = getErrorMessage(
        err,
        tr(language, "Protected details could not be revealed.", "ยังไม่สามารถแสดงข้อมูลที่ถูกปกป้องได้")
      );
      setContactDetailsError(detail);
      toast.error(detail);
    } finally {
      setLoadingContactDetails(false);
    }
  }, [clearToken, language, patientId, router, token]);

  const handleToggleContactDetails = React.useCallback(async () => {
    if (contactDetailsRevealed) {
      setContactDetailsRevealed(false);
      return;
    }

    await revealContactDetails();
  }, [contactDetailsRevealed, revealContactDetails]);

  const pushDemoPressureReading = React.useCallback(() => {
    const nextReading = buildDemoPressureReading(
      patientId,
      pressureDemoSequenceRef.current
    );
    pressureDemoSequenceRef.current += 1;
    setDemoPressureReadings((current) => [
      nextReading,
      ...current,
    ].slice(0, MAX_DEMO_PRESSURE_READINGS));
  }, [patientId]);

  const handleTogglePressureDemo = React.useCallback(() => {
    setPressureReadingsError(null);
    setLoadingPressureReadings(false);

    if (isPressureDemoRunning) {
      setIsPressureDemoRunning(false);
      setDemoPressureReadings([]);
      pressureDemoSequenceRef.current = 0;
      return;
    }

    setDemoPressureReadings([]);
    pressureDemoSequenceRef.current = 0;
    pushDemoPressureReading();
    setIsPressureDemoRunning(true);
  }, [isPressureDemoRunning, pushDemoPressureReading]);

  const loadPressureReadings = React.useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (!token) {
        return;
      }

      const showLoading = options.showLoading ?? false;
      if (showLoading) {
        setLoadingPressureReadings(true);
      }
      setPressureReadingsError(null);

      try {
        const res = await fetchPatientPressureReadings(patientId, token);
        setPressureReadings(res.items);
        setPressureTotal(res.total);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        if (status === 404) {
          setPressureReadings([]);
          setPressureTotal(0);
          setPressureReadingsError(null);
          return;
        }
        setPressureReadingsError(
          getErrorMessage(
            err,
            tr(language, "Vital signs could not be loaded.", "ยังไม่สามารถโหลดสัญญาณชีพได้")
          )
        );
      } finally {
        if (showLoading) {
          setLoadingPressureReadings(false);
        }
      }
    },
    [clearToken, language, patientId, router, token]
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const hasCachedPatient = Boolean(cachedSnapshot?.patient);

    const loadPatient = async () => {
      if (!hasCachedPatient) {
        setLoadingPatient(true);
      }
      setError(null);
      try {
        const data = await fetchPatient(patientId, token);
        if (!cancelled) {
          setPatient(data);
          writePatientDetailCache(userId, patientId, {
            patient: data,
            patientCachedAt: Date.now(),
          });
        }
      } catch (err) {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(
          getPatientLoadErrorTitle(err, language)
        );
      } finally {
        if (!cancelled) setLoadingPatient(false);
      }
    };

    loadPatient();
    return () => {
      cancelled = true;
    };
  }, [token, patientId, language, clearToken, router, cachedSnapshot?.patient, userId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const hasCachedMeetings = Boolean(cachedSnapshot?.meetings.length);

    const loadMeetings = async () => {
      if (!hasCachedMeetings) {
        setLoadingMeetings(true);
      }
      try {
        const res = await fetchMeetings(
          { patient_id: patientId, limit: 100, sort: "date_time", order: "desc" },
          token
        );
        if (!cancelled) {
          setMeetings(res.items);
          setMeetingsTotal(res.total);
          writePatientDetailCache(userId, patientId, {
            meetings: res.items,
            meetingsTotal: res.total,
            meetingsCachedAt: Date.now(),
          });
        }
      } catch (err) {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 401) {
          clearToken();
          router.replace("/login");
        }
      } finally {
        if (!cancelled) setLoadingMeetings(false);
      }
    };

    loadMeetings();
    return () => {
      cancelled = true;
    };
  }, [token, patientId, clearToken, router, cachedSnapshot?.meetings.length, userId]);

  useEffect(() => {
    if (!token) return;

    void loadPressureReadings({ showLoading: true });
    const intervalId = window.setInterval(() => {
      void loadPressureReadings({ showLoading: false });
    }, PRESSURE_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadPressureReadings, token]);

  useEffect(() => {
    if (!isPressureDemoRunning) return;

    const intervalId = window.setInterval(() => {
      pushDemoPressureReading();
    }, PRESSURE_DEMO_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [isPressureDemoRunning, pushDemoPressureReading]);

  const getAge = (dateOfBirth: string) => {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    return age;
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString(language === "th" ? "th-TH" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString(language === "th" ? "th-TH" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (loadingPatient) {
    return (
      <div className="space-y-6 py-2">
        <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-sm">
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)] lg:p-6">
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <Skeleton className="size-16 rounded-3xl" />
                <div className="space-y-3">
                  <Skeleton className="h-5 w-28 rounded-full" />
                  <Skeleton className="h-8 w-56" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-30 rounded-2xl" />
                ))}
              </div>
              <Skeleton className="h-24 rounded-2xl" />
            </div>
            <Skeleton className="h-full min-h-52 rounded-3xl" />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <Skeleton className="h-72 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </div>
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    );
  }

  if (error || !patient) {
    return (
      <Card className="overflow-hidden rounded-[28px] border-destructive/20 bg-[linear-gradient(135deg,rgba(201,94,74,0.10),rgba(255,255,255,0.96))] shadow-sm">
        <CardContent className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
          <div className="rounded-3xl bg-destructive/10 p-4 text-destructive shadow-sm ring-1 ring-destructive/10">
            <Stethoscope className="size-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">
              {error || tr(language, "Patient not found", "ไม่พบผู้ป่วย")}
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {tr(language, "Unable to load patient data.", "ไม่สามารถโหลดข้อมูลผู้ป่วยได้")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const age = getAge(patient.date_of_birth);
  const now = new Date();
  const futureMeetings = meetings
    .filter((meeting) => new Date(meeting.date_time).getTime() >= now.getTime())
    .sort(
      (left, right) =>
        new Date(left.date_time).getTime() - new Date(right.date_time).getTime()
    );
  const nextMeeting = futureMeetings[0] ?? null;
  const workspaceSignals = [
    patient.gender,
    meetingsTotal > 0 ? "visit-history" : null,
    nextMeeting ? "next-visit" : null,
  ];
  const workspaceReadinessScore = Math.round(
    (workspaceSignals.filter((field) => Boolean(field)).length / workspaceSignals.length) * 100
  );
  const patientInitials = [patient.first_name, patient.last_name]
    .map((part) => part?.trim().charAt(0) ?? "")
    .join("")
    .toUpperCase();
  const mockPressureReadings = buildMockPressureReadings(patientId);
  const isUsingDemoPressureReadings = demoPressureReadings.length > 0;
  const isUsingMockPressureReadings =
    !loadingPressureReadings &&
    !pressureReadingsError &&
    pressureReadings.length === 0 &&
    !isUsingDemoPressureReadings;
  const displayPressureReadings = isUsingDemoPressureReadings
    ? demoPressureReadings
    : pressureReadings.length > 0
    ? pressureReadings
    : mockPressureReadings;
  const displayPressureTotal = isUsingDemoPressureReadings
    ? demoPressureReadings.length
    : pressureReadings.length > 0
    ? pressureTotal
    : mockPressureReadings.length;
  const latestPressureReading = displayPressureReadings[0] ?? null;
  const latestPressureRiskTone = latestPressureReading
    ? getPressureRiskTone(latestPressureReading.risk.level)
    : null;
  const LatestPressureRiskIcon = latestPressureRiskTone?.icon ?? Activity;
  const heartSoundHref = patientWorkspaceHrefs[1];
  const denseModeHref = patientWorkspaceHrefs[2];
  const prefetchHeartSoundWorkspace = () => {
    router.prefetch(heartSoundHref);
    void preloadPatientHeartSoundBundle();
  };
  const workspaceNavItems: WorkspaceNavItem[] = [
    {
      key: "overview",
      label: tr(language, "Overview", "ภาพรวม"),
      enabled: true,
    },
    {
      key: "heart-sound",
      label: tr(language, "Heart Sound", "เสียงหัวใจ"),
      enabled: true,
      onSelect: () => router.push(heartSoundHref),
    },
    {
      key: "monitoring",
      label: tr(language, "Monitoring", "การติดตาม"),
      enabled: false,
    },
    {
      key: "timeline",
      label: tr(language, "Timeline", "ไทม์ไลน์"),
      enabled: false,
    },
    {
      key: "devices",
      label: tr(language, "Devices", "อุปกรณ์"),
      enabled: false,
    },
  ];

  const summaryStats = [
    {
      icon: UserRound,
      label: tr(language, "Age", "อายุ"),
      value: tr(language, `${age} years`, `${age} ปี`),
      hint: getGenderLabel(patient.gender, language),
      tone: "primary" as const,
    },
    {
      icon: CalendarClock,
      label: tr(language, "Appointments", "การนัดหมาย"),
      value: `${meetingsTotal}`,
      hint:
        meetingsTotal > 0
          ? tr(language, "Total booked visits", "จำนวนนัดหมายทั้งหมด")
          : tr(language, "No visits recorded yet", "ยังไม่มีนัดหมายที่บันทึกไว้"),
      tone: "primary" as const,
    },
    {
      icon: Clock3,
      label: tr(language, "Next Visit", "นัดหมายถัดไป"),
      value: nextMeeting ? formatDateTime(nextMeeting.date_time) : tr(language, "Not scheduled", "ยังไม่มีนัด"),
      hint: nextMeeting
        ? tr(language, "Upcoming consultation is ready", "มีนัดหมายครั้งถัดไปรออยู่")
        : tr(language, "Schedule a new consultation when ready", "พร้อมเมื่อต้องการสร้างนัดใหม่"),
      tone: "emerald" as const,
    },
    {
      icon: ShieldCheck,
      label: tr(language, "Workspace Readiness", "ความพร้อมของ workspace"),
      value: `${workspaceReadinessScore}%`,
      hint:
        workspaceReadinessScore >= 75
          ? tr(language, "Core workspace signals are available", "สัญญาณหลักของ workspace พร้อมใช้งาน")
          : tr(language, "Some non-sensitive workspace signals are still limited", "ยังมีสัญญาณภาพรวมที่ไม่ละเอียดบางส่วนจำกัดอยู่"),
      tone: workspaceReadinessScore >= 75 ? ("emerald" as const) : ("amber" as const),
    },
  ];

  return (
    <LazyMotion features={domAnimation}>
      <div className="space-y-6 py-2 overflow-y-auto">
        <m.section
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
          className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-sm"
        >
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)] lg:p-6">
            <div className="space-y-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-start gap-4">
                  <Avatar className="size-16 rounded-[24px] border border-border/70">
                    <AvatarFallback
                      className="rounded-[24px] text-xl font-semibold"
                      seed={`${patient.id}|${patient.first_name}|${patient.last_name}|${patient.date_of_birth}|${patient.email ?? ""}`}
                    >
                      {patientInitials || "PT"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="border-transparent bg-primary/10 px-2.5 py-1 text-primary"
                      >
                        {tr(language, "Patient Workspace", "พื้นที่ทำงานผู้ป่วย")}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-border/80 bg-background text-muted-foreground"
                      >
                        {tr(language, "Overview", "ภาพรวม")}
                      </Badge>
                    </div>

                    <div className="space-y-1">
                      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                        {patient.first_name} {patient.last_name}
                      </h1>
                      <p className="text-sm leading-6 text-muted-foreground sm:text-[0.95rem]">
                        {tr(language, `${age} years old`, `${age} ปี`)} •{" "}
                        {getGenderLabel(patient.gender, language)}
                        {patient.created_at
                          ? ` • ${tr(
                              language,
                              `Registered ${formatDate(patient.created_at)}`,
                              `ลงทะเบียนเมื่อ ${formatDate(patient.created_at)}`
                            )}`
                          : ""}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[280px]">
                  <Button
                    onClick={() => router.push(heartSoundHref)}
                    onFocus={prefetchHeartSoundWorkspace}
                    onMouseEnter={prefetchHeartSoundWorkspace}
                    variant="outline"
                    size="lg"
                    className="w-full rounded-2xl"
                  >
                    <Volume2 className="size-4" />
                    {tr(language, "Open Heart Sound", "เปิดเสียงหัวใจ")}
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button
                    onClick={() => router.push(denseModeHref)}
                    onFocus={() => router.prefetch(denseModeHref)}
                    onMouseEnter={() => router.prefetch(denseModeHref)}
                    variant="default"
                    size="lg"
                    className="w-full rounded-2xl"
                  >
                    <Stethoscope className="size-4" />
                    {tr(language, "Open Advanced Focus Mode", "เปิดโหมดโฟกัสขั้นสูง")}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summaryStats.map((stat) => (
                  <StatTile
                    key={stat.label}
                    icon={stat.icon}
                    label={stat.label}
                    value={stat.value}
                    hint={stat.hint}
                    tone={stat.tone}
                  />
                ))}
              </div>

              <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
                <div className="mb-4 flex flex-col gap-4 border-b border-border/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                        {tr(language, "Vital Signs", "สัญญาณชีพ")}
                      </p>
                      {isUsingMockPressureReadings ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[0.7rem] text-sky-700"
                        >
                          {tr(language, "Sample data", "ข้อมูลตัวอย่าง")}
                        </Badge>
                      ) : null}
                      {isUsingDemoPressureReadings ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[0.7rem] text-emerald-700"
                        >
                          {tr(language, "Live demo", "จำลองสด")}
                        </Badge>
                      ) : null}
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">
                      {tr(language, "Blood pressure risk", "ระดับความเสี่ยงความดันโลหิต")}
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {isUsingMockPressureReadings
                        ? tr(
                            language,
                            "Sample readings are shown until this patient receives real device data.",
                            "แสดงข้อมูลตัวอย่างไว้ก่อน จนกว่าผู้ป่วยรายนี้จะมีข้อมูลจริงจากอุปกรณ์"
                          )
                        : isUsingDemoPressureReadings
                          ? tr(
                              language,
                              "Live demo readings are showing in this patient view.",
                              "กำลังแสดงข้อมูลจำลองสดในหน้าผู้ป่วยนี้"
                            )
                        : tr(
                            language,
                            "Latest device reading for this patient only. This panel refreshes automatically.",
                            "แสดงค่าล่าสุดจากอุปกรณ์ของผู้ป่วยรายนี้เท่านั้น และรีเฟรชอัตโนมัติ"
                          )}
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:pt-1">
                    <Button
                      type="button"
                      variant={isPressureDemoRunning ? "outline" : "default"}
                      onClick={handleTogglePressureDemo}
                      className="min-h-10 w-full rounded-xl px-4 sm:w-auto"
                    >
                      {isPressureDemoRunning ? (
                        <Square className="size-4" />
                      ) : (
                        <Play className="size-4" />
                      )}
                      {isPressureDemoRunning
                        ? tr(language, "Stop demo", "หยุดจำลอง")
                        : tr(language, "Start live demo", "เริ่มจำลองสด")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsPressureDemoRunning(false);
                        setDemoPressureReadings([]);
                        pressureDemoSequenceRef.current = 0;
                        void loadPressureReadings({ showLoading: true });
                      }}
                      disabled={loadingPressureReadings}
                      className="min-h-10 w-full rounded-xl px-4 sm:w-auto"
                    >
                      <RefreshCcw className={cn("size-4", loadingPressureReadings && "animate-spin")} />
                      {tr(language, "Refresh", "รีเฟรช")}
                    </Button>
                  </div>
                </div>

                {loadingPressureReadings ? (
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                    <Skeleton className="h-32 rounded-2xl" />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Skeleton className="h-32 rounded-2xl" />
                      <Skeleton className="h-32 rounded-2xl" />
                    </div>
                  </div>
                ) : pressureReadingsError ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                    {pressureReadingsError}
                  </div>
                ) : latestPressureReading && latestPressureRiskTone ? (
                  <div className="space-y-4">
                    <m.div
                      key={latestPressureReading.id}
                      initial={{ opacity: 0, y: 10, scale: 0.99 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.22 }}
                      className={cn(
                        "relative flex flex-col gap-4 overflow-hidden rounded-xl border px-4 py-3.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between sm:px-5",
                        latestPressureRiskTone.bannerClass,
                        isUsingDemoPressureReadings && "ring-1 ring-emerald-300/60"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex size-11 shrink-0 items-center justify-center rounded-xl border",
                            latestPressureRiskTone.iconClass
                          )}
                        >
                          <LatestPressureRiskIcon className="size-5" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            {tr(language, "Current assessment", "ผลประเมินล่าสุด")}
                          </p>
                          <p className="text-2xl font-semibold tracking-tight text-foreground">
                            {getPressureRiskLabel(latestPressureReading.risk.level, language)}
                          </p>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {getPressureRiskHint(latestPressureReading, language)}
                          </p>
                        </div>
                      </div>
                      <div className="flex min-w-fit flex-col gap-1 rounded-xl border border-border/70 bg-muted/20 px-3 py-2 sm:items-end">
                        <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          {tr(language, "Measured", "วัดเมื่อ")}
                        </span>
                        <span className={cn("text-sm font-semibold tabular-nums", latestPressureRiskTone.accentClass)}>
                          {formatDateTime(latestPressureReading.measured_at)}
                        </span>
                      </div>
                    </m.div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-border/80 bg-background p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="rounded-xl border border-red-100 bg-red-50 p-2 text-red-500">
                            <HeartPulse className="size-5" />
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-lg px-2.5 py-1",
                              getPressureRiskTone(latestPressureReading.risk.heart_rate_level).badgeClass
                            )}
                          >
                            {getPressureRiskLabel(latestPressureReading.risk.heart_rate_level, language)}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium text-muted-foreground">
                          {tr(language, "Heart rate", "อัตราการเต้นหัวใจ")}
                        </p>
                        <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                          {latestPressureReading.heart_rate}{" "}
                          <span className="text-base font-medium tracking-normal text-muted-foreground">BPM</span>
                        </p>
                      </div>

                      <div className="rounded-2xl border border-border/80 bg-background p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="rounded-xl border border-amber-100 bg-amber-50 p-2 text-amber-500">
                            <Gauge className="size-5" />
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-lg px-2.5 py-1",
                              getPressureRiskTone(latestPressureReading.risk.blood_pressure_level).badgeClass
                            )}
                          >
                            {getPressureRiskLabel(latestPressureReading.risk.blood_pressure_level, language)}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium text-muted-foreground">
                          {tr(language, "Blood pressure", "ความดันโลหิต")}
                        </p>
                        <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                          {latestPressureReading.sys_rate}/{latestPressureReading.dia_rate}
                          <span className="ml-1 text-base font-medium tracking-normal text-muted-foreground">mmHg</span>
                        </p>
                      </div>
                    </div>

                    {displayPressureReadings.length > 1 ? (
                      <div className="rounded-2xl border border-border/70 bg-muted/15 px-3 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {tr(language, "Recent history", "ประวัติล่าสุด")}
                          </p>
                          {displayPressureTotal > displayPressureReadings.length ? (
                            <span className="text-xs font-medium text-muted-foreground">
                              +{displayPressureTotal - displayPressureReadings.length}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {displayPressureReadings.slice(1, 4).map((reading) => (
                            <Badge
                              key={reading.id}
                              variant="outline"
                              className={cn(
                                "rounded-lg px-3 py-1 text-xs font-medium tabular-nums",
                                getPressureRiskTone(reading.risk.level).badgeClass
                              )}
                            >
                              {reading.sys_rate}/{reading.dia_rate} · {reading.heart_rate} BPM ·{" "}
                              {getPressureRiskLabel(reading.risk.level, language)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 px-6 py-10 text-center">
                    <div className="rounded-xl border border-primary/10 bg-primary/10 p-3 text-primary">
                      <Activity className="size-6" />
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">
                      {tr(language, "No vital sign readings yet", "ยังไม่มีข้อมูลสัญญาณชีพ")}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {tr(
                        language,
                        "Device readings will appear here after ingestion.",
                        "ข้อมูลจากอุปกรณ์จะแสดงที่นี่หลังถูกส่งเข้า backend"
                      )}
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border border-border/80 bg-muted/20 p-4">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {tr(language, "Workspace Navigation", "การนำทางในพื้นที่ทำงาน")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tr(
                        language,
                        "Overview is active, and Heart Sound is available now. More clinical sections will be added here later.",
                        "ตอนนี้เปิดใช้งานหน้า Overview และ Heart Sound แล้ว และจะมีส่วนคลินิกอื่นเพิ่มในภายหลัง"
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {workspaceNavItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={item.onSelect}
                      onFocus={item.key === "heart-sound" ? prefetchHeartSoundWorkspace : undefined}
                      onMouseEnter={item.key === "heart-sound" ? prefetchHeartSoundWorkspace : undefined}
                      disabled={!item.enabled}
                      aria-current={item.key === "overview" ? "page" : undefined}
                      className={cn(
                        "min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                        item.key === "overview"
                          ? "border-primary/20 bg-primary/10 text-primary"
                          : item.enabled
                            ? "border-border/80 bg-background text-foreground hover:bg-muted"
                            : "cursor-not-allowed border-border/60 bg-muted/30 text-muted-foreground"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Card className="rounded-[28px] border-border/70 bg-card shadow-sm">
              <CardContent className="space-y-5 px-5 py-5">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {tr(language, "Quick Summary", "สรุปย่อ")}
                  </p>
                  <h2 className="text-lg font-semibold text-foreground">
                    {tr(language, "Patient at a glance", "ภาพรวมผู้ป่วย")}
                  </h2>
                </div>

                <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {tr(language, "Workspace readiness", "ความพร้อมของ workspace")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {tr(
                            language,
                            "Overview, demographics, and visit signals available in this workspace.",
                            "ข้อมูลภาพรวม ประชากรศาสตร์ และสัญญาณการนัดหมายที่มีใน workspace นี้"
                          )}
                        </p>
                      </div>
                    <span className="text-xl font-semibold text-primary">{workspaceReadinessScore}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={tr(language, "Workspace readiness", "ระดับความพร้อมของ workspace")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={workspaceReadinessScore}
                    className="mt-4 h-2 rounded-full bg-border/80"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300",
                        workspaceReadinessScore >= 75 ? "bg-emerald-500" : "bg-amber-500"
                      )}
                      style={{ width: `${workspaceReadinessScore}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {tr(language, "Sensitive contact details", "ข้อมูลติดต่อที่ละเอียดอ่อน")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {tr(
                            language,
                            "Phone, email, and address stay masked until you reveal them in this workspace.",
                            "เบอร์โทร อีเมล และที่อยู่ จะถูกปกปิดไว้จนกว่าคุณจะกดแสดงใน workspace นี้",
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground/80">
                          {tr(
                            language,
                            "Revealed contact details auto-hide again after 1 minute.",
                            "ข้อมูลติดต่อที่ถูกแสดงจะซ่อนกลับอัตโนมัติภายใน 1 นาที",
                          )}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          void handleToggleContactDetails();
                        }}
                        disabled={loadingContactDetails}
                      >
                        {contactDetailsRevealed ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                        {loadingContactDetails
                          ? tr(language, "Loading protected details...", "กำลังโหลดข้อมูลที่ถูกปกป้อง...")
                          : contactDetailsRevealed
                          ? tr(language, "Hide details", "ซ่อนรายละเอียด")
                          : tr(language, "Reveal details", "แสดงรายละเอียด")}
                      </Button>
                    </div>
                  </div>
                  {contactDetailsError ? (
                    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                      {contactDetailsError}
                    </div>
                  ) : null}
                  <InfoRow
                    icon={Phone}
                    label={tr(language, "Phone", "โทรศัพท์")}
                    value={
                      contactDetailsRevealed
                        ? contactDetails?.phone
                          ? contactDetails.phone
                          : tr(language, "No phone recorded", "ยังไม่มีเบอร์โทร")
                        : tr(language, "Protected until reveal", "ข้อมูลถูกปกปิดจนกว่าจะกดแสดง")
                    }
                    detail={
                      contactDetailsRevealed
                        ? contactDetails?.phone
                          ? tr(language, "Primary contact channel", "ช่องทางติดต่อหลัก")
                          : undefined
                        : undefined
                    }
                    empty={contactDetailsRevealed ? !contactDetails?.phone : false}
                  />
                  <InfoRow
                    icon={Mail}
                    label={tr(language, "Email", "อีเมล")}
                    value={
                      contactDetailsRevealed
                        ? contactDetails?.email
                          ? contactDetails.email
                          : tr(language, "No email recorded", "ยังไม่มีอีเมล")
                        : tr(language, "Protected until reveal", "ข้อมูลถูกปกปิดจนกว่าจะกดแสดง")
                    }
                    detail={
                      contactDetailsRevealed
                        ? contactDetails?.email
                          ? tr(language, "Used for follow-up and documents", "ใช้ติดตามผลและเอกสาร")
                          : undefined
                        : undefined
                    }
                    empty={contactDetailsRevealed ? !contactDetails?.email : false}
                  />
                  <InfoRow
                    icon={MapPin}
                    label={tr(language, "Address", "ที่อยู่")}
                    value={
                      contactDetailsRevealed
                        ? contactDetails?.address
                          ? contactDetails.address
                          : tr(language, "No address recorded", "ไม่มีที่อยู่ที่บันทึกไว้")
                        : tr(language, "Protected until reveal", "ข้อมูลถูกปกปิดจนกว่าจะกดแสดง")
                    }
                    detail={
                      contactDetailsRevealed
                        ? contactDetails?.address
                          ? tr(language, "Latest address on file", "ที่อยู่ล่าสุดในระบบ")
                          : undefined
                        : undefined
                    }
                    empty={contactDetailsRevealed ? !contactDetails?.address : false}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </m.section>

        <m.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.08 }}
        >
          <PatientDeviceSessionHistory token={token} patientId={patientId} language={language} />
        </m.section>

        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.03 }}
            className="h-full"
          >
            <Card className="h-full rounded-[28px] border-border/70 bg-card shadow-sm">
              <CardContent className="space-y-5 px-5 py-5">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {tr(language, "Patient Profile", "โปรไฟล์ผู้ป่วย")}
                  </p>
                  <h2 className="text-lg font-semibold text-foreground">
                    {tr(language, "Identity and demographics", "ข้อมูลระบุตัวตนและประชากรศาสตร์")}
                  </h2>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <InfoRow
                    icon={CalendarClock}
                    label={tr(language, "Date of birth", "วันเกิด")}
                    value={formatDate(patient.date_of_birth)}
                    detail={tr(language, "Used to calculate age-sensitive care", "ใช้ประกอบการดูแลตามช่วงอายุ")}
                  />
                  <InfoRow
                    icon={UserRound}
                    label={tr(language, "Gender", "เพศ")}
                    value={getGenderLabel(patient.gender, language)}
                    detail={tr(language, "Stored identity descriptor", "ข้อมูลระบุตัวตนที่บันทึกไว้")}
                    empty={!patient.gender}
                  />
                  <InfoRow
                    icon={ShieldCheck}
                    label={tr(language, "Patient ID", "รหัสผู้ป่วย")}
                    value={patient.id}
                    detail={tr(language, "Use this when coordinating with ops or support", "ใช้เมื่อต้องประสานงานกับทีมปฏิบัติการหรือซัพพอร์ต")}
                  />
                  <InfoRow
                    icon={Clock3}
                    label={tr(language, "Latest update", "อัปเดตล่าสุด")}
                    value={
                      patient.updated_at
                        ? formatDate(patient.updated_at)
                        : tr(language, "Not available", "ไม่มีข้อมูล")
                    }
                    detail={tr(language, "Shows when this record last changed", "แสดงเวลาที่ระเบียนนี้ถูกแก้ไขล่าสุด")}
                    empty={!patient.updated_at}
                  />
                </div>
              </CardContent>
            </Card>
          </m.div>

          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.06 }}
            className="h-full"
          >
            <Card className="h-full rounded-[28px] border-border/70 bg-card shadow-sm">
              <CardContent className="space-y-5 px-5 py-5">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {tr(language, "Care Summary", "สรุปการดูแล")}
                  </p>
                  <h2 className="text-lg font-semibold text-foreground">
                    {tr(language, "Before opening dense mode", "ก่อนเปิด dense mode")}
                  </h2>
                </div>

                <div className="space-y-3">
                  <div className="rounded-2xl border border-border/80 bg-background p-4">
                    <p className="text-sm font-medium text-foreground">
                      {tr(language, "Next appointment", "นัดหมายถัดไป")}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {nextMeeting
                        ? tr(
                            language,
                            `${formatDateTime(nextMeeting.date_time)}`,
                            `${formatDateTime(nextMeeting.date_time)}`
                          )
                        : tr(
                            language,
                            "No appointment scheduled",
                            "ยังไม่มีนัดหมาย"
                          )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </m.div>
        </div>

        <m.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.1 }}
        >
          <Card className="rounded-[28px] border-border/70 bg-card shadow-sm">
            <CardContent className="px-5 py-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {tr(language, "Visit Timeline", "ไทม์ไลน์การนัดหมาย")}
                  </p>
                  <h2 className="text-lg font-semibold text-foreground">
                    {tr(language, "Appointment History", "ประวัติการนัดหมาย")}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tr(
                      language,
                      "Chronological visits and notes.",
                      "ลำดับการนัดหมายและหมายเหตุ"
                    )}
                  </p>
                </div>
                {meetingsTotal > 0 ? (
                  <Badge
                    variant="secondary"
                    className="w-fit border-transparent bg-primary/10 px-3 py-1 text-sm text-primary"
                  >
                    {meetingsTotal}
                  </Badge>
                ) : null}
              </div>

              {loadingMeetings ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-24 rounded-2xl" />
                  ))}
                </div>
              ) : meetings.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-border/80 bg-muted/15 px-6 py-12 text-center">
                  <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                    <CalendarClock className="size-6" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-foreground">
                    {tr(language, "No appointments yet", "ยังไม่มีการนัดหมาย")}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {tr(language, "Appointments will appear here", "การนัดหมายจะแสดงที่นี่")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence>
                    {meetings.map((meeting, index) => {
                      const meetingDate = new Date(meeting.date_time);
                      const isPast = meetingDate.getTime() < now.getTime();
                      const doctorName = meeting.doctor
                        ? [meeting.doctor.first_name, meeting.doctor.last_name]
                            .filter(Boolean)
                            .join(" ") || meeting.doctor.email
                        : null;

                      return (
                        <m.div
                          key={meeting.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.16, delay: index * 0.025 }}
                          className={cn(
                            "relative overflow-hidden rounded-[24px] border px-4 py-4",
                            isPast
                              ? "border-border/80 bg-background"
                              : "border-primary/20 bg-primary/[0.04]"
                          )}
                        >
                          <div className="flex gap-4">
                            <div className="flex w-9 flex-col items-center">
                              <div
                                className={cn(
                                  "mt-1 size-3 rounded-full ring-4",
                                  isPast
                                    ? "bg-muted-foreground/40 ring-muted/60"
                                    : "bg-primary ring-primary/15"
                                )}
                              />
                              {index < meetings.length - 1 ? (
                                <div className="mt-2 h-full min-h-12 w-px bg-border/70" />
                              ) : null}
                            </div>

                            <div className="min-w-0 flex-1 space-y-3">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-foreground sm:text-base">
                                      {formatDateTime(meeting.date_time)}
                                    </p>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "border-transparent",
                                        isPast
                                          ? "bg-muted text-muted-foreground"
                                          : "bg-emerald-500/10 text-emerald-700"
                                      )}
                                    >
                                      {isPast
                                        ? tr(language, "Completed", "เสร็จสิ้น")
                                        : tr(language, "Upcoming", "กำลังจะมาถึง")}
                                    </Badge>
                                  </div>

                                  <p className="text-sm leading-6 text-muted-foreground">
                                    {meeting.description ||
                                      tr(
                                        language,
                                        "No appointment description was added.",
                                        "ยังไม่มีคำอธิบายสำหรับการนัดหมายนี้"
                                      )}
                                  </p>
                                </div>

                                {meeting.room ? (
                                  <div className="rounded-2xl bg-muted/40 px-3 py-2 text-sm text-muted-foreground ring-1 ring-border/70">
                                    {tr(language, "Room", "ห้อง")} {meeting.room}
                                  </div>
                                ) : null}
                              </div>

                              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                                {doctorName ? (
                                  <span className="inline-flex items-center gap-2 rounded-full bg-muted/40 px-3 py-1.5">
                                    <UserRound className="size-3.5" />
                                    {tr(language, "Doctor", "แพทย์")} {doctorName}
                                  </span>
                                ) : null}
                              </div>

                              {meeting.note ? (
                                <div className="rounded-2xl border border-border/80 bg-muted/20 px-4 py-3">
                                  <p className="text-sm italic leading-6 text-muted-foreground">
                                    {meeting.note}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </m.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </CardContent>
          </Card>
        </m.section>
      </div>
    </LazyMotion>
  );
}
