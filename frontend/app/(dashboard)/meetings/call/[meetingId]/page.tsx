"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  createMeetingPatientInvite,
  heartbeatDoctorMeetingPresence,
  issueMeetingVideoToken,
  leaveDoctorMeetingPresence,
  type MeetingPatientInviteResponse,
  type MeetingVideoTokenResponse,
} from "@/lib/api";
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

type ZegoJoinOptions = {
  container: HTMLElement;
  sharedLinks?: Array<{ name: string; url: string }>;
  scenario: { mode: unknown };
  showPreJoinView?: boolean;
  turnOnCameraWhenJoining?: boolean;
  turnOnMicrophoneWhenJoining?: boolean;
};

type ZegoUIKitPrebuiltInstance = {
  joinRoom: (options: ZegoJoinOptions) => void;
  destroy?: () => void;
};

type ZegoUIKitPrebuiltStatic = {
  VideoConference: unknown;
  generateKitTokenForProduction: (
    appID: number,
    token: string,
    roomID: string,
    userID: string,
    userName?: string
  ) => string;
  create: (kitToken: string) => ZegoUIKitPrebuiltInstance;
};

declare global {
  interface Window {
    ZegoUIKitPrebuilt?: ZegoUIKitPrebuiltStatic;
  }
}

const ZEGO_WEB_UIKIT_SCRIPT =
  "https://unpkg.com/@zegocloud/zego-uikit-prebuilt/zego-uikit-prebuilt.js";
const DOCTOR_PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;

let zegoScriptPromise: Promise<ZegoUIKitPrebuiltStatic> | null = null;

function loadZegoUIKitScript(): Promise<ZegoUIKitPrebuiltStatic> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Browser environment is required."));
  }
  if (window.ZegoUIKitPrebuilt) {
    return Promise.resolve(window.ZegoUIKitPrebuilt);
  }
  if (zegoScriptPromise) {
    return zegoScriptPromise;
  }

  zegoScriptPromise = new Promise<ZegoUIKitPrebuiltStatic>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-zego-uikit="true"]`
    );
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.ZegoUIKitPrebuilt) {
          resolve(window.ZegoUIKitPrebuilt);
          return;
        }
        reject(new Error("ZEGO UIKit script loaded but global object is missing."));
      });
      existing.addEventListener("error", () => {
        reject(new Error("Unable to load ZEGO UIKit script."));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = ZEGO_WEB_UIKIT_SCRIPT;
    script.async = true;
    script.dataset.zegoUikit = "true";
    script.onload = () => {
      if (window.ZegoUIKitPrebuilt) {
        resolve(window.ZegoUIKitPrebuilt);
        return;
      }
      reject(new Error("ZEGO UIKit script loaded but global object is missing."));
    };
    script.onerror = () => {
      reject(new Error("Unable to load ZEGO UIKit script."));
    };
    document.body.appendChild(script);
  });

  return zegoScriptPromise;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zegoInstanceRef = useRef<ZegoUIKitPrebuiltInstance | null>(null);
  const skipUnloadGuardRef = useRef(false);

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
        setCallNotice(toDoctorCallNotice(language, message));
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
        setCallNotice(toDoctorCallNotice(language, stringifyErrorReason(event.reason)));
        event.preventDefault();
      }
    };

    const handleWindowError = (event: ErrorEvent) => {
      if (isExpectedMediaPermissionNoise(event.error ?? event.message)) {
        setCallNotice(
          toDoctorCallNotice(language, stringifyErrorReason(event.error ?? event.message))
        );
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
  }, [language]);

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
      setCallNotice(null);
      setPatientInvite(null);
      setPatientInviteError(null);
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
        const meetingLink = `${window.location.origin}/meetings/call/${meetingId}`;
        setMeetingUrl(meetingLink);
        try {
          const invite = await createMeetingPatientInvite(meetingId, token);
          if (!cancelled) {
            setPatientInvite(invite);
          }
        } catch {
          if (!cancelled) {
            setPatientInviteError(
              tr(
                language,
                "Unable to generate patient invite URL right now.",
                "ยังไม่สามารถสร้างลิงก์เชิญคนไข้ได้ในขณะนี้"
              )
            );
          }
        }

        const zego = await loadZegoUIKitScript();
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
      if (mountedInstance?.destroy) {
        mountedInstance.destroy();
      } else if (zegoInstanceRef.current?.destroy) {
        zegoInstanceRef.current.destroy();
      }
      zegoInstanceRef.current = null;
    };
  }, [meetingId, token, role, language]);

  useEffect(() => {
    if (!session || !token || !meetingId || role !== "doctor") {
      return;
    }

    let disposed = false;

    const sendHeartbeat = () => {
      if (disposed) return;
      void heartbeatDoctorMeetingPresence(meetingId, token).catch(() => {
        // Presence heartbeat is best-effort and must not break call UX.
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

  const hasLinkPanel = !isPopupWindow && Boolean(meetingUrl || patientInvite?.invite_url);
  const hasMetaAlerts = Boolean(patientInviteError || callNotice || error);
  const hasMetaContent = hasLinkPanel || hasMetaAlerts;
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
          className={`relative flex-1 overflow-hidden rounded-2xl border border-border bg-black ${
            isPopupWindow ? "min-h-[86vh]" : "min-h-[80vh]"
          }`}
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
            className={`absolute right-3 top-14 z-40 w-[min(92vw,420px)] origin-top-right overflow-hidden rounded-2xl border border-white/20 bg-slate-950/75 text-white shadow-2xl backdrop-blur-xl transition duration-200 ${
              showMetaPanel
                ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                : "pointer-events-none -translate-y-2 scale-95 opacity-0"
            }`}
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

              {!hasMetaContent ? (
                <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70">
                  {tr(language, "No extra details right now.", "ขณะนี้ยังไม่มีข้อมูลเพิ่มเติม")}
                </div>
              ) : null}
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
