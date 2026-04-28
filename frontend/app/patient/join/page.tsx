"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, CameraOff, Mic, MicOff, ShieldCheck, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Maximize2Icon } from "@/components/ui/maximize-2";
import { toast } from "@/components/ui/toast";
import {
  heartbeatPatientMeetingPresence,
  issuePatientMeetingVideoToken,
  leavePatientMeetingPresence,
} from "@/lib/api";
import {
  getCallNetworkProfile,
  getDefaultZegoVideoResolution,
  loadZegoUIKitPrebuilt,
  preloadZegoUIKitPrebuilt,
  withTimeout,
  withRetry,
  CallStartupMetrics,
  getAdaptiveMediaConstraints,
  getMediaReleaseDelay,
  API_TIMEOUT_MS,
  type ZegoUIKitPrebuiltInstance,
} from "@/lib/zego-uikit";

const PATIENT_PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;
const PATIENT_ROOM_BACKGROUND_URL = "/patient-room-bg.svg";
const MEETING_VIDEO_CODEC = "H264" as const;
const JOIN_LOADING_SLOW_THRESHOLD_MS = 8_000;
type JoinLoadingStep =
  | "checking-media"
  | "connecting-room"
  | "loading-video"
  | "entering-room";
type PatientCallState = "prejoin" | "bootstrapping" | "in-room";

const STAGE_TIMEOUT_MS = 15_000;
const OVERALL_TIMEOUT_MS = 45_000;

function PatientJoinLoadingShell() {
  return (
    <main className="min-h-[100dvh] bg-[#eef3f9] p-4 text-[#0f2854] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl text-sm text-slate-300">Loading call page...</div>
    </main>
  );
}

type PatientDeviceToggleButtonProps = {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onClick: () => void;
  activeIcon: typeof Camera;
  inactiveIcon: typeof CameraOff;
};

function PatientDeviceToggleButton({
  active,
  activeLabel,
  inactiveLabel,
  onClick,
  activeIcon: ActiveIcon,
  inactiveIcon: InactiveIcon,
}: PatientDeviceToggleButtonProps) {
  const Icon = active ? ActiveIcon : InactiveIcon;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-pressed={active}
      aria-label={active ? activeLabel : inactiveLabel}
      className={[
        "size-11 rounded-full border-white/15 bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/16 sm:size-12",
        active ? "text-[#bde8f5]" : "text-white/70",
      ].join(" ")}
      onClick={onClick}
    >
      <Icon className="size-5" />
    </Button>
  );
}

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
    normalized.includes("cmdreq connect not establish") ||
    normalized.includes("connect not establish logout") ||
    normalized.includes("a user gesture is required") ||
    normalized.includes("notallowederror") ||
    normalized.includes("notfounderror") ||
    normalized.includes("requested device not found") ||
    normalized.includes("setsinkid") ||
    normalized.includes("[zegoroommobile]createstream error") ||
    normalized.includes("session request timeout") ||
    normalized.includes("play stream interrupted") ||
    normalized.includes("stream does not exist") ||
    normalized.includes("get media fail") ||
    normalized.includes("\"errorcode\":1103061") ||
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

// 1-second of silent WAV
const SILENT_WAV_B64 =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function unlockBrowserAudioPlayback() {
  if (typeof window === "undefined") return;
  try {
    const a = new Audio(SILENT_WAV_B64);
    a.muted = true;
    a.volume = 0;
    void a.play().catch(() => {});
  } catch {
    // ignore
  }
}

async function warmupPatientMediaDevices(
  networkProfile: "slow" | "standard" = "standard"
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  const constraints = getAdaptiveMediaConstraints(networkProfile);
  const releaseDelay = getMediaReleaseDelay();
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((track) => track.stop());
    // Give iOS Safari time to fully release the hardware lock to prevent black frames
    await new Promise((r) => setTimeout(r, releaseDelay));
  } catch (error: unknown) {
    const normalized = stringifyErrorReason(error).toLowerCase();
    if (
      normalized.includes("notfound") ||
      normalized.includes("overconstrained")
    ) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        audioStream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 320, height: 240 },
        });
        videoStream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      // Give iOS Safari time to fully release the hardware lock
      await new Promise((r) => setTimeout(r, releaseDelay));
    }
  }
}

async function resumeAllMediaPlayback(): Promise<boolean> {
  const mediaNodes = Array.from(
    document.querySelectorAll<HTMLMediaElement>("video, audio")
  );
  if (!mediaNodes.length) {
    return true;
  }

  let blockedByGesture = false;
  let resumedSomething = false;

  await Promise.all(
    mediaNodes.map(async (node) => {
      const shouldAttemptPlay =
        node.paused ||
        node.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
        node.muted;
      if (!shouldAttemptPlay) {
        return;
      }
      try {
        // Keep node muted state untouched, only resume playback pipeline.
        await node.play();
        resumedSomething = true;
      } catch (error: unknown) {
        const normalized = stringifyErrorReason(error).toLowerCase();
        if (
          normalized.includes("notallowederror") ||
          normalized.includes("user gesture") ||
          normalized.includes("play()")
        ) {
          blockedByGesture = true;
          return;
        }
      }
    })
  );

  return resumedSomething || !blockedByGesture;
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

function PatientJoinPageContent() {
  const searchParams = useSearchParams();
  const meetingId = (searchParams.get("meeting_id") || "").trim();
  const shortCode = (
    searchParams.get("short_code") ||
    searchParams.get("c") ||
    ""
  ).trim();
  const inviteToken = (
    searchParams.get("invite_token") ||
    searchParams.get("t") ||
    ""
  ).trim();
  const nameFromQuery = (searchParams.get("name") || "").trim();

  const [loading, setLoading] = useState(false);
  const [callState, setCallState] = useState<PatientCallState>("prejoin");
  const [error, setError] = useState<string | null>(null);
  const [showResumeButton, setShowResumeButton] = useState(false);
  const [displayName, setDisplayName] = useState(nameFromQuery);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [loadingStep, setLoadingStep] = useState<JoinLoadingStep>("checking-media");
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const [stageStuck, setStageStuck] = useState(false);
  const [overallTimedOut, setOverallTimedOut] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zegoInstanceRef = useRef<ZegoUIKitPrebuiltInstance | null>(null);
  const activeJoinAttemptRef = useRef(0);
  const networkProfile = useMemo(() => getCallNetworkProfile(), []);
  const isSlowNetwork = networkProfile === "slow";
  const isInRoom = callState === "in-room";
  const showCallSurface = callState !== "prejoin";

  useEffect(() => {
    if (!displayName && nameFromQuery) {
      setDisplayName(nameFromQuery);
    }
  }, [displayName, nameFromQuery]);

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
    }, JOIN_LOADING_SLOW_THRESHOLD_MS);
    const overallTimer = window.setTimeout(() => {
      setOverallTimedOut(true);
    }, OVERALL_TIMEOUT_MS);

    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(overallTimer);
    };
  }, [loading]);

  // Per-stage stuck detector — resets each time loadingStep changes
  useEffect(() => {
    if (!loading) return;
    setStageStuck(false);
    const timer = window.setTimeout(() => {
      setStageStuck(true);
    }, STAGE_TIMEOUT_MS);
    return () => { window.clearTimeout(timer); };
  }, [loading, loadingStep]);

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

  const handleJoin = async () => {
    if (!inviteToken && !shortCode) {
      setError("Missing invite token or short code.");
      return;
    }
    const normalizedName = displayName.trim();
    if (!normalizedName) {
      setError("Please enter your name before joining.");
      return;
    }

    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      setError(
        "iPhone camera/mic needs HTTPS. Open this link via HTTPS domain/tunnel (not plain HTTP LAN) or use the app."
      );
      return;
    }

    // Capture the user gesture synchronously
    unlockBrowserAudioPlayback();

    activeJoinAttemptRef.current += 1;
    const attemptId = activeJoinAttemptRef.current;
    setLoading(true);
    setError(null);
    const metrics = new CallStartupMetrics("patient", networkProfile);
    let mountedInstance: ZegoUIKitPrebuiltInstance | null = null;
    try {
      setLoadingStep("checking-media");
      metrics.mark("sdk-load-start");
      const zegoPromise = withRetry(
        () => loadZegoUIKitPrebuilt(),
        1,
        "ZEGO SDK load"
      );
      metrics.mark("api-token-start");
      const videoSessionPromise = withRetry(
        () => withTimeout(
          issuePatientMeetingVideoToken({
            meetingId: meetingId || undefined,
            inviteToken: inviteToken || undefined,
            shortCode: shortCode || undefined,
          }),
          API_TIMEOUT_MS,
          "Patient video token API"
        ),
        1,
        "Patient video token API"
      );
      metrics.mark("media-warmup-start");
      await warmupPatientMediaDevices(networkProfile);
      if (activeJoinAttemptRef.current !== attemptId) {
        return;
      }
      metrics.mark("media-warmup-end");
      metrics.measure("media-warmup", "media-warmup-start", "media-warmup-end");

      setLoadingStep("connecting-room");
      const videoSession = await videoSessionPromise;
      if (activeJoinAttemptRef.current !== attemptId) {
        return;
      }
      metrics.mark("api-token-end");
      metrics.measure("api-token", "api-token-start", "api-token-end");
      if (videoSession.provider !== "zego") {
        throw new Error("Meeting video provider is not ZEGO.");
      }
      if (!videoSession.app_id) {
        throw new Error("Missing ZEGO AppID from video session response.");
      }

      setLoadingStep("loading-video");
      const zego = await zegoPromise;
      if (activeJoinAttemptRef.current !== attemptId) {
        return;
      }
      metrics.mark("sdk-load-end");
      metrics.measure("sdk-load", "sdk-load-start", "sdk-load-end");

      if (zegoInstanceRef.current?.destroy) {
        zegoInstanceRef.current.destroy();
      }
      if (containerRef.current) {
        containerRef.current.textContent = "";
      }

      const kitToken = zego.generateKitTokenForProduction(
        videoSession.app_id,
        videoSession.token,
        videoSession.room_id,
        videoSession.user_id,
        normalizedName
      );
      mountedInstance = zego.create(kitToken);
      zegoInstanceRef.current = mountedInstance;

      setCallState("bootstrapping");
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      if (activeJoinAttemptRef.current !== attemptId) {
        return;
      }
      if (!containerRef.current) {
        throw new Error("Call container is not ready.");
      }

      metrics.mark("room-join-start");
      setLoadingStep("entering-room");
      mountedInstance.joinRoom({
        container: containerRef.current,
        // Skip ZEGO pre-join because this page already handles name and media choices.
        showPreJoinView: false,
        backgroundUrl: PATIENT_ROOM_BACKGROUND_URL,
        showRoomDetailsButton: false,
        showTextChat: false,
        showUserList: false,
        showLayoutButton: false,
        // Respect patient preference
        turnOnCameraWhenJoining: cameraEnabled,
        turnOnMicrophoneWhenJoining: microphoneEnabled,
        useFrontFacingCamera: true,
        // Keep patient publishing on a more stable mobile-friendly resolution.
        videoCodec: MEETING_VIDEO_CODEC,
        videoResolutionDefault: getDefaultZegoVideoResolution(zego, {
          networkProfile,
          audience: "patient",
        }),
        videoScreenConfig: {
          objectFit: "cover",
        },
        scenario: {
          mode: zego.VideoConference,
        },
      });
      if (activeJoinAttemptRef.current !== attemptId) {
        return;
      }
      setCallState("in-room");
      metrics.mark("room-join-end");
      metrics.measure("room-join", "room-join-start", "room-join-end");
      metrics.recordSummary({
        route: "patient-join",
        status: "success",
        meetingId: meetingId || null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to join call.";
      metrics.recordSummary({
        route: "patient-join",
        status: "failed",
        meetingId: meetingId || null,
        errorMessage: message,
      });
      if (mountedInstance?.destroy) {
        mountedInstance.destroy();
      }
      if (zegoInstanceRef.current === mountedInstance) {
        zegoInstanceRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.textContent = "";
      }
      setCallState("prejoin");
      setError(message);
    } finally {
      if (activeJoinAttemptRef.current === attemptId) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    return () => {
      activeJoinAttemptRef.current += 1;
      if (zegoInstanceRef.current?.destroy) {
        zegoInstanceRef.current.destroy();
      }
      zegoInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isInRoom || (!inviteToken && !shortCode)) {
      return;
    }

    let disposed = false;
    let presenceStarted = false;
    const payload = {
      meetingId: meetingId || undefined,
      inviteToken: inviteToken || undefined,
      shortCode: shortCode || undefined,
    };

    const sendHeartbeat = async () => {
      if (disposed) return;
      try {
        await heartbeatPatientMeetingPresence(payload);
        presenceStarted = true;
      } catch {
        // Best-effort heartbeat.
      }
    };

    const sendLeave = () => {
      if (disposed || !presenceStarted) return;
      void leavePatientMeetingPresence(payload).catch(() => {
        // Best-effort leave marker.
      });
    };

    void sendHeartbeat();
    const interval = window.setInterval(
      () => {
        void sendHeartbeat();
      },
      PATIENT_PRESENCE_HEARTBEAT_INTERVAL_MS
    );
    window.addEventListener("pagehide", sendLeave);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", sendLeave);
      sendLeave();
      disposed = true;
    };
  }, [isInRoom, meetingId, inviteToken, shortCode]);

  useEffect(() => {
    if (!isInRoom) {
      setShowResumeButton(false);
      return;
    }

    let disposed = false;

    const attemptResume = async () => {
      const ok = await resumeAllMediaPlayback();
      if (!disposed) {
        setShowResumeButton(!ok);
      }
    };

    const onGesture = () => {
      void attemptResume();
    };

    void attemptResume();
    const timer = window.setInterval(() => {
      void attemptResume();
    }, 2500);
    window.addEventListener("touchend", onGesture, { passive: true });
    window.addEventListener("click", onGesture);
    document.addEventListener("visibilitychange", onGesture);

    // Actively seek and destroy Zego's "Media play failed" overlay.
    // We already handle playback resumes transparently on touch.
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            // Zego's overlay tends to be a distinct popup.
            // Search text precisely to avoid hiding parent container layers.
            const textNodes = Array.from(el.querySelectorAll("*")).filter(
              (n) =>
                n.childNodes.length > 0 &&
                n.textContent?.includes("Media play failed")
            );
            
            for (const textParent of textNodes) {
              const text = textParent.textContent || "";
              if (text.includes("Media play failed") && text.includes("Resume")) {
                // If it's a small popup wrapper, its total text length won't be huge.
                if (text.length < 200) {
                  const popup = textParent as HTMLElement;
                  popup.style.setProperty("display", "none", "important");
                  const btn = popup.querySelector("button") || popup.parentElement?.querySelector("button");
                  if (btn && !btn.dataset.autoClicked) {
                    btn.dataset.autoClicked = "true";
                    btn.click();
                  }
                }
              }
            }
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      window.clearInterval(timer);
      observer.disconnect();
      window.removeEventListener("touchend", onGesture);
      window.removeEventListener("click", onGesture);
      document.removeEventListener("visibilitychange", onGesture);
    };
  }, [isInRoom]);
  const loadingTitle = (() => {
    if (loadingStep === "checking-media") {
      return "Preparing camera and microphone";
    }
    if (loadingStep === "connecting-room") {
      return "Connecting your private room";
    }
    if (loadingStep === "loading-video") {
      return "Loading secure video";
    }
    return "Entering the consultation room";
  })();
  const loadingDescription = (() => {
    if (loadingStep === "checking-media") {
      return "We are checking your device first so camera and mic can recover more smoothly inside the room.";
    }
    if (loadingStep === "connecting-room") {
      return "Your invite is being verified and a secure room token is being created.";
    }
    if (loadingStep === "loading-video") {
      return "The video engine is loading now. This may take longer on slower internet.";
    }
    return "Final room controls are being prepared before the call appears.";
  })();
  const loadingHint = isSlowLoading
    ? "Your connection looks slow, so we are starting with a lighter video profile first."
    : isSlowNetwork
      ? "Slow-network mode is on to reduce startup time."
      : null;
  return (
    <main className="min-h-[100dvh] bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col lg:min-h-0 lg:px-6 lg:py-6">
        {!showCallSurface ? (
          <section className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950 lg:h-[min(760px,calc(100dvh-3rem))] lg:rounded-[28px] lg:border lg:border-white/10 lg:shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
            <div className="grid h-full grid-rows-[minmax(240px,38dvh)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:grid-rows-1">
              <div className="relative flex min-h-0 flex-col justify-between overflow-hidden bg-transparent lg:border-r lg:border-white/5 px-4 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6 lg:px-8 lg:pb-8 lg:pt-8">
                <div className="absolute inset-0 bg-gradient-to-b from-blue-900/10 to-transparent pointer-events-none" />
                
                <div className="relative z-10 flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400 sm:px-3 sm:text-xs">
                      <Video className="size-3 sm:size-3.5" />
                      <span className="hidden sm:inline">Patient video room</span>
                      <span className="sm:hidden">Video room</span>
                    </span>
                  </div>
                  <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-400 sm:px-3 sm:text-xs shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                    Secure join
                  </div>
                </div>

                <div className="relative z-10 flex flex-1 items-center justify-center py-4 sm:py-6 lg:py-8">
                  <div className="flex h-full min-h-[138px] w-full max-w-[332px] items-center justify-center rounded-[32px] border border-white/10 bg-white/[0.02] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl ring-1 ring-white/5 px-5 py-4 sm:min-h-[190px] sm:max-w-[392px] sm:px-6 sm:py-5 transition-all duration-500 hover:bg-white/[0.04]">
                    <div className="text-center">
                      {cameraEnabled ? (
                        <div className="relative mx-auto mb-3 size-9 sm:size-11">
                          <div className="absolute inset-0 animate-ping rounded-full bg-blue-500/20" />
                          <Camera className="relative size-full text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]" />
                        </div>
                      ) : (
                        <CameraOff className="mx-auto mb-3 size-9 text-slate-500/70 sm:size-11" />
                      )}
                      <p className="text-xl font-medium text-slate-200 sm:text-2xl">
                        {cameraEnabled ? "Camera ready" : "Camera is off"}
                      </p>
                      <p className="mt-1.5 text-xs leading-5 text-slate-400 sm:mt-2 sm:text-sm">
                        {cameraEnabled
                          ? "Your camera will turn on after you join."
                          : "Join muted first and turn on later."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="relative z-10 flex items-center justify-center gap-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:pb-0">
                  <PatientDeviceToggleButton
                    active={cameraEnabled}
                    activeLabel="Camera on"
                    inactiveLabel="Camera off"
                    activeIcon={Camera}
                    inactiveIcon={CameraOff}
                    onClick={() => {
                      setCameraEnabled((current) => !current);
                    }}
                  />
                  <PatientDeviceToggleButton
                    active={microphoneEnabled}
                    activeLabel="Microphone on"
                    inactiveLabel="Microphone off"
                    activeIcon={Mic}
                    inactiveIcon={MicOff}
                    onClick={() => {
                      setMicrophoneEnabled((current) => !current);
                    }}
                  />
                </div>
              </div>

              <div className="flex min-h-0 items-center bg-slate-950 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-slate-200 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
                <div className="mx-auto flex w-full max-w-md flex-col gap-5 sm:gap-6">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-medium text-blue-400 sm:px-3 sm:text-xs">
                      <ShieldCheck className="size-3 sm:size-3.5" />
                      Protected call link
                    </div>
                    <div>
                      <h1 className="text-[1.9rem] font-medium tracking-tight text-white sm:text-4xl">
                        Join Room
                      </h1>
                      <p className="mt-1.5 text-sm leading-5 text-slate-400 sm:mt-2 sm:leading-6">
                        Enter your name, then tap join. You can turn on the camera and microphone later in the room.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="patient-display-name" className="text-sm font-medium text-slate-300 ml-1">
                      Your name
                    </label>
                    <Input
                      id="patient-display-name"
                      value={displayName}
                      onChange={(event) => {
                        setDisplayName(event.target.value);
                      }}
                      maxLength={60}
                      placeholder="e.g. Anthony Rice"
                      className="h-12 rounded-2xl border-white/10 bg-white/5 text-white placeholder:text-slate-500 shadow-inner focus-visible:ring-1 focus-visible:ring-blue-500/50 sm:h-14 sm:text-lg px-4"
                      autoComplete="name"
                    />
                  </div>

                  {error ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200 backdrop-blur-sm">
                      {error}
                    </div>
                  ) : null}

                  <Button
                    onClick={() => {
                      void handleJoin();
                    }}
                    disabled={loading || !displayName.trim()}
                    className="h-12 w-full rounded-2xl bg-blue-600 font-medium text-white shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:bg-blue-500 hover:shadow-[0_0_30px_rgba(37,99,235,0.6)] sm:h-14 sm:text-lg transition-all duration-300 disabled:opacity-50 disabled:shadow-none"
                  >
                    {loading ? "Joining..." : "Join"}
                  </Button>

                  <p className="text-[11px] leading-4 text-slate-500 sm:text-xs sm:leading-5 text-center mt-2">
                    If camera or microphone does not start right away, you can enable it from the in-call controls.
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {isInRoom ? (
          <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex items-start justify-between gap-3 px-4 pb-6 pt-4 sm:px-6 lg:px-8">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="pointer-events-auto h-7 rounded-full border border-white/20 bg-white/10 px-2.5 text-[11px] font-medium text-white shadow-sm backdrop-blur-md hover:bg-white/20 focus-visible:ring-white/60"
                onClick={async () => {
                  try {
                    if (document.pictureInPictureElement) {
                      await document.exitPictureInPicture();
                    } else {
                      const videos = Array.from(document.querySelectorAll("video"));
                      const validVideos = videos.filter(
                        (v) => v.readyState >= 1 && !v.disablePictureInPicture
                      );
                      const activeVideo = validVideos.find((v) => !v.muted) || validVideos[0];
                      if (activeVideo) {
                        await activeVideo.requestPictureInPicture();
                      } else {
                        toast.warning("ยังไม่มีวิดีโอสำหรับ PiP", {
                          description:
                            "กรุณารอให้อีกฝ่ายเปิดกล้องก่อน แล้วลองเปิดจอย่ออีกครั้ง",
                        });
                      }
                    }
                  } catch (err: unknown) {
                    const errorName =
                      err instanceof Error ? err.name : "";
                    if (errorName === "InvalidStateError") {
                      toast.error("ยังเปิดจอย่อไม่ได้", {
                        description:
                          "กรุณารอให้อีกฝ่ายเปิดกล้องและรอให้วิดีโอโหลดก่อน แล้วลองใหม่อีกครั้ง",
                      });
                    } else if (errorName === "NotSupportedError") {
                      toast.info("อุปกรณ์นี้ไม่รองรับ PiP", {
                        description:
                          "เบราว์เซอร์หรืออุปกรณ์นี้ยังไม่รองรับการแสดงภาพซ้อนภาพ",
                      });
                    } else {
                      toast.error("ไม่สามารถเปิดจอย่อได้", {
                        description: "โปรดลองอีกครั้งในอีกสักครู่",
                      });
                    }
                  }
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Maximize2Icon
                    size={14}
                    className="shrink-0 text-white/90"
                    aria-hidden="true"
                  />
                  <span>จอย่อ (PiP)</span>
                </span>
              </Button>
            </div>
          </div>
        ) : null}

        {isInRoom && error ? (
          <div className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl border border-red-400/25 bg-slate-950/84 p-3 text-sm text-red-200 shadow-[0_18px_48px_rgba(0,0,0,0.45)] backdrop-blur-md sm:left-auto sm:right-4 sm:w-[min(420px,calc(100vw-2rem))]">
            {error}
          </div>
        ) : null}

        {isInRoom && showResumeButton ? (
          <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-4 sm:right-auto sm:w-auto">
            <Button
              variant="secondary"
              className="w-full border border-white/10 bg-slate-950/84 text-slate-100 shadow-[0_18px_48px_rgba(0,0,0,0.45)] backdrop-blur-md hover:bg-slate-900 sm:w-auto"
              onClick={() => {
                void resumeAllMediaPlayback().then((ok) => {
                  setShowResumeButton(!ok);
                });
              }}
            >
              Resume Audio/Video
            </Button>
          </div>
        ) : null}

        <div
          className={
            showCallSurface
              ? "fixed inset-0 z-40 overflow-hidden bg-slate-950"
              : "hidden"
          }
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-[linear-gradient(180deg,rgba(2,6,23,0.52),rgba(2,6,23,0))]" />
          {loading ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/62 p-4">
              <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-slate-950/84 p-5 text-white shadow-[0_24px_72px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-blue-200/80">
                  Secure join
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  {overallTimedOut ? "Connection is taking too long" : loadingTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {overallTimedOut
                    ? "We could not connect your call in time. Please check your internet and try again."
                    : loadingDescription}
                </p>
                <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={[
                      "h-full rounded-full bg-blue-500 transition-all duration-500",
                      loadingStep === "checking-media"
                        ? "w-[28%]"
                        : loadingStep === "connecting-room"
                          ? "w-[55%]"
                          : loadingStep === "loading-video"
                            ? "w-[78%]"
                            : "w-[92%]",
                    ].join(" ")}
                  />
                  {/* Indeterminate shimmer so patients see movement even when progress pauses */}
                  <div
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
                    style={{ animation: "shimmer 1.8s ease-in-out infinite" }}
                  />
                  <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
                </div>
                {loadingHint ? (
                  <p className="mt-3 text-xs leading-5 text-blue-100/78">
                    {loadingHint}
                  </p>
                ) : null}
                {stageStuck || overallTimedOut ? (
                  <p className="mt-3 text-xs leading-5 text-amber-200/80">
                    {overallTimedOut
                      ? "Timed out \u2014 please go back and try joining again."
                      : "This step is taking longer than usual. Please wait or try joining again."}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <div ref={containerRef} className="relative z-0 h-full w-full" />
        </div>
      </div>
    </main>
  );
}

export default function PatientJoinPage() {
  return (
    <Suspense
      fallback={<PatientJoinLoadingShell />}
    >
      <PatientJoinPageContent />
    </Suspense>
  );
}
