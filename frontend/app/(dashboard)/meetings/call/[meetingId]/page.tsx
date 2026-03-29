"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  createMeetingPatientInvite,
  heartbeatDoctorMeetingPresence,
  issueMeetingVideoToken,
  leaveDoctorMeetingPresence,
  type MeetingVideoTokenResponse,
} from "@/lib/api";
import {
  loadZegoUIKitPrebuilt,
  getCallNetworkProfile,
  getDefaultZegoVideoResolution,
  preloadZegoUIKitPrebuilt,
  withTimeout,
  withRetry,
  CallStartupMetrics,
  getAdaptiveMediaConstraints,
  getMediaReleaseDelay,
  API_TIMEOUT_MS,
  type ZegoUIKitPrebuiltInstance,
} from "@/lib/zego-uikit";
import { generateSecureId } from "@/lib/secure-random";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const MeetingCallChrome = dynamic(
  () =>
    import("@/components/dashboard/meeting-call-chrome").then(
      (mod) => mod.MeetingCallChrome
    ),
  {
    loading: () => (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-slate-950/28 p-5">
        <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-slate-950/72 p-5 shadow-[0_24px_72px_rgba(2,6,23,0.38)] backdrop-blur-xl" />
      </div>
    ),
  }
);

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
    normalized.includes("publishstream failed") ||
    normalized.includes("【zegocloud】") ||
    normalized.includes("[zegocloudrtccore]") ||
    normalized.includes("createspan") ||
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
    normalized.includes("notfounderror") ||
    normalized.includes("overconstrainederror") ||
    normalized.includes("requested device not found") ||
    normalized.includes("get media fail") ||
    normalized.includes("createstream or publishlocalstream failed") ||
    normalized.includes("publishstream failed") ||
    normalized.includes("setsinkid") ||
    normalized.includes("createspan") ||
    normalized.includes("zego")
  );
}

type DoctorMediaWarmupPreference = {
  allowCamera: boolean;
  allowMicrophone: boolean;
  hint: string | null;
};

function warmupDoctorMediaDevices(
  language: AppLanguage,
  networkProfile: "slow" | "standard" = "standard"
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

  const constraints = getAdaptiveMediaConstraints(networkProfile);
  const releaseDelay = getMediaReleaseDelay();

  return navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      // Give iOS Safari time to fully release the hardware lock to prevent black frames
      return new Promise<void>((r) => setTimeout(r, releaseDelay)).then(() => ({
        allowCamera: true,
        allowMicrophone: true,
        hint: null,
      }));
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

// Use a window flag instead of a module variable so the guard survives HMR
// module re-evaluation cycles and prevents setSinkId from being double-wrapped.
declare global {
  interface Window {
    __setSinkIdPatched?: boolean;
  }
}

function patchSetSinkIdForMobileSafari(): void {
  if (typeof window === "undefined" || window.__setSinkIdPatched) {
    return;
  }

  const mediaPrototype = window.HTMLMediaElement?.prototype as
    | (HTMLMediaElement & { setSinkId?: (sinkId: string) => Promise<void> })
    | undefined;
  if (!mediaPrototype || typeof mediaPrototype.setSinkId !== "function") {
    window.__setSinkIdPatched = true;
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

  window.__setSinkIdPatched = true;
}

function formatAppointmentTime(language: AppLanguage, isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(language === "th" ? "th-TH" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCallDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const DOCTOR_PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;
const MEETING_VIDEO_CODEC = "H264" as const;
const MINI_WINDOW_MESSAGE_SOURCE = "telemed-mini-window";
const CALL_LOADING_SLOW_THRESHOLD_MS = 8_000;
const STAGE_TIMEOUT_MS = 15_000;
const OVERALL_TIMEOUT_MS = 45_000;

type MiniWindowMessageType =
  | "popup-mounted"
  | "popup-active"
  | "popup-failed"
  | "popup-closing"
  | "popup-ended";
type HandoffState =
  | "idle"
  | "popup-opening"
  | "popup-joining"
  | "popup-active"
  | "resuming";
type CallLoadingStep =
  | "checking-media"
  | "connecting-room"
  | "loading-video"
  | "entering-room";

export default function MeetingCallPage() {
  const params = useParams<{ meetingId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const language = useLanguageStore((state) => state.language);
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const isPopupWindow = searchParams.get("popup") === "1";
  const resumeFromMiniWindow = searchParams.get("resume") === "1";
  const endedFromSearch = searchParams.get("ended") === "1";
  const patientName = searchParams.get("pn") ?? "";
  const patientTime = searchParams.get("pt") ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<MeetingVideoTokenResponse | null>(null);
  const [patientInviteUrl, setPatientInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [handoffState, setHandoffState] = useState<HandoffState>("idle");
  const [callEnded, setCallEnded] = useState(endedFromSearch);
  const [loadingStep, setLoadingStep] = useState<CallLoadingStep>("checking-media");
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const [stageStuck, setStageStuck] = useState(false);
  const [overallTimedOut, setOverallTimedOut] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zegoInstanceRef = useRef<ZegoUIKitPrebuiltInstance | null>(null);
  const hasLeftRoomRef = useRef(false);
  const skipUnloadGuardRef = useRef(false);
  const suppressLeaveRoomNavigationRef = useRef(false);
  const callTimerRef = useRef<number | null>(null);
  const popupWindowRef = useRef<Window | null>(null);
  const resumeOnNextJoinRef = useRef(resumeFromMiniWindow);
  const activeHandoffIdRef = useRef<string | null>(null);
  const skipDoctorPresenceLeaveRef = useRef(false);
  const popupActivationAnnouncedRef = useRef(false);

  const meetingId = useMemo(() => {
    const raw = params?.meetingId;
    if (typeof raw !== "string") return "";
    return raw.trim();
  }, [params]);
  const networkProfile = useMemo(() => getCallNetworkProfile(), []);
  const isSlowNetwork = networkProfile === "slow";
  const handoffIdFromSearch = (searchParams.get("handoff") || "").trim();
  const isMainWindowParked = !isPopupWindow && handoffState === "popup-active";
  const isMiniWindowPending =
    handoffState === "popup-opening" || handoffState === "popup-joining";

  const buildCallUrl = useCallback(
    (options?: { ended?: boolean }) => {
      const nextParams = new URLSearchParams();
      if (patientName) nextParams.set("pn", patientName);
      if (patientTime) nextParams.set("pt", patientTime);
      if (options?.ended) nextParams.set("ended", "1");
      const qs = nextParams.toString();
      return `/meetings/call/${meetingId}${qs ? `?${qs}` : ""}`;
    },
    [meetingId, patientName, patientTime]
  );

  const postMiniWindowMessage = useCallback(
    (type: MiniWindowMessageType) => {
      if (!isPopupWindow || !window.opener || window.opener.closed) {
        return;
      }
      try {
        (window.opener as Window).postMessage(
          {
            source: MINI_WINDOW_MESSAGE_SOURCE,
            meetingId,
            type,
            handoffId: handoffIdFromSearch || undefined,
          },
          window.location.origin
        );
      } catch {
        // ignore messaging failures
      }
    },
    [handoffIdFromSearch, isPopupWindow, meetingId]
  );

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  useEffect(() => {
    preloadZegoUIKitPrebuilt();
  }, []);

  useEffect(() => {
    if (!loading) {
      setIsSlowLoading(false);
      setStageStuck(false);
      setOverallTimedOut(false);
      return;
    }

    setIsSlowLoading(false);
    setStageStuck(false);
    setOverallTimedOut(false);
    const slowTimer = window.setTimeout(() => {
      setIsSlowLoading(true);
    }, CALL_LOADING_SLOW_THRESHOLD_MS);
    const overallTimer = window.setTimeout(() => {
      setOverallTimedOut(true);
    }, OVERALL_TIMEOUT_MS);

    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(overallTimer);
    };
  }, [loading, retryNonce]);

  // Per-stage stuck detector — resets when loadingStep changes
  useEffect(() => {
    if (!loading) return;
    setStageStuck(false);
    const timer = window.setTimeout(() => {
      setStageStuck(true);
    }, STAGE_TIMEOUT_MS);
    return () => { window.clearTimeout(timer); };
  }, [loading, loadingStep]);

  useEffect(() => {
    if (isPopupWindow || (!resumeFromMiniWindow && !endedFromSearch)) {
      return;
    }

    window.history.replaceState(window.history.state, "", buildCallUrl());
  }, [buildCallUrl, endedFromSearch, isPopupWindow, resumeFromMiniWindow]);

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

  const handleRetryJoin = useCallback(() => {
    if (loading) {
      return;
    }
    setCallEnded(false);
    window.history.replaceState(window.history.state, "", buildCallUrl());
    skipDoctorPresenceLeaveRef.current = false;
    setHandoffState("idle");
    // Set loading immediately so rapid clicks hit the guard above
    // before the run() effect picks up the new retryNonce.
    setLoading(true);
    setError(null);
    setSession(null);
    // Do NOT call destroy() here — the run() effect cleanup destroys the
    // instance and clears the container atomically before the new run() fires.
    // Calling destroy() here first creates a race where ZEGO asynchronously
    // renders its "You have left the room" UI after we clear innerHTML.
    zegoInstanceRef.current = null;
    setRetryNonce((current) => current + 1);
  }, [buildCallUrl, loading]);

  const requestResumeFromMiniWindow = useCallback(() => {
    if (!popupWindowRef.current && handoffState === "idle") {
      return;
    }
    popupWindowRef.current = null;
    skipUnloadGuardRef.current = false;
    resumeOnNextJoinRef.current = true;
    skipDoctorPresenceLeaveRef.current = false;
    setHandoffState("resuming");
    setCallEnded(false);
    setLoading(true);
    setError(null);
    setRetryNonce((current) => current + 1);
  }, [handoffState]);

  const handleLeaveCallRoute = useCallback(() => {
    hasLeftRoomRef.current = true;
    popupWindowRef.current = null;
    activeHandoffIdRef.current = null;
    resumeOnNextJoinRef.current = false;
    skipDoctorPresenceLeaveRef.current = false;
    setHandoffState("idle");
    setSession(null);
    setCallEnded(true);
    setLoading(false);
    setError(null);
    window.history.replaceState(window.history.state, "", buildCallUrl({ ended: true }));

    if (isPopupWindow) {
      if (window.opener && !window.opener.closed) {
        try {
          (window.opener as Window).postMessage(
            {
              source: MINI_WINDOW_MESSAGE_SOURCE,
              meetingId,
              type: "popup-ended" satisfies MiniWindowMessageType,
            },
            window.location.origin
          );
          (window.opener as Window).focus();
        } catch {
          // ignore
        }
      }
      window.close();
      return;
    }
  }, [buildCallUrl, isPopupWindow, meetingId]);

  const openMiniWindowAndSwitch = () => {
    if (!meetingId || handoffState !== "idle") {
      return;
    }

    const handoffId = generateSecureId(meetingId);
    const popupParams = new URLSearchParams({ popup: "1", handoff: handoffId });
    if (patientName) popupParams.set("pn", patientName);
    if (patientTime) popupParams.set("pt", patientTime);
    const popupUrl = `${window.location.origin}/meetings/call/${meetingId}?${popupParams.toString()}`;
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

    activeHandoffIdRef.current = handoffId;
    popupWindowRef.current = popup;
    resumeOnNextJoinRef.current = false;
    skipDoctorPresenceLeaveRef.current = false;
    setHandoffState("popup-opening");
    setError(null);
    popup.focus();
  };

  const handleBackToMeetings = () => {
    skipUnloadGuardRef.current = true;
    router.push("/meetings");
  };

  const handleClosePopupWindow = () => {
    skipUnloadGuardRef.current = true;
    if (window.opener && !window.opener.closed) {
      try {
        (window.opener as Window).focus();
      } catch {
        // Cross-origin or already closed — ignore
      }
    }
    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        router.push("/meetings");
      }
    }, 120);
  };

  const handleReturnFromMiniWindow = () => {
    const popup = popupWindowRef.current;
    if (popup && !popup.closed) {
      skipUnloadGuardRef.current = true;
      try {
        popup.close();
      } catch {
        requestResumeFromMiniWindow();
      }
      window.setTimeout(() => {
        if (popup.closed) {
          requestResumeFromMiniWindow();
        }
      }, 180);
      return;
    }
    requestResumeFromMiniWindow();
  };

  const handleCopyInvite = useCallback(async () => {
    if (!patientInviteUrl) return;
    try {
      await navigator.clipboard.writeText(patientInviteUrl);
      setCopiedInvite(true);
      window.setTimeout(() => setCopiedInvite(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  }, [patientInviteUrl]);

  useEffect(() => {
    if (!session) {
      setCallSeconds(0);
      if (callTimerRef.current !== null) {
        window.clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      return;
    }
    callTimerRef.current = window.setInterval(() => {
      setCallSeconds((s) => s + 1);
    }, 1000);
    return () => {
      if (callTimerRef.current !== null) {
        window.clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    };
  }, [session]);

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
        return; // suppress ZEGO SDK noise silently
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
        event.preventDefault();
      }
    };

    const handleWindowError = (event: ErrorEvent) => {
      if (isExpectedMediaPermissionNoise(event.error ?? event.message)) {
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
  }, []);

  useEffect(() => {
    if (!meetingId) {
      setError(tr(language, "Invalid meeting id.", "meeting id ไม่ถูกต้อง"));
      setLoading(false);
      return;
    }
    if (callEnded && !resumeOnNextJoinRef.current) {
      setLoading(false);
      return;
    }
    if (!token) {
      setError(tr(language, "Session expired. Please log in again.", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"));
      setLoading(false);
      return;
    }
    if (role !== "doctor") {
      setError(tr(language, "Only doctor accounts can start calls.", "เฉพาะบัญชีแพทย์เท่านั้นที่เริ่มคอลได้"));
      setLoading(false);
      return;
    }

    let cancelled = false;
    let mountedInstance: ZegoUIKitPrebuiltInstance | null = null;
    const containerNode = containerRef.current;

    const run = async () => {
      if (isMainWindowParked) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      const metrics = new CallStartupMetrics("doctor", networkProfile);
      setLoadingStep("checking-media");
      setPatientInviteUrl(null);
      popupActivationAnnouncedRef.current = false;
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

        metrics.mark("sdk-load-start");
        const zegoPromise = withRetry(
          () => loadZegoUIKitPrebuilt(),
          1,
          "ZEGO SDK load"
        );
        metrics.mark("api-token-start");
        const videoSessionPromise = withRetry(
          () => withTimeout(
            issueMeetingVideoToken(meetingId, token),
            API_TIMEOUT_MS,
            "Video token API"
          ),
          1,
          "Video token API"
        );

        metrics.mark("media-warmup-start");
        const mediaPreference = await warmupDoctorMediaDevices(language, networkProfile);
        metrics.mark("media-warmup-end");
        metrics.measure("media-warmup", "media-warmup-start", "media-warmup-end");
        if (cancelled) return;
        const hintText = (mediaPreference.hint || "").toLowerCase();
        const deviceMissing =
          hintText.includes("no usable camera/mic") || hintText.includes("not found");
        const permissionBlocked = !mediaPreference.allowCamera || !mediaPreference.allowMicrophone;

        setLoadingStep("connecting-room");
        const videoSession = await videoSessionPromise;
        metrics.mark("api-token-end");
        metrics.measure("api-token", "api-token-start", "api-token-end");
        if (cancelled) return;

        if (videoSession.provider !== "zego") {
          throw new Error("Meeting video provider is not ZEGO.");
        }
        if (!videoSession.app_id) {
          throw new Error("Missing ZEGO AppID from video session response.");
        }

        setSession(videoSession);
        const meetingLink = `${window.location.origin}/meetings/call/${meetingId}`;

        // Fire-and-forget patient invite — does not block room setup
        void createMeetingPatientInvite(meetingId, token)
          .then((invite) => {
            if (!cancelled) setPatientInviteUrl(invite.invite_url);
          })
          .catch(() => {
            // silent — invite failure does not affect the call
          });

        setLoadingStep("loading-video");
        const zego = await zegoPromise;
        metrics.mark("sdk-load-end");
        metrics.measure("sdk-load", "sdk-load-start", "sdk-load-end");
        if (cancelled) return;
        if (!containerNode) {
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
        hasLeftRoomRef.current = false;
        suppressLeaveRoomNavigationRef.current = false;
        metrics.mark("room-join-start");
        setLoadingStep("entering-room");
        const shouldSkipPreJoin =
          isPopupWindow || resumeFromMiniWindow || resumeOnNextJoinRef.current;
        mountedInstance.joinRoom({
          container: containerNode,
          // Skip pre-join in popup, and also when restoring from the mini
          // window so the doctor returns straight into the active room.
          showPreJoinView: !shouldSkipPreJoin,
          // Start muted if device missing or permission/gesture blocked to avoid ZEGO auth modal; doctor can enable in-room after granting.
          turnOnCameraWhenJoining: !deviceMissing && !permissionBlocked && mediaPreference.allowCamera,
          turnOnMicrophoneWhenJoining: !deviceMissing && !permissionBlocked && mediaPreference.allowMicrophone,
          sharedLinks: [
            {
              name: "Meeting Link",
              url: meetingLink,
            },
          ],
          showLeavingView: false,
          onLeaveRoom: () => {
            if (suppressLeaveRoomNavigationRef.current) {
              return;
            }
            hasLeftRoomRef.current = true;
            zegoInstanceRef.current = null;
            handleLeaveCallRoute();
          },
          videoCodec: MEETING_VIDEO_CODEC,
          videoResolutionDefault: getDefaultZegoVideoResolution(zego, {
            networkProfile,
            audience: "doctor",
          }),
          videoScreenConfig: {
            objectFit: "cover",
          },
          scenario: {
            mode: zego.VideoConference,
          },
        });
        resumeOnNextJoinRef.current = false;
        metrics.mark("room-join-end");
        metrics.measure("room-join", "room-join-start", "room-join-end");
        metrics.recordSummary({
          route: "doctor-call",
          status: "success",
          meetingId,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : tr(language, "Unable to start call.", "ไม่สามารถเริ่มการคอลได้");
        metrics.recordSummary({
          route: "doctor-call",
          status: "failed",
          meetingId,
          errorMessage: message,
        });
        if (isPopupWindow) {
          postMiniWindowMessage("popup-failed");
        }
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      const instance = mountedInstance ?? zegoInstanceRef.current;
      try {
        suppressLeaveRoomNavigationRef.current = true;
        if (
          !hasLeftRoomRef.current &&
          instance &&
          typeof instance.destroy === "function"
        ) {
          instance.destroy();
        }
      } catch {
        // ignore SDK cleanup errors on teardown/retry
      } finally {
        mountedInstance = null;
        zegoInstanceRef.current = null;
        // Clear ZEGO DOM remnants so the next mount starts with a clean container.
        if (containerNode) {
          containerNode.innerHTML = "";
        }
      }
    };
  }, [
    meetingId,
    token,
    role,
    language,
    isPopupWindow,
    postMiniWindowMessage,
    handleLeaveCallRoute,
    callEnded,
    isMainWindowParked,
    resumeFromMiniWindow,
    retryNonce,
    networkProfile,
  ]);

  useEffect(() => {
    if (!isPopupWindow) {
      return;
    }

    postMiniWindowMessage("popup-mounted");
    const notifyClosing = () => {
      if (hasLeftRoomRef.current) {
        return;
      }
      postMiniWindowMessage("popup-closing");
    };

    window.addEventListener("pagehide", notifyClosing);
    window.addEventListener("beforeunload", notifyClosing);

    return () => {
      window.removeEventListener("pagehide", notifyClosing);
      window.removeEventListener("beforeunload", notifyClosing);
    };
  }, [isPopupWindow, postMiniWindowMessage]);

  useEffect(() => {
    if (isPopupWindow) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as
        | {
            source?: string;
            meetingId?: string;
            type?: MiniWindowMessageType;
            handoffId?: string;
          }
        | undefined;

      if (
        !data ||
        data.source !== MINI_WINDOW_MESSAGE_SOURCE ||
        data.meetingId !== meetingId ||
        data.handoffId !== activeHandoffIdRef.current
      ) {
        return;
      }

      if (data.type === "popup-mounted") {
        setHandoffState((current) =>
          current === "popup-opening" ? "popup-joining" : current
        );
        return;
      }

      if (data.type === "popup-active") {
        skipDoctorPresenceLeaveRef.current = true;
        setHandoffState("popup-active");
        return;
      }

      if (data.type === "popup-failed") {
        popupWindowRef.current = null;
        activeHandoffIdRef.current = null;
        skipDoctorPresenceLeaveRef.current = false;
        setHandoffState("idle");
        setError(
          tr(
            language,
            "Mini window could not join the call. The main call is still active here.",
            "หน้าต่างเล็กเข้าคอลไม่สำเร็จ แต่คอลหลักยังทำงานอยู่ที่หน้านี้"
          )
        );
        return;
      }

      if (data.type === "popup-closing") {
        if (handoffState === "popup-active") {
          requestResumeFromMiniWindow();
          return;
        }
        popupWindowRef.current = null;
        activeHandoffIdRef.current = null;
        skipDoctorPresenceLeaveRef.current = false;
        setHandoffState("idle");
        return;
      }

      if (data.type === "popup-ended") {
        popupWindowRef.current = null;
        activeHandoffIdRef.current = null;
        resumeOnNextJoinRef.current = false;
        skipDoctorPresenceLeaveRef.current = false;
        setHandoffState("idle");
        setSession(null);
        setCallEnded(true);
        setLoading(false);
        setError(null);
        window.history.replaceState(
          window.history.state,
          "",
          buildCallUrl({ ended: true })
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [
    buildCallUrl,
    handoffState,
    isPopupWindow,
    language,
    meetingId,
    requestResumeFromMiniWindow,
  ]);

  useEffect(() => {
    if (isPopupWindow || handoffState === "idle") {
      return;
    }

    const timer = window.setInterval(() => {
      const popup = popupWindowRef.current;
      if (popup && popup.closed) {
        if (handoffState === "popup-active") {
          requestResumeFromMiniWindow();
          return;
        }
        popupWindowRef.current = null;
        activeHandoffIdRef.current = null;
        skipDoctorPresenceLeaveRef.current = false;
        setHandoffState("idle");
      }
    }, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [handoffState, isPopupWindow, requestResumeFromMiniWindow]);

  useEffect(() => {
    if (!session || !token || !meetingId || role !== "doctor") {
      return;
    }

    if (isMainWindowParked) {
      return;
    }

    let disposed = false;

    const sendHeartbeat = async () => {
      if (disposed) return;
      try {
        await heartbeatDoctorMeetingPresence(meetingId, token);
        if (isPopupWindow && !popupActivationAnnouncedRef.current) {
          popupActivationAnnouncedRef.current = true;
          postMiniWindowMessage("popup-active");
        }
      } catch {
        // silently retry on next interval
      }
    };

    const sendLeave = () => {
      if (disposed) return;
      if (!isPopupWindow && skipDoctorPresenceLeaveRef.current) {
        return;
      }
      void leaveDoctorMeetingPresence(meetingId, token).catch(() => {
        // Best-effort leave marker.
      });
    };

    void sendHeartbeat();
    const interval = window.setInterval(
      () => {
        void sendHeartbeat();
      },
      DOCTOR_PRESENCE_HEARTBEAT_INTERVAL_MS
    );

    window.addEventListener("pagehide", sendLeave);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", sendLeave);
      sendLeave();
      disposed = true;
    };
  }, [
    session,
    token,
    meetingId,
    role,
    isMainWindowParked,
    isPopupWindow,
    postMiniWindowMessage,
  ]);

  const callDuration = session ? formatCallDuration(callSeconds) : null;
  const appointmentLabel = patientTime ? formatAppointmentTime(language, patientTime) : null;
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
  const patientInitial = (patientName.trim().charAt(0) || "P").toUpperCase();
  const showStandbyState = handoffState === "popup-active" && !isPopupWindow;
  const loadingTitle = (() => {
    if (loadingStep === "checking-media") {
      return tr(language, "Preparing camera and microphone", "กำลังเตรียมกล้องและไมค์");
    }
    if (loadingStep === "connecting-room") {
      return tr(language, "Connecting appointment room", "กำลังเชื่อมห้องนัดหมาย");
    }
    if (loadingStep === "loading-video") {
      return tr(language, "Loading video engine", "กำลังโหลดระบบวิดีโอ");
    }
    return tr(language, "Entering call room", "กำลังเข้าห้องตรวจ");
  })();
  const loadingDescription = (() => {
    if (loadingStep === "checking-media") {
      return tr(
        language,
        "We are checking device access first so the call can start with fewer permission surprises.",
        "กำลังตรวจสอบสิทธิ์อุปกรณ์ก่อน เพื่อให้เข้าห้องได้ลื่นขึ้นและเจอปัญหาสิทธิ์น้อยลง"
      );
    }
    if (loadingStep === "connecting-room") {
      return tr(
        language,
        "The system is requesting a room token and reserving the appointment channel.",
        "ระบบกำลังขอโทเคนห้องและจองช่องทางสำหรับนัดหมายนี้"
      );
    }
    if (loadingStep === "loading-video") {
      return tr(
        language,
        "The video bundle is being prepared. This may take longer on slower networks.",
        "ระบบกำลังเตรียมโมดูลวิดีโอ ขั้นตอนนี้อาจใช้เวลานานขึ้นเมื่อเน็ตช้า"
      );
    }
    return tr(
      language,
      "Finalizing room controls and opening the consultation screen.",
      "กำลังตั้งค่าปุ่มควบคุมและเปิดหน้าตรวจให้พร้อมใช้งาน"
    );
  })();
  const loadingHint = isSlowLoading
    ? tr(
        language,
        "Network looks slow, so we start with a lighter video profile first and keep trying in the background.",
        "เครือข่ายค่อนข้างช้า ระบบจึงเริ่มด้วยคุณภาพวิดีโอที่เบากว่าก่อน และจะพยายามเชื่อมต่อให้ต่อเนื่อง"
      )
    : isSlowNetwork
      ? tr(
          language,
          "Slow-network mode is active to reduce startup time.",
          "เปิดโหมดเน็ตช้าเพื่อลดเวลารอเริ่มคอล"
        )
      : null;

  return (
    <main className="flex h-full w-full flex-col p-2 md:p-3">
      <div
        className={cn(
          "relative flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950",
          isPopupWindow ? "min-h-[86vh]" : "min-h-[80vh]"
        )}
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-slate-950 opacity-50" />
        <div ref={containerRef} className="relative z-10 h-full w-full" />
        <MeetingCallChrome
          language={language}
          isPopupWindow={isPopupWindow}
          patientName={patientName}
          patientInitial={patientInitial}
          appointmentLabel={appointmentLabel}
          modeSummary={modeSummary}
          callDuration={callDuration}
          patientInviteUrl={patientInviteUrl}
          copiedInvite={copiedInvite}
          isMiniWindowPending={isMiniWindowPending}
          showStandbyState={showStandbyState}
          callEnded={callEnded}
          loading={loading}
          error={error}
          overallTimedOut={overallTimedOut}
          loadingTitle={loadingTitle}
          loadingDescription={loadingDescription}
          loadingHint={loadingHint}
          loadingStep={loadingStep}
          stageStuck={stageStuck}
          onCopyInvite={() => {
            void handleCopyInvite();
          }}
          onOpenMiniWindow={openMiniWindowAndSwitch}
          onReturnFromMiniWindow={handleReturnFromMiniWindow}
          onFocusMiniWindow={() => {
            const popup = popupWindowRef.current;
            if (popup && !popup.closed) {
              popup.focus();
            }
          }}
          onBack={isPopupWindow ? handleClosePopupWindow : handleBackToMeetings}
          onRetryJoin={handleRetryJoin}
        />
      </div>
    </main>
  );
}
