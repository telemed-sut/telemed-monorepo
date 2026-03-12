"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createMeetingPatientInvite,
  heartbeatDoctorMeetingPresence,
  issueMeetingVideoToken,
  leaveDoctorMeetingPresence,
  type MeetingRoomPresence,
  type MeetingVideoTokenResponse,
} from "@/lib/api";
import {
  loadZegoUIKitPrebuilt,
  type ZegoUIKitPrebuiltInstance,
} from "@/lib/zego-uikit";
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

function getPresenceBadge(
  language: AppLanguage,
  presence: MeetingRoomPresence | null
): { label: string; className: string } | null {
  if (!presence) return null;
  const { state } = presence;
  if (state === "both_in_room") {
    return {
      label: tr(language, "Patient in room", "คนไข้อยู่ในห้อง"),
      className: "border-emerald-300/30 bg-emerald-500/15 text-emerald-100",
    };
  }
  if (state === "patient_waiting" || state === "doctor_left_patient_waiting") {
    return {
      label: tr(language, "Patient waiting", "คนไข้รออยู่"),
      className: "border-amber-300/30 bg-amber-500/15 text-amber-100",
    };
  }
  return {
    label: tr(language, "Waiting for patient", "รอคนไข้"),
    className: "border-white/15 bg-white/10 text-white/55",
  };
}

const DOCTOR_PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;

export default function MeetingCallPage() {
  const params = useParams<{ meetingId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const language = useLanguageStore((state) => state.language);
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const isPopupWindow = searchParams.get("popup") === "1";
  const patientName = searchParams.get("pn") ?? "";
  const patientTime = searchParams.get("pt") ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<MeetingVideoTokenResponse | null>(null);
  const [meetingUrl, setMeetingUrl] = useState<string>("");
  const [patientPresence, setPatientPresence] = useState<MeetingRoomPresence | null>(null);
  const [patientInviteUrl, setPatientInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zegoInstanceRef = useRef<ZegoUIKitPrebuiltInstance | null>(null);
  const skipUnloadGuardRef = useRef(false);
  const callTimerRef = useRef<number | null>(null);

  const meetingId = useMemo(() => {
    const raw = params?.meetingId;
    if (typeof raw !== "string") return "";
    return raw.trim();
  }, [params]);

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

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
  }, [loading]);

  const openMiniWindowAndSwitch = () => {
    if (!meetingId) {
      return;
    }

    const popupParams = new URLSearchParams({ popup: "1" });
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
    // Send parent window back to the full call view before closing
    if (window.opener && !window.opener.closed) {
      try {
        const returnParams = new URLSearchParams();
        if (patientName) returnParams.set("pn", patientName);
        if (patientTime) returnParams.set("pt", patientTime);
        const qs = returnParams.toString();
        (window.opener as Window).location.assign(
          `/meetings/call/${meetingId}${qs ? `?${qs}` : ""}`
        );
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

    const run = async () => {
      setLoading(true);
      setError(null);
      setPatientInviteUrl(null);
      setPatientPresence(null);
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

        const videoSession = await issueMeetingVideoToken(meetingId, token);
        if (cancelled) return;

        if (videoSession.provider !== "zego") {
          throw new Error("Meeting video provider is not ZEGO.");
        }
        if (!videoSession.app_id) {
          throw new Error("Missing ZEGO AppID from video session response.");
        }

        setSession(videoSession);
        const meetingLink = `${window.location.origin}/meetings/call/${meetingId}`;
        setMeetingUrl(meetingLink);

        // Fire-and-forget patient invite — does not block room setup
        void createMeetingPatientInvite(meetingId, token)
          .then((invite) => {
            if (!cancelled) setPatientInviteUrl(invite.invite_url);
          })
          .catch(() => {
            // silent — invite failure does not affect the call
          });

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
          // Skip pre-join in popup (mini window) — permissions are already
          // resolved by warmupDoctorMediaDevices so no form needed.
          showPreJoinView: !isPopupWindow,
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
      } catch (err: unknown) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : tr(language, "Unable to start call.", "ไม่สามารถเริ่มการคอลได้");
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
        if (instance && typeof instance.destroy === "function") {
          instance.destroy();
        }
      } catch {
        // ignore SDK cleanup errors on teardown/retry
      } finally {
        mountedInstance = null;
        zegoInstanceRef.current = null;
        // Clear ZEGO DOM remnants so the next mount starts with a clean container.
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }
      }
    };
  }, [
    meetingId,
    token,
    role,
    language,
    retryNonce,
  ]);

  useEffect(() => {
    if (!session || !token || !meetingId || role !== "doctor") {
      return;
    }

    let disposed = false;

    const sendHeartbeat = () => {
      if (disposed) return;
      void heartbeatDoctorMeetingPresence(meetingId, token)
        .then((presence) => {
          if (disposed) return;
          setPatientPresence(presence);
        })
        .catch(() => {
          // silently retry on next interval
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
  }, [session, token, meetingId, role]);

  const presenceBadge = session ? getPresenceBadge(language, patientPresence) : null;
  const callDuration = session ? formatCallDuration(callSeconds) : null;
  const appointmentLabel = patientTime ? formatAppointmentTime(language, patientTime) : null;
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
            <div className="pointer-events-auto max-w-[58%] rounded-xl border border-white/20 bg-black/45 px-3 py-2 text-white backdrop-blur-md">
              <p className="truncate text-sm font-semibold">
                {patientName || tr(language, "Doctor Video Call", "ห้องวิดีโอแพทย์")}
              </p>
              {appointmentLabel ? (
                <p className="truncate text-[11px] text-white/65">{appointmentLabel}</p>
              ) : null}
              <p className="truncate text-[11px] text-white/80">{roomSummary}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/90">
                  {modeSummary}
                </span>
                {callDuration !== null ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/8 px-2 py-0.5 text-[10px] font-medium tabular-nums text-white/85">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {callDuration}
                  </span>
                ) : null}
                {presenceBadge ? (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      presenceBadge.className
                    )}
                  >
                    {presenceBadge.label}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="pointer-events-auto flex flex-col gap-1.5 sm:flex-row sm:items-center">
              {patientInviteUrl && !isPopupWindow ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-sky-300/50 bg-sky-500/20 px-2.5 text-xs font-semibold text-sky-100 shadow-sm backdrop-blur-sm hover:bg-sky-500/30 focus-visible:ring-sky-300/60"
                  onClick={() => { void handleCopyInvite(); }}
                >
                  {copiedInvite
                    ? tr(language, "Copied!", "คัดลอกแล้ว!")
                    : tr(language, "Patient link", "ลิงก์คนไข้")}
                </Button>
              ) : null}
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
            </div>
          </div>

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
