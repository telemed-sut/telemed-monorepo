"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Activity,
  CheckCircle2,
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
  activateDeviceExamSession,
  cancelDeviceExamSession,
  completeDeviceExamSession,
  createDeviceExamSession,
  fetchDeviceLungSoundReviewQueue,
  fetchDeviceInventory,
  fetchDeviceLiveSessions,
  fetchPatients,
  isProbablyJwt,
  resolveDeviceLungSoundReviewItem,
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
const MEASUREMENT_OPTIONS: DeviceExamMeasurementType[] = ["lung_sound", "heart_sound", "blood_pressure", "multi"];
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
  const statuses: DeviceLiveSessionItem["status"][] = ["active", "stale", "pending_pair"];
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
  const [reviewRoutingFilter, setReviewRoutingFilter] = useState<ReviewRoutingFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [includePending, setIncludePending] = useState(true);
  const [staleAfterSeconds, setStaleAfterSeconds] = useState<number>(120);
  const [query, setQuery] = useState("");
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [measurementType, setMeasurementType] = useState<DeviceExamMeasurementType>(DEFAULT_MEASUREMENT_TYPE);
  const [activateNow, setActivateNow] = useState(true);
  const [sessionNotes, setSessionNotes] = useState("");
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);
  const [pairingSession, setPairingSession] = useState<DeviceLiveSessionItem | null>(null);
  const [pairingQrDataUrl, setPairingQrDataUrl] = useState<string | null>(null);
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
        const [liveSessions, inventory, reviewQueue] = await Promise.all([
          fetchDeviceLiveSessions(token, {
            includePending,
            staleAfterSeconds,
          }),
          fetchDeviceInventory(token, {
            staleAfterSeconds,
          }),
          reviewPromise,
        ]);
        setLiveData(liveSessions);
        setInventoryData(inventory);
        setReviewData(reviewQueue);
        setErrorText(null);
        setLastUpdated(new Date());
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
    if (!pairingSession?.pairing_code) {
      setPairingQrDataUrl(null);
      return;
    }

    let cancelled = false;
    const payload = JSON.stringify({
      type: "device_exam_session_pairing",
      version: 1,
      session_id: pairingSession.session_id,
      device_id: pairingSession.device_id,
      pairing_code: pairingSession.pairing_code,
      measurement_type: pairingSession.measurement_type,
    });

    QRCode.toDataURL(payload, {
      margin: 2,
      width: 240,
      errorCorrectionLevel: "M",
    })
      .then((dataUrl) => {
        if (!cancelled) setPairingQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setPairingQrDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [pairingSession]);

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
        (item) => item.is_active && item.availability_status === "idle",
      ),
    [inventoryData?.items],
  );

  useEffect(() => {
    if (!selectedDeviceId || availableDevices.some((device) => device.device_id === selectedDeviceId)) {
      return;
    }
    setSelectedDeviceId("");
  }, [availableDevices, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDeviceId) {
      return;
    }
    const selectedDevice = availableDevices.find((device) => device.device_id === selectedDeviceId);
    if (selectedDevice?.default_measurement_type) {
      setMeasurementType(selectedDevice.default_measurement_type);
    }
  }, [availableDevices, selectedDeviceId]);

  const handleStartSession = useCallback(async () => {
    if (!token || startSubmitting) return;
    if (!selectedPatient) {
      toast.warning(tr(language, "Select a patient first", "เลือกผู้ป่วยก่อน"), {
        description: tr(language, "Search and choose the patient this device is about to examine.", "ค้นหาและเลือกผู้ป่วยที่จะตรวจด้วยเครื่องนี้"),
      });
      return;
    }
    if (!selectedDeviceId) {
      toast.warning(tr(language, "Select an idle device", "เลือกเครื่องที่ว่างก่อน"), {
        description: tr(language, "Only idle active devices can start a new session from this board.", "เริ่ม session ใหม่จากหน้านี้ได้เฉพาะเครื่อง active ที่ยังว่างอยู่"),
      });
      return;
    }

    setStartSubmitting(true);
    try {
      const session = await createDeviceExamSession(token, {
        patient_id: selectedPatient.id,
        device_id: selectedDeviceId,
        measurement_type: measurementType,
        notes: sessionNotes.trim() || null,
        activate_now: activateNow,
      });
      toast.success(
        activateNow
          ? tr(language, "Session started", "เริ่มรอบตรวจแล้ว")
          : tr(language, "Pairing session created", "สร้างรอบรอจับคู่แล้ว"),
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
    }
  }, [
    activateNow,
    language,
    loadSnapshot,
    measurementType,
    selectedDeviceId,
    selectedPatient,
    sessionNotes,
    startSubmitting,
    token,
  ]);

  const handleSessionAction = useCallback(
    async (session: DeviceLiveSessionItem, action: "activate" | "complete" | "cancel") => {
      if (!token || sessionActionId) return;
      setSessionActionId(`${action}:${session.session_id}`);
      try {
        if (action === "activate") {
          await activateDeviceExamSession(token, session.session_id);
          toast.success(tr(language, "Session activated", "เปิดใช้งาน session แล้ว"));
        } else if (action === "complete") {
          await completeDeviceExamSession(token, session.session_id, {
            notes: tr(language, "Completed from live device operations.", "จบการตรวจจากหน้า live device operations"),
          });
          toast.success(tr(language, "Session completed", "จบรอบตรวจแล้ว"));
        } else {
          await cancelDeviceExamSession(token, session.session_id, {
            notes: tr(language, "Cancelled from live device operations.", "ยกเลิกจากหน้า live device operations"),
          });
          toast.success(tr(language, "Session cancelled", "ยกเลิก session แล้ว"));
        }
        await loadSnapshot();
      } catch (error) {
        toast.apiError(
          tr(language, "Session update failed", "อัปเดต session ไม่สำเร็จ"),
          error,
          tr(language, "Unable to update this device session.", "ไม่สามารถอัปเดต session อุปกรณ์นี้ได้"),
        );
      } finally {
        setSessionActionId(null);
      }
    },
    [language, loadSnapshot, sessionActionId, token],
  );

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
    <section className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-slate-950">
            {tr(language, "Live Device Operations", "สถานะการใช้งานอุปกรณ์แบบสด")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tr(
              language,
              "See which device is paired to which patient right now, plus whether each cart is idle, in use, or busy.",
              "ดูว่าอุปกรณ์ตัวไหนกำลังผูกกับผู้ป่วยคนใดอยู่ตอนนี้ พร้อมสถานะว่าเครื่องว่าง กำลังใช้งาน หรือถูกใช้อยู่โดยเคสอื่น",
            )}
          </p>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground">
              {tr(language, "Snapshot refreshed", "อัปเดต snapshot ล่าสุด")} {formatDateTime(lastUpdated.toISOString(), language)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn("rounded-full border px-2.5 py-1 text-[0.7rem] font-medium", streamMeta.className)} variant="outline">
            {streamMeta.label}
          </Badge>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-xs">
            <Switch id="live-include-pending" checked={includePending} onCheckedChange={setIncludePending} />
            <Label htmlFor="live-include-pending" className="text-sm">
              {tr(language, "Include pending", "รวมรายการที่รอจับคู่")}
            </Label>
          </div>
          <Select
            value={String(staleAfterSeconds)}
            onValueChange={(value) => setStaleAfterSeconds(Number(value))}
          >
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIVE_STALE_OPTIONS.map((seconds) => (
                <SelectItem key={seconds} value={String(seconds)}>
                  {tr(language, "Stale after", "ถือว่าขาดช่วงเมื่อ")} {seconds}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative w-full min-w-[220px] max-w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-9 text-sm"
              placeholder={tr(language, "Search device or patient", "ค้นหาเครื่องหรือผู้ป่วย")}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadSnapshot()} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            {tr(language, "Refresh", "รีเฟรช")}
          </Button>
        </div>
      </div>

      {errorText && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      {canManageSessions ? (
      <Card className="border-slate-200 bg-white">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserRoundPlus className="size-5 text-sky-600" />
                {tr(language, "Start device session", "เริ่มรอบตรวจด้วยเครื่อง")}
              </CardTitle>
              <CardDescription>
                {tr(
                  language,
                  "Pick an idle device, choose the patient, and create the live pairing before examination starts.",
                  "เลือกเครื่องที่ว่าง เลือกผู้ป่วย แล้วสร้างการจับคู่สดก่อนเริ่มตรวจ",
                )}
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
              {availableDevices.length} {tr(language, "idle", "เครื่องว่าง")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <Label htmlFor="device-session-patient-search">
              {tr(language, "Patient", "ผู้ป่วย")}
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="device-session-patient-search"
                value={patientQuery}
                onChange={(event) => {
                  setPatientQuery(event.target.value);
                  setSelectedPatient(null);
                }}
                className="pl-9"
                placeholder={tr(language, "Search name or patient ID", "ค้นหาชื่อหรือรหัสผู้ป่วย")}
              />
            </div>
            <div className="grid max-h-[210px] gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2">
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
                        "flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
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

          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>{tr(language, "Idle device", "เครื่องที่ว่าง")}</Label>
              <Select value={selectedDeviceId} onValueChange={(value) => setSelectedDeviceId(value ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder={tr(language, "Choose an idle device", "เลือกเครื่องที่ว่าง")} />
                </SelectTrigger>
                <SelectContent>
                  {availableDevices.map((device) => (
                    <SelectItem key={device.device_id} value={device.device_id}>
                      {device.device_display_name} · {device.device_id} · {measurementLabel(device.default_measurement_type, language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{tr(language, "Measurement mode", "โหมดการตรวจ")}</Label>
              <Select value={measurementType} onValueChange={(value) => setMeasurementType(value as DeviceExamMeasurementType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEASUREMENT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {measurementLabel(option, language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="device-session-notes">{tr(language, "Notes", "หมายเหตุ")}</Label>
              <Textarea
                id="device-session-notes"
                value={sessionNotes}
                onChange={(event) => setSessionNotes(event.target.value)}
                rows={3}
                placeholder={tr(language, "Optional context for this examination", "บริบทเพิ่มเติมสำหรับรอบตรวจนี้ ถ้ามี")}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Label htmlFor="device-session-activate-now" className="text-sm">
                {tr(language, "Activate immediately", "เปิดใช้งานทันที")}
              </Label>
              <Switch id="device-session-activate-now" checked={activateNow} onCheckedChange={setActivateNow} />
            </div>
            <Button
              type="button"
              onClick={() => void handleStartSession()}
              disabled={startSubmitting || !token || availableDevices.length === 0}
              className="w-full"
            >
              {startSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              {tr(language, "Start session", "เริ่มรอบตรวจ")}
            </Button>
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
                "Your role can monitor device-patient pairing, while starting or ending sessions is limited to doctors and admins.",
                "บทบาทของคุณดูการจับคู่เครื่องกับผู้ป่วยได้ แต่การเริ่มหรือจบ session จำกัดเฉพาะแพทย์และแอดมิน",
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
            <CardDescription>{tr(language, "Idle devices", "เครื่องที่พร้อมใช้งาน")}</CardDescription>
            <CardTitle className="text-2xl font-semibold">{inventoryData?.idle_count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className="border-violet-200/80 bg-violet-50/70">
          <CardHeader>
            <CardDescription>{tr(language, "Busy devices", "เครื่องที่ถูกใช้โดยเคสอื่น")}</CardDescription>
            <CardTitle className="text-2xl font-semibold">{inventoryData?.busy_count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {canManageSessions && (
        <Card>
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
            <Table>
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
                "การจับคู่ผู้ป่วยกับอุปกรณ์แบบเรียลไทม์สำหรับ session ที่กำลังใช้งานอยู่ตอนนี้",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr(language, "Device", "อุปกรณ์")}</TableHead>
                  <TableHead>{tr(language, "Patient", "ผู้ป่วย")}</TableHead>
                  <TableHead>{tr(language, "Mode", "โหมด")}</TableHead>
                  <TableHead>{tr(language, "Freshness", "ความสดของสัญญาณ")}</TableHead>
                  {canManageSessions && (
                    <TableHead className="text-right">{tr(language, "Actions", "จัดการ")}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSessions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canManageSessions ? 5 : 4} className="py-10 text-center text-muted-foreground">
                      {tr(language, "No live sessions match this filter.", "ไม่พบ session ที่ตรงกับตัวกรองนี้")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSessions.map((session) => {
                    const MeasurementIcon = measurementIcon(session.measurement_type);
                    return (
                      <TableRow key={session.session_id}>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {session.device_display_name || session.device_id}
                            </div>
                            <div className="text-xs text-muted-foreground">{session.device_id}</div>
                            {session.pairing_code && (
                              <div className="text-xs text-muted-foreground">
                                {tr(language, "Pair", "รหัสจับคู่")} {session.pairing_code}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">{session.patient_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {tr(language, "Started", "เริ่ม")} {formatDateTime(session.started_at, language)}
                            </div>
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
                            <div className="text-xs text-muted-foreground">
                              {formatRelativeSeconds(session.seconds_since_last_seen, language)}
                            </div>
                          </div>
                        </TableCell>
                        {canManageSessions && (
                        <TableCell className="align-top">
                          <div className="flex justify-end gap-2">
                            {session.pairing_code && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setPairingSession(session)}
                              >
                                <Monitor className="mr-2 size-3.5" />
                                {tr(language, "Pair", "จับคู่")}
                              </Button>
                            )}
                            {session.status === "pending_pair" && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={Boolean(sessionActionId)}
                                onClick={() => void handleSessionAction(session, "activate")}
                              >
                                {sessionActionId === `activate:${session.session_id}` ? (
                                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                                ) : (
                                  <Play className="mr-2 size-3.5" />
                                )}
                                {tr(language, "Activate", "เปิด")}
                              </Button>
                            )}
                            {(session.status === "active" || session.status === "stale") && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={Boolean(sessionActionId)}
                                onClick={() => void handleSessionAction(session, "complete")}
                              >
                                {sessionActionId === `complete:${session.session_id}` ? (
                                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                                ) : (
                                  <Square className="mr-2 size-3.5" />
                                )}
                                {tr(language, "Complete", "จบ")}
                              </Button>
                            )}
                            {(session.status === "active" || session.status === "pending_pair" || session.status === "stale") && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={Boolean(sessionActionId)}
                                onClick={() => void handleSessionAction(session, "cancel")}
                              >
                                {sessionActionId === `cancel:${session.session_id}` ? (
                                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                                ) : (
                                  <XCircle className="mr-2 size-3.5" />
                                )}
                                {tr(language, "Cancel", "ยกเลิก")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
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
            <Table>
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
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(pairingSession)} onOpenChange={(open) => !open && setPairingSession(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{tr(language, "Device pairing", "จับคู่อุปกรณ์")}</DialogTitle>
            <DialogDescription>
              {tr(
                language,
                "Show this code to the device flow or scan it from a supported device app.",
                "นำรหัสนี้ให้เครื่องหรือสแกนจากแอปอุปกรณ์ที่รองรับ",
              )}
            </DialogDescription>
          </DialogHeader>
          {pairingSession && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="font-medium text-slate-900">
                  {pairingSession.device_display_name || pairingSession.device_id}
                </div>
                <div className="mt-1 text-muted-foreground">{pairingSession.patient_name}</div>
                <div className="mt-3 rounded-xl bg-white px-3 py-2 font-mono text-lg font-semibold tracking-[0.18em] text-slate-950">
                  {pairingSession.pairing_code}
                </div>
              </div>
              <div className="flex justify-center rounded-2xl border border-slate-200 bg-white p-4">
                {pairingQrDataUrl ? (
                  <Image
                    src={pairingQrDataUrl}
                    alt={tr(language, "Pairing QR code", "คิวอาร์โค้ดสำหรับจับคู่")}
                    className="size-60"
                    width={240}
                    height={240}
                  />
                ) : (
                  <div className="flex size-60 items-center justify-center text-sm text-muted-foreground">
                    {tr(language, "QR unavailable", "ยังสร้าง QR ไม่ได้")}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
