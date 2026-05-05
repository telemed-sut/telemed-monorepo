"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  Search,
  Square,
  Stethoscope,
  UserRoundPlus,
  Waves,
  XCircle,
} from "lucide-react";
import {
  API_BASE_URL,
  completeDeviceExamSession,
  createDeviceExamSession,
  fetchDeviceExamSessions,
  fetchDeviceLungSoundReviewQueue,
  fetchDeviceInventory,
  fetchDeviceLiveSessions,
  fetchPatients,
  isProbablyJwt,
  resolveDeviceLungSoundReviewItem,
  type DeviceExamSession,
  type DeviceLungSoundReviewItem,
  type DeviceLungSoundReviewQueueResponse,
  type DeviceInventoryItem,
  type DeviceInventoryResponse,
  type DeviceExamMeasurementType,
  type DeviceLiveSessionItem,
  type DeviceLiveSessionResponse,
  type Patient,
} from "@/lib/api";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const LIVE_STALE_OPTIONS = [90, 120, 300, 600] as const;
const DEFAULT_MEASUREMENT_TYPE: DeviceExamMeasurementType = "lung_sound";

type DeviceSessionEvent = {
  type?: string;
};

type StreamState = "connecting" | "connected" | "reconnecting" | "offline";
type ReviewRoutingFilter = "all" | "needs_review" | "unmatched";

type DeviceMonitorLiveOpsProps = {
  token: string | null;
  language: AppLanguage;
  autoRefreshEnabled: boolean;
  refreshIntervalMs: number;
  canManageSessions?: boolean;
  enableStream?: boolean;
};

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

function parseSseEvent(rawEvent: string): { event: string; data: DeviceSessionEvent | null } {
  const lines = rawEvent.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  const dataText = dataLines.join("\n");
  if (!dataText) {
    return { event, data: null };
  }

  try {
    return { event, data: JSON.parse(dataText) as DeviceSessionEvent };
  } catch {
    return { event, data: null };
  }
}

function formatDateTime(value: string | null, language: AppLanguage) {
  if (!value) return tr(language, "No data yet", "ยังไม่มีข้อมูล");
  return new Date(value).toLocaleString(localeOf(language), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeSeconds(value: number | null, language: AppLanguage) {
  if (value == null) return tr(language, "No signal", "ยังไม่มีสัญญาณ");
  if (value < 60) return tr(language, `${value}s ago`, `${value} วินาทีที่แล้ว`);
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return tr(language, `${minutes}m ago`, `${minutes} นาทีที่แล้ว`);
  const hours = Math.floor(minutes / 60);
  return tr(language, `${hours}h ago`, `${hours} ชั่วโมงที่แล้ว`);
}

function measurementLabel(value: DeviceLiveSessionItem["measurement_type"], language: AppLanguage) {
  switch (value) {
    case "lung_sound":
      return tr(language, "Lung sound", "เสียงปอด");
    case "heart_sound":
      return tr(language, "Heart sound", "เสียงหัวใจ");
    case "blood_pressure":
      return tr(language, "Blood pressure", "ความดัน");
    default:
      return tr(language, "Multi-mode", "หลายโหมด");
  }
}

function measurementIcon(value: DeviceLiveSessionItem["measurement_type"]) {
  switch (value) {
    case "lung_sound":
      return Stethoscope;
    case "heart_sound":
      return Activity;
    case "blood_pressure":
      return Waves;
    default:
      return Monitor;
  }
}

function formatPatientName(patient: Pick<Patient, "first_name" | "last_name" | "id">) {
  const name = `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim();
  return name || patient.id;
}

function prettifyIdentifier(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function deviceOptionLabel(device: Pick<DeviceInventoryItem, "device_id" | "device_display_name" | "default_measurement_type">, language: AppLanguage) {
  const displayName = device.device_display_name?.trim();
  const readableName =
    displayName && displayName !== device.device_id ? displayName : prettifyIdentifier(device.device_id);
  return `${readableName} · ${measurementLabel(device.default_measurement_type, language)}`;
}

function freshnessBadgeClass(freshness: string) {
  if (freshness === "fresh") {
    return "border-emerald-300 bg-emerald-500/10 text-emerald-700";
  }
  if (freshness === "stale") {
    return "border-amber-300 bg-amber-500/10 text-amber-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function availabilityBadgeClass(status: DeviceInventoryItem["availability_status"]) {
  if (status === "in_use") {
    return "border-sky-300 bg-sky-500/10 text-sky-700";
  }
  if (status === "busy") {
    return "border-violet-300 bg-violet-500/10 text-violet-700";
  }
  if (status === "inactive") {
    return "border-slate-300 bg-slate-200 text-slate-700";
  }
  return "border-emerald-300 bg-emerald-500/10 text-emerald-700";
}

function routingBadgeClass(status: DeviceLungSoundReviewItem["routing_status"]) {
  if (status === "needs_review") {
    return "border-amber-300 bg-amber-500/10 text-amber-700";
  }
  if (status === "unmatched") {
    return "border-rose-300 bg-rose-500/10 text-rose-700";
  }
  if (status === "quarantined") {
    return "border-slate-300 bg-slate-200 text-slate-700";
  }
  return "border-emerald-300 bg-emerald-500/10 text-emerald-700";
}

function routingStatusLabel(status: DeviceLungSoundReviewItem["routing_status"], language: AppLanguage) {
  if (status === "needs_review") {
    return tr(language, "Needs review", "ต้องตรวจสอบ");
  }
  if (status === "unmatched") {
    return tr(language, "Unmatched", "ไม่พบ session ที่ตรง");
  }
  if (status === "quarantined") {
    return tr(language, "Quarantined", "กักกัน");
  }
  return tr(language, "Verified", "ยืนยันแล้ว");
}

function pickTargetSessionIdForReview(
  item: DeviceLungSoundReviewItem,
  liveSessions: DeviceLiveSessionItem[],
): string | null {
  const deviceSessions = liveSessions.filter((session) => session.device_id === item.device_id);
  const statuses: DeviceLiveSessionItem["status"][] = ["active", "stale"];
  for (const status of statuses) {
    const match = deviceSessions.find((session) => session.status === status);
    if (match) {
      return match.session_id;
    }
  }
  return item.device_exam_session_id;
}

function reviewReasonLabel(item: DeviceLungSoundReviewItem, language: AppLanguage) {
  const reason =
    item.conflict_metadata && typeof item.conflict_metadata === "object"
      ? item.conflict_metadata["reason"]
      : undefined;
  if (reason === "transition_window_overlap") {
    return tr(language, "Transition overlap", "ช่วงเปลี่ยนเคสทับซ้อน");
  }
  if (reason === "session_requires_review") {
    return tr(language, "Session flagged", "session ถูกติดธง");
  }
  if (reason === "no_open_session_for_device") {
    return tr(language, "No open session", "ไม่พบ session ที่เปิดอยู่");
  }
  if (reason === "late_packet_after_session_closed") {
    return tr(language, "Late packet", "ข้อมูลเข้าหลังปิด session");
  }
  return tr(language, "Context mismatch", "บริบทไม่ตรงกัน");
}

function streamBadgeMeta(streamState: StreamState, language: AppLanguage) {
  if (streamState === "connected") {
    return {
      label: tr(language, "Live stream connected", "เชื่อมต่อสตรีมสดแล้ว"),
      className: "border-emerald-300 bg-emerald-500/10 text-emerald-700",
    };
  }
  if (streamState === "reconnecting") {
    return {
      label: tr(language, "Reconnecting", "กำลังเชื่อมต่อใหม่"),
      className: "border-amber-300 bg-amber-500/10 text-amber-700",
    };
  }
  if (streamState === "offline") {
    return {
      label: tr(language, "Snapshot only", "แสดงผลแบบ snapshot"),
      className: "border-slate-300 bg-slate-100 text-slate-700",
    };
  }
  return {
    label: tr(language, "Connecting stream", "กำลังเชื่อมต่อสตรีม"),
    className: "border-sky-300 bg-sky-500/10 text-sky-700",
  };
}

export function DeviceMonitorLiveOps({
  token,
  language,
  autoRefreshEnabled,
  refreshIntervalMs,
  canManageSessions = false,
  enableStream = true,
}: DeviceMonitorLiveOpsProps) {
  const [liveData, setLiveData] = useState<DeviceLiveSessionResponse | null>(null);
  const [inventoryData, setInventoryData] = useState<DeviceInventoryResponse | null>(null);
  const [reviewData, setReviewData] = useState<DeviceLungSoundReviewQueueResponse | null>(null);
  const [recentCompletedData, setRecentCompletedData] = useState<DeviceExamSession[]>([]);
  const [reviewRoutingFilter, setReviewRoutingFilter] = useState<ReviewRoutingFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [includePending, setIncludePending] = useState(true);
  const [staleAfterSeconds, setStaleAfterSeconds] = useState<number>(120);
  const [query, setQuery] = useState("");
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [measurementType, setMeasurementType] = useState<DeviceExamMeasurementType>(DEFAULT_MEASUREMENT_TYPE);
  const [sessionNotes, setSessionNotes] = useState("");
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const [activeSessionToClose, setActiveSessionToClose] = useState<DeviceInventoryItem | null>(null);
  const isFetchingRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);

  const loadSnapshot = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!token || isFetchingRef.current) return;
      const silent = options?.silent ?? false;
      isFetchingRef.current = true;
      if (!silent) {
        setLoading(true);
      }
      setRefreshing(true);
      try {
        const reviewPromise: Promise<DeviceLungSoundReviewQueueResponse | null> = canManageSessions
          ? fetchDeviceLungSoundReviewQueue(token, {
              limit: 100,
              routingStatus: reviewRoutingFilter === "all" ? undefined : reviewRoutingFilter,
            })
          : Promise.resolve(null);
        const completedSessionsPromise = fetchDeviceExamSessions(token, {
          status: "completed",
          limit: 5,
        }).catch(() => ({ items: [], total: 0 }));
        const [liveSessions, inventory, reviewQueue, completedSessions] = await Promise.all([
          fetchDeviceLiveSessions(token, {
            includePending,
            staleAfterSeconds,
          }),
          fetchDeviceInventory(token, {
            staleAfterSeconds,
          }),
          reviewPromise,
          completedSessionsPromise,
        ]);
        setLiveData(liveSessions);
        setInventoryData(inventory);
        setReviewData(reviewQueue);
        setRecentCompletedData(completedSessions.items ?? []);
        setErrorText(null);
      } catch (error) {
        if (!silent) {
          setErrorText(
            error instanceof Error
              ? error.message
              : tr(language, "Unable to load live operations data.", "ไม่สามารถโหลดข้อมูลการใช้งานสดได้"),
          );
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
        setRefreshing(false);
        isFetchingRef.current = false;
      }
    },
    [canManageSessions, includePending, language, reviewRoutingFilter, staleAfterSeconds, token],
  );

  useEffect(() => {
    if (!token) return;
    void loadSnapshot();
  }, [loadSnapshot, token]);

  useEffect(() => {
    if (!token || !autoRefreshEnabled) return;
    const intervalId = window.setInterval(() => {
      void loadSnapshot({ silent: true });
    }, Math.max(refreshIntervalMs, 4000));
    return () => window.clearInterval(intervalId);
  }, [autoRefreshEnabled, loadSnapshot, refreshIntervalMs, token]);

  useEffect(() => {
    if (!token) return;
    const searchText = patientQuery.trim();
    const timeoutId = window.setTimeout(async () => {
      setPatientSearchLoading(true);
      try {
        const response = await fetchPatients(
          {
            page: 1,
            limit: 8,
            q: searchText || undefined,
            sort: "first_name",
            order: "asc",
          },
          token,
        );
        setPatientResults(response.items ?? []);
      } catch {
        setPatientResults([]);
      } finally {
        setPatientSearchLoading(false);
      }
    }, searchText ? 250 : 0);

    return () => window.clearTimeout(timeoutId);
  }, [patientQuery, token]);

  useEffect(() => {
    if (!token || !enableStream) {
      setStreamState("offline");
      return;
    }

    let active = true;
    let retryDelay = 1000;
    let retryTimeoutId: number | null = null;
    let controller: AbortController | null = null;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        void loadSnapshot({ silent: true });
      }, 350);
    };

    const scheduleReconnect = () => {
      if (!active) return;
      setStreamState("reconnecting");
      if (retryTimeoutId) {
        window.clearTimeout(retryTimeoutId);
      }
      retryTimeoutId = window.setTimeout(() => {
        retryDelay = Math.min(retryDelay * 2, 30000);
        void connect();
      }, retryDelay);
    };

    const connect = async () => {
      if (!active) return;
      controller?.abort();
      controller = new AbortController();
      setStreamState("connecting");

      const headers: HeadersInit = {};
      if (token && isProbablyJwt(token)) {
        headers.Authorization = `Bearer ${token}`;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/device-sessions/events/stream`, {
          method: "GET",
          headers,
          credentials: "include",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE connection failed (${response.status})`);
        }
        if (!response.body) {
          throw new Error("SSE connection closed");
        }

        setStreamState("connected");
        retryDelay = 1000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            if (!rawEvent) continue;
            const parsed = parseSseEvent(rawEvent);
            if (parsed.event === "ready" || parsed.event === "heartbeat") {
              continue;
            }
            scheduleRefresh();
          }
        }
      } catch {
        if (!active) return;
        setStreamState("offline");
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      active = false;
      if (retryTimeoutId) {
        window.clearTimeout(retryTimeoutId);
      }
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      controller?.abort();
    };
  }, [enableStream, loadSnapshot, token]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    const items = liveData?.items ?? [];
    if (!normalizedQuery) return items;
    return items.filter((item) =>
      [
        item.device_id,
        item.device_display_name,
        item.patient_name,
        item.measurement_type,
        item.pairing_code,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [liveData?.items, normalizedQuery]);

  const filteredInventory = useMemo(() => {
    const items = inventoryData?.items ?? [];
    if (!normalizedQuery) return items;
    return items.filter((item) =>
      [
        item.device_id,
        item.device_display_name,
        item.patient_name,
        item.measurement_type,
        item.availability_status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [inventoryData?.items, normalizedQuery]);

  const availableDevices = useMemo(
    () =>
      (inventoryData?.items ?? []).filter(
        (item) => item.is_active && (item.availability_status === "idle" || item.availability_status === "in_use"),
      ),
    [inventoryData?.items],
  );
  const selectedDevice = useMemo(
    () => availableDevices.find((device) => device.device_id === selectedDeviceId) ?? null,
    [availableDevices, selectedDeviceId],
  );
  const canStartSession = Boolean(
    token && selectedPatient && selectedDeviceId && availableDevices.length > 0 && !startSubmitting,
  );

  useEffect(() => {
    if (!selectedDeviceId || availableDevices.some((device) => device.device_id === selectedDeviceId)) {
      return;
    }
    setSelectedDeviceId("");
  }, [availableDevices, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDeviceId) {
      // Auto-select if there is exactly one device available
      if (availableDevices.length === 1) {
        setSelectedDeviceId(availableDevices[0].device_id);
      }
      return;
    }
    if (selectedDevice?.default_measurement_type) {
      setMeasurementType(selectedDevice.default_measurement_type);
    }
  }, [availableDevices, selectedDevice, selectedDeviceId]);

  const executeStartSession = useCallback(async (isConfirmed = false) => {
    if (!token || startSubmitting || !selectedPatient || !selectedDeviceId) return;

    const currentDevice = selectedDevice;
    
    // Check if we need confirmation
    if (!isConfirmed && currentDevice?.session_id) {
      setActiveSessionToClose(currentDevice);
      setShowSwitchConfirm(true);
      return;
    }

    setStartSubmitting(true);
    setShowSwitchConfirm(false);
    try {
      // Auto-switch logic: if device has any session, complete it first
      if (currentDevice?.session_id) {
        try {
          await completeDeviceExamSession(token, currentDevice.session_id, {
            notes: tr(language, "Automatically completed for patient transition.", "จบการตรวจอัตโนมัติเนื่องจากสลับคนไข้"),
          });
        } catch (error) {
          toast.apiError(
            tr(language, "Could not close previous session", "ไม่สามารถปิดรอบตรวจเดิมได้"),
            error,
            tr(
              language,
              "Please try finishing it manually or check the connection.",
              "โปรดลองกดจบงานด้วยตนเอง หรือตรวจสอบการเชื่อมต่อ",
            ),
          );
          setStartSubmitting(false);
          return; // Stop here if we can't clear the device
        }
      }

      const session = await createDeviceExamSession(token, {
        patient_id: selectedPatient.id,
        device_id: selectedDeviceId,
        measurement_type: measurementType,
        notes: sessionNotes.trim() || null,
        activate_now: true,
      });
      toast.success(
        tr(language, "Session started", "เริ่มรอบตรวจแล้ว"),
        {
          description: tr(
            language,
            `Device ${session.device_id} is now linked to ${formatPatientName(selectedPatient)}.`,
            `เครื่อง ${session.device_id} ถูกผูกกับ ${formatPatientName(selectedPatient)} แล้ว`,
          ),
        },
      );
      setPatientQuery("");
      setPatientResults([]);
      setSelectedPatient(null);
      setSelectedDeviceId("");
      setMeasurementType(DEFAULT_MEASUREMENT_TYPE);
      setSessionNotes("");
      await loadSnapshot();
    } catch (error) {
      toast.apiError(
        tr(language, "Start session failed", "เริ่มรอบตรวจไม่สำเร็จ"),
        error,
        tr(language, "Unable to start this device session.", "ไม่สามารถเริ่ม session อุปกรณ์นี้ได้"),
      );
    } finally {
      setStartSubmitting(false);
      setActiveSessionToClose(null);
    }
  }, [
    language,
    loadSnapshot,
    measurementType,
    selectedDeviceId,
    selectedPatient,
    sessionNotes,
    startSubmitting,
    token,
    selectedDevice,
  ]);

  const handleStartSession = useCallback(async () => {
    void executeStartSession(false);
  }, [executeStartSession]);

  const filteredReviewItems = useMemo(() => {
    const items = reviewData?.items ?? [];
    if (!normalizedQuery) {
      return items;
    }
    return items.filter((item) =>
      [
        item.device_id,
        item.patient_name,
        item.patient_id,
        item.device_exam_session_id,
        item.routing_status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [normalizedQuery, reviewData?.items]);

  const handleReviewAction = useCallback(
    async (item: DeviceLungSoundReviewItem, resolution: "verified" | "quarantined") => {
      if (!token || reviewActionId) {
        return;
      }

      let targetSessionId: string | null = null;
      if (resolution === "verified") {
        targetSessionId = pickTargetSessionIdForReview(item, liveData?.items ?? []);
        if (!targetSessionId) {
          toast.warning(
            tr(language, "No target session available", "ไม่พบ session เป้าหมาย"),
            {
              description: tr(
                language,
                "Create or activate a session for this device first, then resolve as verified.",
                "กรุณาสร้างหรือเปิดใช้งาน session ของเครื่องนี้ก่อน แล้วค่อยยืนยันรายการ",
              ),
            },
          );
          return;
        }
      }

      setReviewActionId(`${resolution}:${item.record_id}`);
      try {
        await resolveDeviceLungSoundReviewItem(token, item.record_id, {
          resolution,
          target_session_id: targetSessionId ?? undefined,
          note:
            resolution === "verified"
              ? tr(language, "Resolved from live review queue.", "ยืนยันรายการจากคิวตรวจสอบสด")
              : tr(language, "Quarantined from live review queue.", "กักกันรายการจากคิวตรวจสอบสด"),
        });
        toast.success(
          resolution === "verified"
            ? tr(language, "Review item verified", "ยืนยันรายการแล้ว")
            : tr(language, "Review item quarantined", "กักกันรายการแล้ว"),
        );
        await loadSnapshot();
      } catch (error) {
        toast.apiError(
          tr(language, "Unable to resolve review item", "ไม่สามารถแก้ไขรายการตรวจสอบได้"),
          error,
          tr(language, "Please try again or check session context.", "โปรดลองอีกครั้งหรือตรวจสอบบริบทของ session"),
        );
      } finally {
        setReviewActionId(null);
      }
    },
    [language, liveData?.items, loadSnapshot, reviewActionId, token],
  );

  const streamMeta = streamBadgeMeta(streamState, language);

  if (loading && !liveData && !inventoryData) {
    return (
      <section className="grid gap-4 xl:grid-cols-[1.18fr_1fr]">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <>
    <section className="space-y-4">
      <h2 className="sr-only">
        {tr(language, "Live Device Operations", "สถานะการใช้งานอุปกรณ์แบบสด")}
      </h2>
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 text-sm"
              placeholder={tr(language, "Search device, patient, mode, or pairing code", "ค้นหาเครื่อง ผู้ป่วย โหมด หรือรหัสจับคู่")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Badge
              className={cn("rounded-full border px-2.5 py-1 text-[0.7rem] font-medium", streamMeta.className)}
              variant="outline"
            >
              {streamMeta.label}
            </Badge>
            <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
              <Switch id="live-include-pending" checked={includePending} onCheckedChange={setIncludePending} />
              <Label htmlFor="live-include-pending" className="text-sm font-medium text-slate-700">
                {tr(language, "Include inactive", "รวมรายการนิ่ง")}
              </Label>
            </div>
            <Select
              value={String(staleAfterSeconds)}
              onValueChange={(value) => setStaleAfterSeconds(Number(value))}
            >
              <SelectTrigger className="h-10 w-[170px] rounded-xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_STALE_OPTIONS.map((seconds) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {tr(language, "Stale after", "ขาดช่วงเมื่อ")} {seconds}s
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-10 rounded-xl" onClick={() => void loadSnapshot()} disabled={refreshing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
              {tr(language, "Refresh", "รีเฟรช")}
            </Button>
          </div>
        </div>
      </div>

      {errorText && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      {canManageSessions ? (
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <span className="flex size-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                  <UserRoundPlus className="size-5" />
                </span>
                {tr(language, "Start device session", "เริ่มรอบตรวจด้วยเครื่อง")}
              </CardTitle>
              <CardDescription className="mt-2 max-w-2xl">
                {tr(
                  language,
                  "Pick a device, choose the patient, and start the examination session immediately.",
                  "เลือกผู้ป่วย เลือกเครื่อง แล้วเริ่มรอบตรวจได้ทันที",
                )}
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
              {availableDevices.length} {tr(language, "available", "เครื่องที่พร้อมใช้")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.78fr)]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                  {tr(language, "Step 1", "ขั้นตอนที่ 1")}
                </p>
                <Label htmlFor="device-session-patient-search" className="text-base font-semibold text-slate-950">
                  {tr(language, "Choose patient", "เลือกผู้ป่วย")}
                </Label>
              </div>
              {selectedPatient ? (
                <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700">
                  {tr(language, "Selected", "เลือกแล้ว")}
                </Badge>
              ) : null}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="device-session-patient-search"
                value={patientQuery}
                onChange={(event) => {
                  setPatientQuery(event.target.value);
                  setSelectedPatient(null);
                }}
                className="h-11 rounded-xl bg-white pl-9"
                placeholder={tr(language, "Search name or patient ID", "ค้นหาชื่อหรือรหัสผู้ป่วย")}
              />
            </div>
            {selectedPatient ? (
              <div className="mt-3 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm">
                <div className="font-semibold text-slate-950">{formatPatientName(selectedPatient)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {selectedPatient.ward || tr(language, "No ward", "ยังไม่ระบุวอร์ด")} · {selectedPatient.id}
                </div>
              </div>
            ) : null}
            <div className="mt-3 grid max-h-[240px] gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
              {patientSearchLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {tr(language, "Searching patients...", "กำลังค้นหาผู้ป่วย...")}
                </div>
              ) : patientResults.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {tr(language, "No patients found.", "ไม่พบผู้ป่วย")}
                </div>
              ) : (
                patientResults.map((patient) => {
                  const active = selectedPatient?.id === patient.id;
                  return (
                    <button
                      key={patient.id}
                      type="button"
                      onClick={() => {
                        setSelectedPatient(patient);
                        setPatientQuery(formatPatientName(patient));
                      }}
                      className={cn(
                        "flex min-h-14 items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        active
                          ? "border-sky-300 bg-sky-50 text-sky-900"
                          : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <span>
                        <span className="block font-medium">{formatPatientName(patient)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {patient.ward || tr(language, "No ward", "ยังไม่ระบุวอร์ด")} · {patient.id}
                        </span>
                      </span>
                      {active && <CheckCircle2 className="size-4 text-sky-600" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
            <div className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                {tr(language, "Step 2", "ขั้นตอนที่ 2")}
              </p>
              <h3 className="text-base font-semibold text-slate-950">
                {tr(language, "Select device and start", "เลือกเครื่องและเริ่มตรวจ")}
              </h3>
            </div>
            <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>{tr(language, "Select device", "เลือกเครื่อง")}</Label>
              <Select value={selectedDeviceId} onValueChange={(value) => setSelectedDeviceId(value ?? "")}>
                <SelectTrigger className="h-11 rounded-xl bg-white">
                  {selectedDevice ? (
                    <SelectValue>{deviceOptionLabel(selectedDevice, language)}</SelectValue>
                  ) : (
                    <SelectValue placeholder={tr(language, "Choose a device", "เลือกเครื่อง")} />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {availableDevices.map((device) => (
                    <SelectItem key={device.device_id} value={device.device_id}>
                      {deviceOptionLabel(device, language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedDeviceId && (
                (() => {
                  const dev = inventoryData?.items.find((device) => device.device_id === selectedDeviceId);
                  if (dev?.session_id) {
                    return (
                      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-sm animate-in fade-in slide-in-from-top-1 duration-300">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="relative flex h-2 w-2 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-amber-700/80">
                              {tr(language, "Device is Busy", "เครื่องกำลังถูกใช้งาน")}
                            </p>
                            <p className="truncate text-sm font-semibold text-amber-950">
                              {dev.patient_name || tr(language, "Active Session", "มีรอบตรวจค้างอยู่")}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 rounded-lg border-amber-200 bg-white px-3 text-xs font-medium text-amber-800 shadow-xs hover:bg-amber-100 hover:text-amber-900"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!dev.session_id || !token) return;
                            try {
                              await completeDeviceExamSession(token, dev.session_id, {
                                notes: tr(language, "Manually finished from start session form.", "จบการตรวจจากฟอร์มเริ่มรอบตรวจ"),
                              });
                              toast.success(tr(language, "Session finished", "จบการตรวจเรียบร้อย"));
                              void loadSnapshot();
                            } catch (error) {
                              toast.apiError(
                                tr(language, "Failed to finish session", "จบการตรวจไม่สำเร็จ"),
                                error,
                                tr(language, "Please try again or check the connection.", "โปรดลองอีกครั้งหรือตรวจสอบการเชื่อมต่อ"),
                              );
                            }
                          }}
                        >
                          <Square className="mr-1.5 size-3 fill-current" />
                          {tr(language, "Finish", "จบงานนี้")}
                        </Button>
                      </div>
                    );
                  }
                  return null;
                })()
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="device-session-notes">{tr(language, "Notes", "หมายเหตุ")}</Label>
              <Textarea
                id="device-session-notes"
                value={sessionNotes}
                onChange={(event) => setSessionNotes(event.target.value)}
                rows={3}
                className="rounded-xl bg-white"
                placeholder={tr(language, "Optional context for this examination", "บริบทเพิ่มเติมสำหรับรอบตรวจนี้ ถ้ามี")}
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleStartSession()}
              disabled={!canStartSession}
              className="h-11 w-full rounded-xl"
            >
              {startSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              {tr(language, "Start session", "เริ่มรอบตรวจ")}
            </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      ) : (
        <Card className="border-dashed border-slate-300 bg-slate-50/70">
          <CardHeader>
            <CardTitle>{tr(language, "Live view only", "ดูสถานะสดเท่านั้น")}</CardTitle>
            <CardDescription>
              {tr(
                language,
                "Your role can monitor device usage, while starting or ending sessions is limited to admins.",
                "บทบาทของคุณดูสถานะการใช้งานเครื่องได้ แต่การเริ่มหรือจบงานจำกัดเฉพาะแอดมิน",
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card size="sm" className="border-sky-200/80 bg-sky-50/70">
          <CardHeader>
            <CardDescription>{tr(language, "Active sessions", "การตรวจที่กำลังดำเนินอยู่")}</CardDescription>
            <CardTitle className="text-2xl font-semibold">{liveData?.active_count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className="border-amber-200/80 bg-amber-50/70">
          <CardHeader>
            <CardDescription>{tr(language, "Stale sessions", "การตรวจที่ขาดช่วง")}</CardDescription>
            <CardTitle className="text-2xl font-semibold">{liveData?.stale_count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className="border-emerald-200/80 bg-emerald-50/70">
          <CardHeader>
            <CardDescription>{tr(language, "Available devices", "เครื่องที่พร้อมใช้งาน")}</CardDescription>
            <CardTitle className="text-2xl font-semibold">{inventoryData ? inventoryData.idle_count + inventoryData.in_use_count : 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className="border-violet-200/80 bg-violet-50/70">
          <CardHeader>
            <CardDescription>{tr(language, "Busy devices", "เครื่องที่ถูกใช้โดยเคสอื่น")}</CardDescription>
            <CardTitle className="text-2xl font-semibold">{inventoryData?.busy_count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Review Queue with Animation */}
      {canManageSessions && reviewData?.items && reviewData.items.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/20 animate-in fade-in slide-in-from-top-2 duration-500">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>{tr(language, "Review queue", "คิวรายการต้องตรวจสอบ")}</CardTitle>
                <CardDescription>
                  {tr(
                    language,
                    "Lung sound packets flagged as needs_review or unmatched. Resolve to verified session or quarantine.",
                    "รายการ lung sound ที่ถูกติดธง needs_review หรือ unmatched สามารถยืนยันเข้า session หรือกักกันได้",
                  )}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-500/10 text-amber-700">
                  {tr(language, "Needs review", "ต้องตรวจสอบ")}: {reviewData?.needs_review_count ?? 0}
                </Badge>
                <Badge variant="outline" className="rounded-full border-rose-300 bg-rose-500/10 text-rose-700">
                  {tr(language, "Unmatched", "ไม่พบ session")}: {reviewData?.unmatched_count ?? 0}
                </Badge>
                <Select
                  value={reviewRoutingFilter}
                  onValueChange={(value) => setReviewRoutingFilter(value as ReviewRoutingFilter)}
                >
                  <SelectTrigger className="h-9 w-[190px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr(language, "All flagged", "ทุกรายการที่ติดธง")}</SelectItem>
                    <SelectItem value="needs_review">{tr(language, "Needs review", "ต้องตรวจสอบ")}</SelectItem>
                    <SelectItem value="unmatched">{tr(language, "Unmatched", "ไม่พบ session")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[360px] overflow-auto rounded-xl border border-slate-100 bg-white [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{tr(language, "Device", "อุปกรณ์")}</TableHead>
                  <TableHead>{tr(language, "Status", "สถานะ")}</TableHead>
                  <TableHead>{tr(language, "Reason", "สาเหตุ")}</TableHead>
                  <TableHead>{tr(language, "Patient context", "บริบทผู้ป่วย")}</TableHead>
                  <TableHead>{tr(language, "Received", "เวลาที่รับ")}</TableHead>
                  <TableHead className="text-right">{tr(language, "Actions", "จัดการ")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReviewItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      {tr(language, "No flagged measurements in this filter.", "ไม่พบรายการที่ติดธงตามตัวกรองนี้")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredReviewItems.map((item) => {
                    const verifying = reviewActionId === `verified:${item.record_id}`;
                    const quarantining = reviewActionId === `quarantined:${item.record_id}`;
                    return (
                      <TableRow key={item.record_id}>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">{item.device_id}</div>
                            <div className="text-xs text-muted-foreground">
                              #{item.record_id.slice(0, 8)} · {tr(language, "Position", "ตำแหน่ง")} {item.position}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[0.72rem] font-medium",
                              routingBadgeClass(item.routing_status),
                            )}
                          >
                            {routingStatusLabel(item.routing_status, language)}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {reviewReasonLabel(item, language)}
                        </TableCell>
                        <TableCell className="align-top">
                          {item.patient_name ? (
                            <div className="space-y-1">
                              <div className="font-medium text-slate-900">{item.patient_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {item.patient_id}
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              {tr(language, "No patient linked yet", "ยังไม่มีผู้ป่วยที่ผูกไว้")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {formatDateTime(item.server_received_at, language)}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={Boolean(reviewActionId)}
                              onClick={() => void handleReviewAction(item, "verified")}
                            >
                              {verifying ? (
                                <Loader2 className="mr-2 size-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-2 size-3.5" />
                              )}
                              {tr(language, "Verify", "ยืนยัน")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={Boolean(reviewActionId)}
                              onClick={() => void handleReviewAction(item, "quarantined")}
                            >
                              {quarantining ? (
                                <Loader2 className="mr-2 size-3.5 animate-spin" />
                              ) : (
                                <XCircle className="mr-2 size-3.5" />
                              )}
                              {tr(language, "Quarantine", "กักกัน")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.22fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{tr(language, "Current sessions", "รายการตรวจปัจจุบัน")}</CardTitle>
            <CardDescription>
              {tr(
                language,
                "Real-time patient-device assignments for sessions that are active now.",
                "ข้อมูลการใช้เครื่องกับผู้ป่วยแบบเรียลไทม์สำหรับรายการที่กำลังตรวจอยู่",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[380px] overflow-auto rounded-xl border border-slate-100 bg-white [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{tr(language, "Device", "อุปกรณ์")}</TableHead>
                  <TableHead>{tr(language, "Patient", "ผู้ป่วย")}</TableHead>
                  <TableHead>{tr(language, "Mode", "โหมด")}</TableHead>
                  <TableHead>{tr(language, "Freshness", "ความสดของสัญญาณ")}</TableHead>
                  <TableHead className="text-right">{tr(language, "Actions", "จัดการ")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSessions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      {tr(language, "No live sessions match this filter.", "ไม่พบ session ที่ตรงกับตัวกรองนี้")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSessions.map((session) => {
                    const MeasurementIcon = measurementIcon(session.measurement_type);
                    const isVeryFresh = (session.seconds_since_last_seen ?? 999) < 15;
                    return (
                      <TableRow key={session.session_id}>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {session.device_display_name || session.device_id}
                            </div>
                            <div className="text-xs text-muted-foreground">{session.device_id}</div>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">{session.patient_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {tr(language, "Started", "เริ่ม")} {formatDateTime(session.started_at, language)}
                            </div>
                            {session.pairing_code ? (
                              <div className="text-xs font-medium text-slate-500">
                                {tr(language, "Pairing", "รหัสจับคู่")} {session.pairing_code}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                            <MeasurementIcon className="size-3.5" />
                            {measurementLabel(session.measurement_type, language)}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={cn("rounded-full border px-2.5 py-1 text-[0.72rem] font-medium", freshnessBadgeClass(session.freshness_status))}
                              >
                                {session.freshness_status === "fresh"
                                  ? tr(language, "Fresh", "สด")
                                  : session.freshness_status === "stale"
                                    ? tr(language, "Stale", "ขาดช่วง")
                                    : tr(language, "Unknown", "ไม่ทราบ")}
                              </Badge>
                              {isVeryFresh && (
                                <div className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatRelativeSeconds(session.seconds_since_last_seen, language)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex justify-end gap-2">
                            {canManageSessions ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg"
                                onClick={async () => {
                                  if (!token) return;
                                  try {
                                    await completeDeviceExamSession(token, session.session_id, {
                                      notes: tr(language, "Completed from live device operations.", "จบการตรวจจากหน้าปฏิบัติการอุปกรณ์"),
                                    });
                                    toast.success(tr(language, "Session completed", "จบการตรวจแล้ว"));
                                    void loadSnapshot();
                                  } catch (error) {
                                    toast.apiError(
                                      tr(language, "Failed to complete session", "จบการตรวจไม่สำเร็จ"),
                                      error,
                                      tr(language, "Please try again or refresh the page.", "โปรดลองอีกครั้งหรือรีเฟรชหน้า"),
                                    );
                                  }
                                }}
                              >
                                <Square className="mr-1.5 size-3 fill-current" />
                                {tr(language, "Complete", "จบงาน")}
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-full hover:bg-sky-50 hover:text-sky-600"
                              onClick={() => window.open(`/patients/${session.patient_id}/heart-sound`, "_blank")}
                              aria-label={tr(language, "View patient result", "ดูผลผู้ป่วย")}
                            >
                              <ExternalLink className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr(language, "Device inventory", "สถานะเครื่องทั้งหมด")}</CardTitle>
            <CardDescription>
              {tr(
                language,
                "See which devices are idle, in use, redacted as busy, or inactive.",
                "ดูว่าเครื่องใดว่าง กำลังใช้งาน ถูกซ่อนข้อมูลเป็น busy หรือปิดใช้งานอยู่",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[380px] overflow-auto rounded-xl border border-slate-100 bg-white [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white">
            <Table className="min-w-[620px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{tr(language, "Device", "อุปกรณ์")}</TableHead>
                  <TableHead>{tr(language, "Availability", "สถานะ")}</TableHead>
                  <TableHead>{tr(language, "Context", "บริบท")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInventory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                      {tr(language, "No devices match this filter.", "ไม่พบอุปกรณ์ที่ตรงกับตัวกรองนี้")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredInventory.map((item) => (
                    <TableRow key={item.device_id}>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <div className="font-medium text-slate-900">{item.device_display_name}</div>
                          <div className="text-xs text-muted-foreground">{item.device_id}</div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-2">
                          <Badge
                            variant="outline"
                            className={cn("rounded-full border px-2.5 py-1 text-[0.72rem] font-medium", availabilityBadgeClass(item.availability_status))}
                          >
                            {item.availability_status === "in_use"
                              ? tr(language, "In use", "กำลังใช้งาน")
                              : item.availability_status === "busy"
                                ? tr(language, "Busy", "ถูกใช้อยู่")
                                : item.availability_status === "inactive"
                                  ? tr(language, "Inactive", "ปิดใช้งาน")
                                  : tr(language, "Idle", "พร้อมใช้งาน")}
                          </Badge>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(item.session_last_seen_at || item.device_last_seen_at, language)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {item.patient_name ? (
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">{item.patient_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.measurement_type
                                ? measurementLabel(item.measurement_type, language)
                                : tr(language, "No active mode", "ยังไม่มีโหมดตรวจ")}
                            </div>
                          </div>
                        ) : item.availability_status === "busy" ? (
                          <div className="text-sm text-muted-foreground">
                            {tr(language, "Assigned to another patient you cannot inspect here.", "กำลังใช้อยู่กับผู้ป่วยรายอื่นที่คุณไม่มีสิทธิ์ดูรายละเอียด")}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            {item.availability_status === "inactive"
                              ? tr(language, "Unavailable for assignment.", "ยังไม่พร้อมให้เลือกใช้งาน")
                              : tr(language, "Ready for the next session.", "พร้อมสำหรับ session ถัดไป")}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{tr(language, "Recently completed", "รายการที่ตรวจเสร็จล่าสุด")}</CardTitle>
                <CardDescription>
                  {tr(
                    language,
                    "Last 5 sessions that were automatically or manually finished.",
                    "5 รายการล่าสุดที่จบการตรวจ (ทั้งแบบอัตโนมัติและแบบปกติ)",
                  )}
                </CardDescription>
              </div>
              <CheckCircle2 className="size-5 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[320px] overflow-auto rounded-xl border border-slate-100 bg-white [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{tr(language, "Patient", "ผู้ป่วย")}</TableHead>
                  <TableHead>{tr(language, "Device", "อุปกรณ์")}</TableHead>
                  <TableHead>{tr(language, "Completed at", "จบการตรวจเมื่อ")}</TableHead>
                  <TableHead className="text-right">{tr(language, "View", "ดูผล")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentCompletedData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      {tr(language, "No completed sessions yet.", "ยังไม่มีรายการที่ตรวจเสร็จ")}
                    </TableCell>
                  </TableRow>
                ) : (
                  recentCompletedData.map((session) => {
                    const MeasurementIcon = measurementIcon(session.measurement_type);
                    return (
                      <TableRow key={session.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">{(session as any).patient_name || session.patient_id}</div>
                            <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <MeasurementIcon className="size-3" />
                              {measurementLabel(session.measurement_type, language)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-slate-900">{session.device_id}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(session.ended_at, language)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="rounded-full hover:bg-sky-50 hover:text-sky-600"
                            onClick={() => window.open(`/patients/${session.patient_id}/heart-sound`, '_blank')}
                          >
                            <ExternalLink className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </div>

    </section>

      {/* Confirmation Dialog for switching patient on a busy device */}
      <Dialog open={showSwitchConfirm} onOpenChange={setShowSwitchConfirm}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <CircleAlert className="size-6" />
            </div>
            <DialogTitle className="text-center text-xl">
              {tr(language, "Device is currently busy", "เครื่องกำลังถูกใช้งานอยู่")}
            </DialogTitle>
            <DialogDescription className="pt-2 text-center text-slate-600">
              {tr(
                language,
                `This device is still active for ${activeSessionToClose?.patient_name || 'another patient'}.`,
                `เครื่องนี้กำลังใช้ตรวจคุณ ${activeSessionToClose?.patient_name || 'คนไข้อื่น'} อยู่`,
              )}
              <br />
              {tr(
                language,
                "Starting a new session will automatically close the current one. Any delayed data will be sent to the Review Queue.",
                "การเริ่มรอบใหม่จะจบเคสปัจจุบันทันที ข้อมูลที่ส่งมาเลทจะถูกส่งไปที่คิวตรวจสอบ",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              variant="default"
              className="w-full bg-amber-600 hover:bg-amber-700"
              onClick={() => void executeStartSession(true)}
              disabled={startSubmitting}
            >
              {startSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              {tr(language, "Confirm and Switch", "ยืนยันและสลับคนไข้")}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setShowSwitchConfirm(false);
                setActiveSessionToClose(null);
              }}
              disabled={startSubmitting}
            >
              {tr(language, "Cancel", "ยกเลิก")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
