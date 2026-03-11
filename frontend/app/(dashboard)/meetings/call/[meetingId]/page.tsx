"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createMeetingPatientInvite,
  fetchMeetingReliabilitySnapshot,
  heartbeatDoctorMeetingPresence,
  issueMeetingVideoToken,
  leaveDoctorMeetingPresence,
  type MeetingReliabilitySnapshot,
  type MeetingPatientInviteResponse,
  type MeetingVideoTokenResponse,
} from "@/lib/api";
import {
  loadZegoUIKitPrebuilt,
  type ZegoUIKitPrebuiltInstance,
} from "@/lib/zego-uikit";
import {
  MEETING_CALL_TEST_PROFILES,
  buildMeetingCallDiagnosticsReport,
  type MeetingCallTestProfile,
} from "@/lib/meeting-call-test-profiles";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

function stringifyConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function isExpectedZegoConsoleNoise(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("\"action\":\"zc.") ||
    normalized.includes("\"appid\":") ||
    normalized.includes("\"roomid\":") ||
    normalized.includes("session request timeout") ||
    normalized.includes("play stream interrupted") ||
    normalized.includes("stream does not exist") ||
    normalized.includes("connect not establish logout") ||
    normalized.includes("cmdreq connect not establish") ||
    normalized.includes("\"code\":1004020") ||
    normalized.includes("[zegoroommobile]createstream error") ||
    normalized.includes("a user gesture is required") ||
    normalized.includes("notallowederror") ||
    normalized.includes("notfounderror") ||
    normalized.includes("requested device not found") ||
    normalized.includes("createStream or publishLocalStream failed".toLowerCase()) ||
    normalized.includes("\"errorcode\":1103061") ||
    normalized.includes("get media fail") ||
    normalized.includes("setsinkid") ||
    normalized.includes("\"code\":1104036")
  );
}

function stringifyErrorReason(reason: unknown): string {
  if (typeof reason === "string") {
    return reason;
  }
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }
  if (reason && typeof reason === "object") {
    const unknownRecord = reason as Record<string, unknown>;
    const name =
      typeof unknownRecord.name === "string" ? unknownRecord.name : "";
    const message =
      typeof unknownRecord.message === "string" ? unknownRecord.message : "";
    const merged = `${name} ${message}`.trim();
    if (merged) {
      return merged;
    }
  }
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function isExpectedMediaPermissionNoise(reason: unknown): boolean {
  const normalized = stringifyErrorReason(reason).toLowerCase();
  return (
    normalized.includes("a user gesture is required") ||
    normalized.includes("notallowederror") ||
    normalized.includes("setsinkid") ||
    normalized.includes("zego")
  );
}

type DoctorMediaWarmupPreference = {
  allowCamera: boolean;
  allowMicrophone: boolean;
  hint: string | null;
};

function warmupDoctorMediaDevices(
  language: AppLanguage
): Promise<DoctorMediaWarmupPreference> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.resolve({
      allowCamera: false,
      allowMicrophone: false,
      hint: tr(
        language,
        "This browser cannot access camera/microphone APIs. You can still join muted and retry in call controls.",
        "เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้อง/ไมค์ เข้าห้องแบบปิดไมค์ก่อนได้ และค่อยลองเปิดใหม่ในปุ่มควบคุมคอล"
      ),
    });
  }

  return navigator.mediaDevices
    .getUserMedia({
      video: {
        facingMode: "user",
      },
      audio: true,
    })
    .then((stream) => {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      return {
        allowCamera: true,
        allowMicrophone: true,
        hint: null,
      };
    })
    .catch((error: unknown) => {
      const normalized = stringifyErrorReason(error).toLowerCase();
      if (
        normalized.includes("notallowederror") ||
        normalized.includes("permission denied") ||
        normalized.includes("permission")
      ) {
        return {
          allowCamera: false,
          allowMicrophone: false,
          hint: tr(
            language,
            "Camera/Mic permission is not allowed yet. Joined in muted mode; allow permission from browser settings, then enable devices in call controls.",
            "ยังไม่ได้อนุญาตกล้อง/ไมค์ เข้าห้องแบบปิดอุปกรณ์ก่อน แล้วอนุญาตจากการตั้งค่าเบราว์เซอร์ก่อนกลับมาเปิดที่ปุ่มควบคุมคอล"
          ),
        };
      }

      if (
        normalized.includes("notfounderror") ||
        normalized.includes("overconstrainederror")
      ) {
        return {
          allowCamera: false,
          allowMicrophone: false,
          hint: tr(
            language,
            "No usable camera/mic was found on this device right now. Join muted and retry camera later.",
            "ไม่พบกล้อง/ไมค์ที่ใช้งานได้ในอุปกรณ์นี้ตอนนี้ เข้าห้องแบบปิดอุปกรณ์ก่อน และลองเปิดใหม่ภายหลัง"
          ),
        };
      }

      if (normalized.includes("user gesture")) {
        return {
          allowCamera: false,
          allowMicrophone: false,
          hint: tr(
            language,
            "Browser requires a user interaction before media can start. Joined muted; tap camera/mic in call controls to retry.",
            "เบราว์เซอร์ต้องมีการกดจากผู้ใช้ก่อนเริ่มกล้อง/ไมค์ จึงเข้าห้องแบบปิดอุปกรณ์ก่อน แล้วกดปุ่มกล้อง/ไมค์ในคอลเพื่อเริ่มใหม่"
          ),
        };
      }

      return {
        allowCamera: false,
        allowMicrophone: false,
        hint: tr(
          language,
          "Camera/Mic is not ready yet on this device. Joined in muted mode; tap camera/mic in call controls to retry.",
          "กล้อง/ไมค์ยังไม่พร้อมในอุปกรณ์นี้ เข้าห้องแบบปิดอุปกรณ์ก่อน แล้วกดปุ่มกล้อง/ไมค์ในคอลเพื่อลองใหม่"
        ),
      };
    });
}

let isSetSinkIdPatched = false;

function patchSetSinkIdForMobileSafari(): void {
  if (isSetSinkIdPatched || typeof window === "undefined") {
    return;
  }

  const mediaPrototype = window.HTMLMediaElement?.prototype as
    | (HTMLMediaElement & { setSinkId?: (sinkId: string) => Promise<void> })
    | undefined;
  if (!mediaPrototype || typeof mediaPrototype.setSinkId !== "function") {
    isSetSinkIdPatched = true;
    return;
  }

  const originalSetSinkId = mediaPrototype.setSinkId;
  mediaPrototype.setSinkId = function patchedSetSinkId(
    this: HTMLMediaElement,
    sinkId: string
  ): Promise<void> {
    try {
      return originalSetSinkId.call(this, sinkId).catch((error: unknown) => {
        if (isExpectedMediaPermissionNoise(error)) {
          return;
        }
        throw error;
      });
    } catch (error: unknown) {
      if (isExpectedMediaPermissionNoise(error)) {
        return Promise.resolve();
      }
      throw error;
    }
  };

  isSetSinkIdPatched = true;
}

function toDoctorCallNotice(language: AppLanguage, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("session request timeout")) {
    return tr(
      language,
      "Patient stream timed out. Patient may have weak network or has not granted camera/mic yet.",
      "สตรีมคนไข้เชื่อมต่อไม่ทันเวลา อาจเกิดจากเน็ตไม่เสถียรหรือคนไข้ยังไม่อนุญาตกล้อง/ไมค์"
    );
  }
  if (
    normalized.includes("createstream") ||
    normalized.includes("publishlocalstream failed") ||
    normalized.includes("1103061") ||
    normalized.includes("notfounderror") ||
    normalized.includes("requested device not found") ||
    normalized.includes("1104036") ||
    normalized.includes("1004020") ||
    normalized.includes("play stream interrupted") ||
    normalized.includes("stream does not exist") ||
    normalized.includes("a user gesture is required") ||
    normalized.includes("setsinkid")
  ) {
    return tr(
      language,
      "Patient denied or has not allowed camera/mic yet. They can remain in waiting room muted and enable permission later.",
      "คนไข้อาจกดไม่อนุญาตหรือยังไม่อนุญาตกล้อง/ไมค์ ขณะนี้ยังรอในห้องแบบปิดไมค์ได้ และเปิดสิทธิ์ภายหลังได้"
    );
  }
  return tr(
    language,
    "Call has a temporary media issue. Keep the room open and retry shortly.",
    "ห้องมีปัญหาสื่อชั่วคราว กรุณาเปิดห้องค้างไว้และลองใหม่อีกครั้ง"
  );
}

function shortenUrl(url: string, maxLength = 88): string {
  if (url.length <= maxLength) return url;
  const headLength = Math.floor(maxLength * 0.65);
  const tailLength = maxLength - headLength - 3;
  return `${url.slice(0, headLength)}...${url.slice(-tailLength)}`;
}

function formatAgeLabel(
  language: AppLanguage,
  ageSeconds?: number | null
): string {
  if (typeof ageSeconds !== "number") {
    return tr(language, "No heartbeat yet", "ยังไม่มี heartbeat");
  }
  if (ageSeconds < 60) {
    return tr(language, `${ageSeconds}s ago`, `${ageSeconds} วินาทีที่แล้ว`);
  }
  const minutes = Math.floor(ageSeconds / 60);
  const seconds = ageSeconds % 60;
  return tr(
    language,
    `${minutes}m ${seconds}s ago`,
    `${minutes} นาที ${seconds} วินาทีที่แล้ว`
  );
}

function formatPanelDateTime(
  language: AppLanguage,
  value?: string | null
): string {
  if (!value) {
    return tr(language, "Not recorded", "ยังไม่ได้บันทึก");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(language === "th" ? "th-TH" : "en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const DOCTOR_PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;
const DOCTOR_RECONNECT_GRACE_MS = 30_000;
const DOCTOR_HEARTBEAT_RECONNECT_THRESHOLD = 3;
const DOCTOR_HEARTBEAT_REJOIN_THRESHOLD = 6;

type CallHealthState =
  | "healthy"
  | "degraded"
  | "reconnecting"
  | "rejoin_required";

type CallHealthAppearance = {
  badge: string;
  title: string;
  detail: string;
  tone: "emerald" | "amber" | "red";
  ctaLabel: string | null;
};

type CallReliabilityEventTone = "info" | "warning" | "critical";

type CallReliabilityEvent = {
  id: number;
  at: string;
  tone: CallReliabilityEventTone;
  message: string;
};

function getCallHealthAppearance(
  language: AppLanguage,
  state: CallHealthState,
  detail?: string | null
): CallHealthAppearance {
  switch (state) {
    case "healthy":
      return {
        badge: tr(language, "Stable", "เสถียร"),
        title: tr(language, "Call is stable", "การคอลเสถียร"),
        detail:
          detail ??
          tr(
            language,
            "Audio/video and room presence look healthy right now.",
            "เสียง ภาพ และสถานะห้องปัจจุบันอยู่ในเกณฑ์ปกติ"
          ),
        tone: "emerald",
        ctaLabel: null,
      };
    case "degraded":
      return {
        badge: tr(language, "Degraded", "เริ่มไม่เสถียร"),
        title: tr(language, "Connection quality dropped", "คุณภาพการเชื่อมต่อลดลง"),
        detail:
          detail ??
          tr(
            language,
            "Keep the room open. Audio should be prioritized while the call stabilizes.",
            "กรุณาเปิดห้องค้างไว้ ระบบจะพยายามรักษาเสียงพูดคุยก่อนขณะคอลเริ่มแกว่ง"
          ),
        tone: "amber",
        ctaLabel: tr(language, "Try again", "ลองใหม่"),
      };
    case "reconnecting":
      return {
        badge: tr(language, "Reconnecting", "กำลังเชื่อมต่อใหม่"),
        title: tr(language, "Call is recovering", "ระบบกำลังกู้การเชื่อมต่อ"),
        detail:
          detail ??
          tr(
            language,
            "Keep this page open while room presence and media reconnect.",
            "กรุณาเปิดหน้านี้ค้างไว้ระหว่างที่ระบบเชื่อมต่อสื่อและสถานะห้องกลับมา"
          ),
        tone: "amber",
        ctaLabel: tr(language, "Retry join", "เข้าห้องใหม่"),
      };
    case "rejoin_required":
      return {
        badge: tr(language, "Action needed", "ต้องดำเนินการ"),
        title: tr(language, "Manual rejoin is required", "ต้องเข้าห้องใหม่ด้วยตนเอง"),
        detail:
          detail ??
          tr(
            language,
            "Automatic recovery took too long. Rejoin the room to refresh media and room presence.",
            "ระบบกู้คืนอัตโนมัติใช้เวลานานเกินไป กรุณาเข้าห้องใหม่เพื่อรีเฟรชสื่อและสถานะห้อง"
          ),
        tone: "red",
        ctaLabel: tr(language, "Rejoin call", "เข้าห้องใหม่"),
      };
  }
}

export default function MeetingCallPage() {
  const params = useParams<{ meetingId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const language = useLanguageStore((state) => state.language);
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const isPopupWindow = searchParams.get("popup") === "1";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<MeetingVideoTokenResponse | null>(null);
  const [meetingUrl, setMeetingUrl] = useState<string>("");
  const [patientInvite, setPatientInvite] = useState<MeetingPatientInviteResponse | null>(null);
  const [patientInviteError, setPatientInviteError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<"meeting" | "patient" | null>(null);
  const [showLinkDetails, setShowLinkDetails] = useState(false);
  const [showMetaPanel, setShowMetaPanel] = useState(false);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [callHealth, setCallHealth] = useState<CallHealthState>("healthy");
  const [callHealthDetail, setCallHealthDetail] = useState<string | null>(null);
  const [callEvents, setCallEvents] = useState<CallReliabilityEvent[]>([]);
  const [reliabilitySnapshot, setReliabilitySnapshot] =
    useState<MeetingReliabilitySnapshot | null>(null);
  const [selectedTestProfile, setSelectedTestProfile] =
    useState<MeetingCallTestProfile | null>(MEETING_CALL_TEST_PROFILES[0] ?? null);
  const [runStartedAt, setRunStartedAt] = useState<string | null>(null);
  const [runFinishedAt, setRunFinishedAt] = useState<string | null>(null);
  const [qaNotes, setQaNotes] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zegoInstanceRef = useRef<ZegoUIKitPrebuiltInstance | null>(null);
  const skipUnloadGuardRef = useRef(false);
  const callHealthRef = useRef<CallHealthState>("healthy");
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatFailureCountRef = useRef(0);
  const callEventIdRef = useRef(0);
  const lastSnapshotSignatureRef = useRef<string | null>(null);

  const meetingId = useMemo(() => {
    const raw = params?.meetingId;
    if (typeof raw !== "string") return "";
    return raw.trim();
  }, [params]);

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const appendCallEvent = useCallback(
    (message: string, tone: CallReliabilityEventTone = "info") => {
      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }
      setCallEvents((current) => {
        const nextEvent: CallReliabilityEvent = {
          id: callEventIdRef.current + 1,
          at: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          tone,
          message: trimmed,
        };
        callEventIdRef.current = nextEvent.id;
        const deduped =
          current[0]?.message === trimmed && current[0]?.tone === tone
            ? current
            : [nextEvent, ...current];
        return deduped.slice(0, 8);
      });
    },
    []
  );

  const updateCallHealth = useCallback((
    nextState: CallHealthState,
    detail?: string | null
  ) => {
    clearReconnectTimer();
    callHealthRef.current = nextState;
    setCallHealth(nextState);
    setCallHealthDetail(detail ?? null);
    appendCallEvent(
      detail ??
        tr(
          language,
          `Call health changed to ${nextState}.`,
          `สถานะคอลเปลี่ยนเป็น ${nextState}`
        ),
      nextState === "rejoin_required"
        ? "critical"
        : nextState === "healthy"
          ? "info"
          : "warning"
    );

    if (nextState === "reconnecting") {
      reconnectTimerRef.current = window.setTimeout(() => {
        updateCallHealth(
          "rejoin_required",
          tr(
            language,
            "The room has been reconnecting for too long. Rejoin to refresh audio/video and room presence.",
            "ระบบกำลังเชื่อมต่อห้องกลับมานานเกินไป กรุณาเข้าห้องใหม่เพื่อรีเฟรชเสียง ภาพ และสถานะห้อง"
          )
        );
      }, DOCTOR_RECONNECT_GRACE_MS);
    }
  }, [appendCallEvent, clearReconnectTimer, language]);

  useEffect(() => {
    if (isPopupWindow) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (skipUnloadGuardRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isPopupWindow]);

  useEffect(() => {
    const handleOffline = () => {
      updateCallHealth(
        "reconnecting",
        tr(
          language,
          "This browser went offline. Keep the room open while the call attempts to recover.",
          "เบราว์เซอร์ออฟไลน์อยู่ กรุณาเปิดห้องค้างไว้ระหว่างที่ระบบพยายามกู้การเชื่อมต่อ"
        )
      );
    };

    const handleOnline = () => {
      if (callHealthRef.current === "healthy") {
        return;
      }
      updateCallHealth(
        "degraded",
        tr(
          language,
          "Network signal returned. Checking media and room presence now.",
          "สัญญาณเครือข่ายกลับมาแล้ว กำลังตรวจสอบสื่อและสถานะห้องอีกครั้ง"
        )
      );
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearReconnectTimer();
    };
  }, [clearReconnectTimer, language, updateCallHealth]);

  const handleRetryJoin = useCallback(() => {
    if (loading) {
      return;
    }
    heartbeatFailureCountRef.current = 0;
    appendCallEvent(
      tr(
        language,
        "Doctor triggered a manual room refresh.",
        "แพทย์สั่งรีเฟรชห้องด้วยตนเอง"
      ),
      "warning"
    );
    setError(null);
    setCallNotice(null);
    setSession(null);
    updateCallHealth(
      "reconnecting",
      tr(
        language,
        "Refreshing the room now. Keep this page open while we rejoin.",
        "กำลังรีเฟรชห้อง กรุณาเปิดหน้านี้ค้างไว้ระหว่างที่ระบบเข้าห้องใหม่"
      )
    );
    zegoInstanceRef.current?.destroy?.();
    zegoInstanceRef.current = null;
    setRetryNonce((current) => current + 1);
  }, [appendCallEvent, language, loading, updateCallHealth]);

  const handleCopyDiagnostics = useCallback(async () => {
    const report = buildMeetingCallDiagnosticsReport({
      generatedAt: new Date().toISOString(),
      meetingId,
      selectedProfile: selectedTestProfile,
      runStartedAt,
      runFinishedAt,
      qaNotes,
      callHealth,
      callHealthDetail,
      callNotice,
      diagnosticsEvents: callEvents.map((event) => ({
        at: event.at,
        tone: event.tone,
        message: event.message,
      })),
      reliabilitySnapshot,
    });

    try {
      await navigator.clipboard.writeText(report);
      appendCallEvent(
        tr(
          language,
          "Copied diagnostics report to clipboard.",
          "คัดลอกรายงานวินิจฉัยลงคลิปบอร์ดแล้ว"
        )
      );
    } catch {
      appendCallEvent(
        tr(
          language,
          "Unable to copy diagnostics report right now.",
          "ยังไม่สามารถคัดลอกรายงานวินิจฉัยได้ในขณะนี้"
        ),
        "warning"
      );
    }
  }, [
    appendCallEvent,
    callEvents,
    callHealth,
    callHealthDetail,
    callNotice,
    language,
    meetingId,
    qaNotes,
    reliabilitySnapshot,
    runFinishedAt,
    runStartedAt,
    selectedTestProfile,
  ]);

  const handleStartTestRun = () => {
    const now = new Date().toISOString();
    setRunStartedAt(now);
    setRunFinishedAt(null);
    appendCallEvent(
      tr(
        language,
        "Started a QA test run from the control panel.",
        "เริ่มรอบทดสอบ QA จากแผงควบคุมแล้ว"
      )
    );
  };

  const handleFinishTestRun = () => {
    const now = new Date().toISOString();
    setRunFinishedAt(now);
    appendCallEvent(
      tr(
        language,
        "Finished the active QA test run.",
        "จบรอบทดสอบ QA ปัจจุบันแล้ว"
      )
    );
  };

  const openMiniWindowAndSwitch = () => {
    if (!meetingId) {
      return;
    }

    const popupUrl = `${window.location.origin}/meetings/call/${meetingId}?popup=1`;
    const width = 480;
    const height = 860;
    const left = Math.max(0, window.screenX + window.outerWidth - width - 80);
    const top = Math.max(24, window.screenY + 40);
    const popup = window.open(
      popupUrl,
      `telemed-call-${meetingId}`,
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
    );

    if (!popup) {
      setError(
        tr(
          language,
          "Mini window was blocked by browser. Please allow pop-ups for this site and try again.",
          "เบราว์เซอร์บล็อกหน้าต่างเล็ก กรุณาอนุญาต pop-up สำหรับเว็บนี้แล้วลองอีกครั้ง"
        )
      );
      return;
    }

    popup.focus();
    skipUnloadGuardRef.current = true;
    router.push("/meetings");
  };

  const handleBackToMeetings = () => {
    skipUnloadGuardRef.current = true;
    router.push("/meetings");
  };

  const handleClosePopupWindow = () => {
    skipUnloadGuardRef.current = true;
    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        router.push("/meetings");
      }
    }, 120);
  };

  useEffect(() => {
    patchSetSinkIdForMobileSafari();

    const originalError = console.error;
    const originalWarn = console.warn;
    const guardConsole = (
      original: (...args: unknown[]) => void,
      args: unknown[]
    ) => {
      const message = stringifyConsoleArgs(args);
      if (isExpectedZegoConsoleNoise(message)) {
        const notice = toDoctorCallNotice(language, message);
        setCallNotice(notice);
        if (callHealthRef.current === "healthy") {
          updateCallHealth("degraded", notice);
        }
        return;
      }
      original(...args);
    };

    console.error = (...args: unknown[]) => {
      guardConsole(originalError as (...args: unknown[]) => void, args);
    };
    console.warn = (...args: unknown[]) => {
      guardConsole(originalWarn as (...args: unknown[]) => void, args);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isExpectedMediaPermissionNoise(event.reason)) {
        const notice = toDoctorCallNotice(language, stringifyErrorReason(event.reason));
        setCallNotice(notice);
        if (callHealthRef.current === "healthy") {
          updateCallHealth("degraded", notice);
        }
        event.preventDefault();
      }
    };

    const handleWindowError = (event: ErrorEvent) => {
      if (isExpectedMediaPermissionNoise(event.error ?? event.message)) {
        const notice = toDoctorCallNotice(
          language,
          stringifyErrorReason(event.error ?? event.message)
        );
        setCallNotice(notice);
        if (callHealthRef.current === "healthy") {
          updateCallHealth("degraded", notice);
        }
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleWindowError);
    };
  }, [language, updateCallHealth]);

  const copyLink = async (kind: "meeting" | "patient", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLink(kind);
      window.setTimeout(() => {
        setCopiedLink((current) => (current === kind ? null : current));
      }, 1600);
    } catch {
      setError(
        tr(
          language,
          "Unable to copy link. Please copy manually.",
          "ไม่สามารถคัดลอกลิงก์ได้ กรุณาคัดลอกด้วยตนเอง"
        )
      );
    }
  };

  useEffect(() => {
    if (!meetingId) {
      setError(tr(language, "Invalid meeting id.", "meeting id ไม่ถูกต้อง"));
      updateCallHealth(
        "rejoin_required",
        tr(
          language,
          "The meeting identifier is missing or invalid. Open the room again from Meetings.",
          "ไม่พบ meeting id ที่ถูกต้อง กรุณาเปิดห้องใหม่จากหน้านัดหมาย"
        )
      );
      setLoading(false);
      return;
    }
    if (!token) {
      setError(tr(language, "Session expired. Please log in again.", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"));
      updateCallHealth(
        "rejoin_required",
        tr(
          language,
          "Doctor session expired. Sign in again before rejoining the room.",
          "เซสชันแพทย์หมดอายุ กรุณาเข้าสู่ระบบใหม่ก่อนเข้าห้องอีกครั้ง"
        )
      );
      setLoading(false);
      return;
    }
    if (role !== "doctor") {
      setError(tr(language, "Only doctor accounts can start calls.", "เฉพาะบัญชีแพทย์เท่านั้นที่เริ่มคอลได้"));
      updateCallHealth(
        "rejoin_required",
        tr(
          language,
          "Only doctor accounts can control this room.",
          "เฉพาะบัญชีแพทย์เท่านั้นที่ควบคุมห้องนี้ได้"
        )
      );
      setLoading(false);
      return;
    }

    let cancelled = false;
    let mountedInstance: ZegoUIKitPrebuiltInstance | null = null;

    const run = async () => {
      setLoading(true);
      setError(null);
      setCallNotice(null);
      setPatientInvite(null);
      setPatientInviteError(null);
      if (retryNonce === 0) {
        setCallEvents([]);
      }
      heartbeatFailureCountRef.current = 0;
      updateCallHealth(
        retryNonce > 0 ? "reconnecting" : "healthy",
        retryNonce > 0
          ? tr(
              language,
              "Refreshing the room and requesting a fresh media session.",
              "กำลังรีเฟรชห้องและขอ media session ใหม่"
            )
          : null
      );
      try {
        if (!window.isSecureContext && window.location.hostname !== "localhost") {
          throw new Error(
            tr(
              language,
              "Camera/microphone access requires HTTPS on this domain. Open this page through HTTPS.",
              "การเข้าถึงกล้อง/ไมค์บนโดเมนนี้ต้องใช้ HTTPS กรุณาเปิดหน้านี้ผ่าน HTTPS"
            )
          );
        }

        const mediaPreference = await warmupDoctorMediaDevices(language);
        if (cancelled) return;
        if (mediaPreference.hint) {
          setCallNotice(mediaPreference.hint);
          updateCallHealth("degraded", mediaPreference.hint);
        } else if (navigator.onLine) {
          updateCallHealth("healthy");
        }

        const videoSession = await issueMeetingVideoToken(meetingId, token);
        if (cancelled) return;

        if (videoSession.provider !== "zego") {
          throw new Error("Meeting video provider is not ZEGO.");
        }
        if (!videoSession.app_id) {
          throw new Error("Missing ZEGO AppID from video session response.");
        }

        setSession(videoSession);
        appendCallEvent(
          tr(
            language,
            "Doctor media token issued successfully.",
            "ออก media token สำหรับแพทย์สำเร็จ"
          )
        );
        const meetingLink = `${window.location.origin}/meetings/call/${meetingId}`;
        setMeetingUrl(meetingLink);
        try {
          const invite = await createMeetingPatientInvite(meetingId, token);
          if (!cancelled) {
            setPatientInvite(invite);
            appendCallEvent(
              tr(
                language,
                "Patient invite link is ready.",
                "ลิงก์เชิญคนไข้พร้อมใช้งานแล้ว"
              )
            );
          }
        } catch {
          if (!cancelled) {
            const inviteMessage = tr(
              language,
              "Unable to generate patient invite URL right now.",
              "ยังไม่สามารถสร้างลิงก์เชิญคนไข้ได้ในขณะนี้"
            );
            setPatientInviteError(
              inviteMessage
            );
            appendCallEvent(inviteMessage, "warning");
          }
        }

        const zego = await loadZegoUIKitPrebuilt();
        if (cancelled) return;
        if (!containerRef.current) {
          throw new Error("Call container is not ready.");
        }

        const displayName = role === "doctor" ? "Doctor" : "User";
        const kitToken = zego.generateKitTokenForProduction(
          videoSession.app_id,
          videoSession.token,
          videoSession.room_id,
          videoSession.user_id,
          displayName
        );
        mountedInstance = zego.create(kitToken);
        zegoInstanceRef.current = mountedInstance;
        mountedInstance.joinRoom({
          container: containerRef.current,
          // Keep pre-join so browser/device permission can be handled explicitly.
          showPreJoinView: true,
          turnOnCameraWhenJoining: mediaPreference.allowCamera,
          turnOnMicrophoneWhenJoining: mediaPreference.allowMicrophone,
          sharedLinks: [
            {
              name: "Meeting Link",
              url: meetingLink,
            },
          ],
          scenario: {
            mode: zego.VideoConference,
          },
        });
        appendCallEvent(
          tr(
            language,
            "Doctor joined the room UI and is waiting for media to stabilize.",
            "แพทย์เข้าหน้าห้องแล้วและกำลังรอให้สื่อเสถียร"
          )
        );
        if (!mediaPreference.hint) {
          updateCallHealth("healthy");
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : tr(language, "Unable to start call.", "ไม่สามารถเริ่มการคอลได้");
        setError(message);
        updateCallHealth("rejoin_required", message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (mountedInstance?.destroy) {
        mountedInstance.destroy();
      } else if (zegoInstanceRef.current?.destroy) {
        zegoInstanceRef.current.destroy();
      }
      zegoInstanceRef.current = null;
    };
  }, [
    appendCallEvent,
    meetingId,
    token,
    role,
    language,
    retryNonce,
    updateCallHealth,
  ]);

  useEffect(() => {
    if (!session || !token || !meetingId || role !== "doctor") {
      return;
    }

    let disposed = false;

    const sendHeartbeat = () => {
      if (disposed) return;
      void heartbeatDoctorMeetingPresence(meetingId, token)
        .then(() => {
          if (disposed) return;
          if (heartbeatFailureCountRef.current > 0) {
            heartbeatFailureCountRef.current = 0;
            if (callNotice) {
              updateCallHealth("degraded", callNotice);
              return;
            }
            updateCallHealth("healthy");
          }
        })
        .catch(() => {
          if (disposed) return;
          heartbeatFailureCountRef.current += 1;
          if (
            heartbeatFailureCountRef.current >=
            DOCTOR_HEARTBEAT_REJOIN_THRESHOLD
          ) {
            updateCallHealth(
              "rejoin_required",
              tr(
                language,
                "Room presence has not recovered for several heartbeat cycles. Rejoin the call to resync doctor presence.",
                "สถานะห้องไม่กลับมาหลายรอบติดต่อกัน กรุณาเข้าห้องใหม่เพื่อซิงก์สถานะของแพทย์"
              )
            );
            return;
          }
          if (
            heartbeatFailureCountRef.current >=
            DOCTOR_HEARTBEAT_RECONNECT_THRESHOLD
          ) {
            updateCallHealth(
              "reconnecting",
              tr(
                language,
                "Room presence heartbeat is failing. Keeping the room open while we try to recover.",
                "heartbeat ของสถานะห้องล้มเหลว กรุณาเปิดห้องค้างไว้ระหว่างที่ระบบพยายามกู้คืน"
              )
            );
            return;
          }
          updateCallHealth(
            "degraded",
            tr(
              language,
              "Call control channel is unstable. Audio/video may still work while presence catches up.",
              "ช่องสัญญาณควบคุมคอลเริ่มไม่เสถียร แม้เสียงหรือภาพอาจยังทำงานอยู่ระหว่างที่สถานะห้องกำลังตามกลับมา"
            )
          );
        });
    };

    const sendLeave = () => {
      if (disposed) return;
      void leaveDoctorMeetingPresence(meetingId, token).catch(() => {
        // Best-effort leave marker.
      });
    };

    sendHeartbeat();
    const interval = window.setInterval(
      sendHeartbeat,
      DOCTOR_PRESENCE_HEARTBEAT_INTERVAL_MS
    );

    window.addEventListener("pagehide", sendLeave);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", sendLeave);
      sendLeave();
      disposed = true;
    };
  }, [session, token, meetingId, role, language, callNotice, updateCallHealth]);

  useEffect(() => {
    if (!session || !token || !meetingId || role !== "doctor") {
      setReliabilitySnapshot(null);
      lastSnapshotSignatureRef.current = null;
      return;
    }

    let disposed = false;

    const refreshSnapshot = () => {
      if (disposed) return;
      void fetchMeetingReliabilitySnapshot(meetingId, token)
        .then((snapshot) => {
          if (disposed) return;
          setReliabilitySnapshot(snapshot);
          const nextSignature = [
            snapshot.meeting_status,
            snapshot.active_status_projection,
            snapshot.room_presence_state,
            snapshot.doctor_online ? "doctor:on" : "doctor:off",
            snapshot.patient_online ? "patient:on" : "patient:off",
            snapshot.meeting_status_reconciled ? "reconciled" : "steady",
          ].join("|");
          if (lastSnapshotSignatureRef.current !== nextSignature) {
            lastSnapshotSignatureRef.current = nextSignature;
            appendCallEvent(
              tr(
                language,
                `Backend snapshot: ${snapshot.meeting_status} / ${snapshot.room_presence_state}.`,
                `Backend snapshot: ${snapshot.meeting_status} / ${snapshot.room_presence_state}`
              ),
              snapshot.meeting_status_reconciled ? "warning" : "info"
            );
          }
        })
        .catch(() => {
          if (disposed) return;
          appendCallEvent(
            tr(
              language,
              "Unable to refresh backend reliability snapshot right now.",
              "ยังรีเฟรช reliability snapshot จาก backend ไม่ได้ในขณะนี้"
            ),
            "warning"
          );
        });
    };

    refreshSnapshot();
    const interval = window.setInterval(
      refreshSnapshot,
      DOCTOR_PRESENCE_HEARTBEAT_INTERVAL_MS
    );

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [appendCallEvent, language, meetingId, role, session, token]);

  const hasLinkPanel = !isPopupWindow && Boolean(meetingUrl || patientInvite?.invite_url);
  const callHealthAppearance = getCallHealthAppearance(
    language,
    callHealth,
    callHealthDetail ?? callNotice
  );
  const eventToneClassName: Record<CallReliabilityEventTone, string> = {
    info: "border-emerald-300/20 bg-emerald-500/10 text-emerald-100",
    warning: "border-amber-300/20 bg-amber-500/10 text-amber-100",
    critical: "border-red-300/20 bg-red-500/10 text-red-100",
  };
  const hasMetaAlerts = Boolean(
    patientInviteError || callNotice || error || callHealth !== "healthy"
  );
  const hasMetaContent = true;
  const isRunActive = Boolean(runStartedAt && !runFinishedAt);
  const notesCount = qaNotes.trim().length;
  const roomSummary = session
    ? `${tr(language, "Room", "ห้อง")}: ${session.room_id}`
    : tr(language, "Preparing your call room...", "กำลังเตรียมห้องวิดีโอ...");
  const modeSummary = isPopupWindow
    ? tr(
        language,
        "Mini window mode",
        "โหมดหน้าต่างเล็ก"
      )
    : tr(
        language,
        "Main dashboard mode",
        "โหมดหน้าหลัก"
      );

  return (
    <>
      <main className="flex h-full w-full flex-col p-2 md:p-3">
        <div
          className={cn(
            "relative flex-1 overflow-hidden rounded-2xl border border-border bg-black",
            isPopupWindow ? "min-h-[86vh]" : "min-h-[80vh]"
          )}
        >
          <div ref={containerRef} className="h-full w-full" />

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/35" />

          <div className="absolute left-3 right-3 top-3 z-30 flex items-start justify-between gap-2">
            <div className="pointer-events-auto max-w-[65%] rounded-xl border border-white/20 bg-black/45 px-3 py-2 text-white backdrop-blur-md">
              <p className="truncate text-sm font-semibold">
                {tr(language, "Doctor Video Call", "ห้องวิดีโอแพทย์")}
              </p>
              <p className="truncate text-[11px] text-white/80">{roomSummary}</p>
              <div className="mt-1 inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/90">
                {modeSummary}
              </div>
            </div>

            <div className="pointer-events-auto flex flex-col gap-2 sm:flex-row sm:items-center">
              {!isPopupWindow ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 border-white/25 bg-white/95 px-2.5 text-xs text-slate-900 shadow-sm hover:bg-white focus-visible:ring-white/60"
                  onClick={openMiniWindowAndSwitch}
                >
                  {tr(language, "Mini Window", "เปิดหน้าต่างเล็ก")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-white/35 bg-white/10 px-2.5 text-xs text-white shadow-sm backdrop-blur-sm hover:bg-white/20 focus-visible:ring-white/60"
                onClick={isPopupWindow ? handleClosePopupWindow : handleBackToMeetings}
              >
                {isPopupWindow
                  ? tr(language, "Close Mini", "ปิดหน้าต่างเล็ก")
                  : tr(language, "Back", "กลับหน้านัดหมาย")}
              </Button>
              {hasMetaContent ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-white/35 bg-white/10 px-2.5 text-xs text-white shadow-sm backdrop-blur-sm hover:bg-white/20 focus-visible:ring-white/60"
                  onClick={() => {
                    setShowMetaPanel((prev) => !prev);
                  }}
                >
                  {showMetaPanel
                    ? tr(language, "Close Panel", "ปิดแผงควบคุม")
                    : tr(language, "Control Panel", "แผงควบคุม")}
                </Button>
              ) : null}
            </div>
          </div>

          {callHealth !== "healthy" ? (
            <section className="absolute left-3 right-3 top-24 z-30 pointer-events-auto md:right-[calc(420px+1.5rem)]">
              <div
                className={cn(
                  "rounded-2xl border px-4 py-3 text-white shadow-xl backdrop-blur-md",
                  callHealthAppearance.tone === "red"
                    ? "border-red-300/35 bg-red-500/20"
                    : "border-amber-300/35 bg-amber-500/20"
                )}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="inline-flex items-center rounded-full border border-white/20 bg-black/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/80">
                      {callHealthAppearance.badge}
                    </div>
                    <p className="text-sm font-semibold">
                      {callHealthAppearance.title}
                    </p>
                    <p className="text-xs text-white/85">
                      {callHealthAppearance.detail}
                    </p>
                  </div>
                  {callHealthAppearance.ctaLabel ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 bg-white/95 px-3 text-xs text-slate-950 hover:bg-white"
                      onClick={handleRetryJoin}
                    >
                      {callHealthAppearance.ctaLabel}
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {hasMetaAlerts ? (
            <button
              type="button"
              className="absolute bottom-3 left-3 z-30 inline-flex items-center rounded-full border border-amber-300/40 bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-100 backdrop-blur-sm transition hover:bg-amber-500/30"
              onClick={() => {
                setShowMetaPanel(true);
              }}
            >
              {tr(language, "New call notice", "มีการแจ้งเตือนคอล")}
            </button>
          ) : null}

          {showMetaPanel ? (
            <button
              type="button"
              aria-label={tr(language, "Close panel", "ปิดแผง")}
              className="absolute inset-0 z-30 bg-transparent"
              onClick={() => {
                setShowMetaPanel(false);
              }}
            />
          ) : null}

          <section
            className={cn(
              "absolute right-3 top-14 z-40 w-[min(92vw,420px)] origin-top-right overflow-hidden rounded-2xl border border-white/20 bg-slate-950/75 text-white shadow-2xl backdrop-blur-xl transition duration-200",
              showMetaPanel
                ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                : "pointer-events-none -translate-y-2 scale-95 opacity-0"
            )}
          >
            <div className="flex items-center justify-between border-b border-white/15 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">
                  {tr(language, "Call Control Panel", "แผงควบคุมการคอล")}
                </h2>
                <p className="text-[11px] text-white/70">
                  {tr(
                    language,
                    "Links and call notices in one place.",
                    "รวมลิงก์และการแจ้งเตือนไว้ในที่เดียว"
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-white/35 bg-white/10 px-2 text-[11px] text-white hover:bg-white/20"
                onClick={() => {
                  setShowMetaPanel(false);
                }}
              >
                {tr(language, "Close", "ปิด")}
              </Button>
            </div>

            <div className="max-h-[56vh] space-y-3 overflow-y-auto px-4 py-3">
              {callHealth !== "healthy" ? (
                <div
                  className={cn(
                    "rounded-xl px-3 py-3 text-xs",
                    callHealthAppearance.tone === "red"
                      ? "border border-red-300/30 bg-red-500/20 text-red-100"
                      : "border border-amber-300/30 bg-amber-500/20 text-amber-100"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
                        {callHealthAppearance.badge}
                      </p>
                      <p className="text-sm font-semibold text-white">
                        {callHealthAppearance.title}
                      </p>
                      <p>{callHealthAppearance.detail}</p>
                    </div>
                    {callHealthAppearance.ctaLabel ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-white/30 bg-white/10 px-2 text-[11px] text-white hover:bg-white/20"
                        onClick={handleRetryJoin}
                      >
                        {callHealthAppearance.ctaLabel}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 text-xs text-white/85">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">
                      {tr(language, "Test Profiles", "โปรไฟล์ทดสอบ")}
                    </p>
                    <p className="text-[11px] text-white/60">
                      {tr(
                        language,
                        "Pick a repeatable scenario before simulating poor network.",
                        "เลือก scenario ที่ต้องการก่อนจำลองเน็ตแย่เพื่อให้รันซ้ำได้"
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      isRunActive
                        ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                        : runFinishedAt
                          ? "border-sky-300/30 bg-sky-500/15 text-sky-100"
                          : "border-white/15 bg-white/10 text-white/70"
                    )}
                  >
                    {isRunActive
                      ? tr(language, "Run active", "กำลังทดสอบ")
                      : runFinishedAt
                        ? tr(language, "Run captured", "บันทึกรอบแล้ว")
                        : tr(language, "Idle", "ยังไม่เริ่ม")}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-white/30 bg-white/10 px-2 text-[11px] text-white hover:bg-white/20"
                      onClick={handleStartTestRun}
                    >
                      {tr(language, "Start run", "เริ่มรอบทดสอบ")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-white/30 bg-white/10 px-2 text-[11px] text-white hover:bg-white/20"
                      onClick={handleFinishTestRun}
                    >
                      {tr(language, "Finish run", "จบรอบทดสอบ")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-white/30 bg-white/10 px-2 text-[11px] text-white hover:bg-white/20"
                      onClick={() => {
                        void handleCopyDiagnostics();
                      }}
                    >
                      {tr(language, "Copy report", "คัดลอกรายงาน")}
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                    <p className="text-white/55">
                      {tr(language, "Run started", "เริ่มรอบ")}
                    </p>
                    <p className="mt-1 font-medium text-white">
                      {runStartedAt
                        ? formatPanelDateTime(language, runStartedAt)
                        : tr(language, "Not started", "ยังไม่เริ่ม")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                    <p className="text-white/55">
                      {tr(language, "Run finished", "จบรอบ")}
                    </p>
                    <p className="mt-1 font-medium text-white">
                      {runFinishedAt
                        ? formatPanelDateTime(language, runFinishedAt)
                        : tr(language, "Not finished", "ยังไม่จบ")}
                    </p>
                  </div>
                </div>

                {selectedTestProfile ? (
                  <div className="mt-3 rounded-xl border border-sky-300/20 bg-sky-500/10 px-3 py-3 text-[11px] text-sky-50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">
                          {tr(language, "Selected Scenario", "สถานการณ์ที่เลือก")}
                        </p>
                        <p className="mt-1 text-sm font-medium text-white">
                          {selectedTestProfile.title}
                        </p>
                      </div>
                      <span className="rounded-full border border-sky-300/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-100">
                        {tr(language, "Expected", "คาดหวัง")}
                      </span>
                    </div>
                    <p className="mt-2 text-sky-100/80">
                      {selectedTestProfile.expectedResult}
                    </p>
                  </div>
                ) : null}

                <div className="mt-3 space-y-2">
                  {MEETING_CALL_TEST_PROFILES.map((profile) => {
                    const isSelected = selectedTestProfile?.id === profile.id;
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        className={cn(
                          "w-full rounded-xl border px-3 py-3 text-left transition",
                          isSelected
                            ? "border-white/30 bg-white/12 text-white"
                            : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                        )}
                        onClick={() => {
                          setSelectedTestProfile(profile);
                          appendCallEvent(
                            tr(
                              language,
                              `Selected test profile: ${profile.title}.`,
                              `เลือกโปรไฟล์ทดสอบ: ${profile.title}`
                            )
                          );
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{profile.title}</p>
                            <p className="text-[11px] text-white/60">
                              {profile.networkCondition}
                            </p>
                            <p className="text-[11px] text-white/75">
                              {profile.focus}
                            </p>
                          </div>
                          {isSelected ? (
                            <span className="rounded-full border border-emerald-300/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-100">
                              {tr(language, "Active", "ใช้งานอยู่")}
                            </span>
                          ) : null}
                        </div>
                        {isSelected ? (
                          <p className="mt-2 text-[11px] text-white/85">
                            {profile.expectedResult}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="block text-[11px] font-medium text-white/80">
                      {tr(language, "QA notes", "บันทึก QA")}
                    </label>
                    <span className="text-[10px] text-white/40">
                      {tr(language, `${notesCount} chars`, `${notesCount} ตัวอักษร`)}
                    </span>
                  </div>
                  <textarea
                    className="mt-2 min-h-24 w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[11px] text-white outline-none placeholder:text-white/35"
                    placeholder={tr(
                      language,
                      "Write what you observed during this run.",
                      "จดสิ่งที่สังเกตเห็นระหว่างรอบทดสอบนี้"
                    )}
                    value={qaNotes}
                    onChange={(event) => {
                      setQaNotes(event.target.value);
                    }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 text-xs text-white/80">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-white">
                      {tr(language, "Backend Reliability", "สถานะจาก Backend")}
                    </p>
                    <p className="text-[11px] text-white/60">
                      {tr(
                        language,
                        "How the API currently derives presence and meeting status.",
                        "มุมมองของ API ต่อ presence และสถานะนัดหมาย ณ ตอนนี้"
                      )}
                    </p>
                  </div>
                </div>

                {reliabilitySnapshot ? (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                        <p className="text-white/55">
                          {tr(language, "Meeting status", "สถานะนัดหมาย")}
                        </p>
                        <p className="mt-1 font-medium text-white">
                          {reliabilitySnapshot.meeting_status}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                        <p className="text-white/55">
                          {tr(language, "Projected active state", "สถานะ active ที่คาด")}
                        </p>
                        <p className="mt-1 font-medium text-white">
                          {reliabilitySnapshot.active_status_projection}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                        <p className="text-white/55">
                          {tr(language, "Room presence", "สถานะในห้อง")}
                        </p>
                        <p className="mt-1 font-medium text-white">
                          {reliabilitySnapshot.room_presence_state}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                        <p className="text-white/55">
                          {tr(language, "Heartbeat timeout", "หมดเวลา heartbeat")}
                        </p>
                        <p className="mt-1 font-medium text-white">
                          {reliabilitySnapshot.heartbeat_timeout_seconds}s
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                        <p className="text-white/55">
                          {tr(language, "Doctor last seen", "หมอพบล่าสุด")}
                        </p>
                        <p className="mt-1 font-medium text-white">
                          {formatAgeLabel(
                            language,
                            reliabilitySnapshot.doctor_last_seen_age_seconds
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                        <p className="text-white/55">
                          {tr(language, "Patient last seen", "คนไข้พบล่าสุด")}
                        </p>
                        <p className="mt-1 font-medium text-white">
                          {formatAgeLabel(
                            language,
                            reliabilitySnapshot.patient_last_seen_age_seconds
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-white/80">
                      <p className="font-medium text-white">
                        {tr(language, "Sync check", "การตรวจ sync")}
                      </p>
                      <p className="mt-1">
                        {reliabilitySnapshot.meeting_status_reconciled
                          ? tr(
                              language,
                              `Backend reconciled ${reliabilitySnapshot.meeting_status_before_reconcile} -> ${reliabilitySnapshot.meeting_status}.`,
                              `Backend ปรับสถานะจาก ${reliabilitySnapshot.meeting_status_before_reconcile} -> ${reliabilitySnapshot.meeting_status}`
                            )
                          : reliabilitySnapshot.status_in_sync === false
                            ? tr(
                                language,
                                "Meeting status still differs from the active projection.",
                                "สถานะนัดหมายยังต่างจาก active projection"
                              )
                            : tr(
                                language,
                                "Meeting status and active projection are aligned.",
                                "สถานะนัดหมายและ active projection ตรงกัน"
                              )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-white/60">
                    {tr(
                      language,
                      "Waiting for backend reliability snapshot.",
                      "กำลังรอ reliability snapshot จาก backend"
                    )}
                  </div>
                )}
              </div>

              {hasLinkPanel ? (
                <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 text-xs text-white/85">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{tr(language, "Share Links", "ลิงก์สำหรับแชร์")}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {meetingUrl ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-white/30 bg-white/10 px-2 text-[11px] text-white hover:bg-white/20"
                          onClick={() => {
                            void copyLink("meeting", meetingUrl);
                          }}
                        >
                          {copiedLink === "meeting"
                            ? tr(language, "Meeting copied", "คัดลอกลิงก์หมอแล้ว")
                            : tr(language, "Copy doctor link", "คัดลอกลิงก์หมอ")}
                        </Button>
                      ) : null}
                      {patientInvite?.invite_url ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-white/30 bg-white/10 px-2 text-[11px] text-white hover:bg-white/20"
                          onClick={() => {
                            void copyLink("patient", patientInvite.invite_url);
                          }}
                        >
                          {copiedLink === "patient"
                            ? tr(language, "Patient copied", "คัดลอกลิงก์คนไข้แล้ว")
                            : tr(language, "Copy patient link", "คัดลอกลิงก์คนไข้")}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 bg-white/5 px-2 text-[11px] text-white hover:bg-white/15"
                        onClick={() => {
                          setShowLinkDetails((prev) => !prev);
                        }}
                      >
                        {showLinkDetails
                          ? tr(language, "Hide links", "ซ่อนลิงก์")
                          : tr(language, "Show links", "แสดงลิงก์")}
                      </Button>
                    </div>
                  </div>

                  {showLinkDetails ? (
                    <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed text-white/75">
                      {meetingUrl ? (
                        <div title={meetingUrl}>
                          <span className="font-sans text-white/60">
                            {tr(language, "Doctor:", "หมอ:")}{" "}
                          </span>
                          {shortenUrl(meetingUrl, 108)}
                        </div>
                      ) : null}
                      {patientInvite?.invite_url ? (
                        <div title={patientInvite.invite_url}>
                          <span className="font-sans text-white/60">
                            {tr(language, "Patient:", "คนไข้:")}{" "}
                          </span>
                          {shortenUrl(patientInvite.invite_url, 108)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!isPopupWindow && patientInviteError ? (
                <div className="rounded-xl border border-amber-300/30 bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
                  {patientInviteError}
                </div>
              ) : null}

              {callNotice ? (
                <div className="rounded-xl border border-amber-300/30 bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
                  {callNotice}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-red-300/30 bg-red-500/20 p-3 text-sm text-red-100">
                  {error}
                </div>
              ) : null}

              <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 text-xs text-white/80">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-white">
                      {tr(language, "Call Activity", "กิจกรรมการคอล")}
                    </p>
                    <p className="text-[11px] text-white/60">
                      {tr(
                        language,
                        "Recent media, network, and presence events.",
                        "เหตุการณ์ล่าสุดของสื่อ เครือข่าย และสถานะห้อง"
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {callEvents.length > 0 ? (
                    callEvents.map((event) => (
                      <div
                        key={event.id}
                        className={cn(
                          "rounded-lg border px-2.5 py-2",
                          eventToneClassName[event.tone]
                        )}
                      >
                        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em] text-white/60">
                          <span>
                            {event.tone === "critical"
                              ? tr(language, "Critical", "วิกฤต")
                              : event.tone === "warning"
                                ? tr(language, "Warning", "เตือน")
                                : tr(language, "Info", "ข้อมูล")}
                          </span>
                          <span>{event.at}</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-white/90">
                          {event.message}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-white/60">
                      {tr(
                        language,
                        "No call activity yet.",
                        "ยังไม่มีกิจกรรมการคอล"
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </section>

          {loading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-white/85">
              {tr(language, "Starting video room...", "กำลังเริ่มห้องวิดีโอ...")}
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
