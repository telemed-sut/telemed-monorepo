"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { issuePatientMeetingVideoToken } from "@/lib/api";

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

let zegoScriptPromise: Promise<ZegoUIKitPrebuiltStatic> | null = null;

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
    normalized.includes("zego") ||
    normalized.includes("\"action\":\"zc.") ||
    normalized.includes("\"appid\":") ||
    normalized.includes("\"roomid\":") ||
    normalized.includes("cmdreq connect not establish") ||
    normalized.includes("connect not establish logout") ||
    normalized.includes("a user gesture is required") ||
    normalized.includes("notallowederror") ||
    normalized.includes("setsinkid") ||
    normalized.includes("[zegoroommobile]createstream error") ||
    normalized.includes("session request timeout") ||
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

function warmupPatientMediaDevices(): Promise<{
  allowCamera: boolean;
  allowMicrophone: boolean;
  hint: string | null;
}> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.resolve({
      allowCamera: false,
      allowMicrophone: false,
      hint: "This browser cannot access camera/microphone APIs. You can still join muted.",
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
          hint:
            "Camera/Mic permission was denied. You can still join muted, then enable permission from Safari site settings.",
        };
      }

      if (
        normalized.includes("notfounderror") ||
        normalized.includes("overconstrainederror")
      ) {
        return {
          allowCamera: false,
          allowMicrophone: false,
          hint:
            "No usable camera/mic was found on this device right now. Join muted and retry camera later.",
        };
      }

      return {
        allowCamera: false,
        allowMicrophone: false,
        hint:
          "Camera/Mic is not ready yet on this device. Joined in muted mode; tap camera/mic again in call controls.",
      };
    });
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
      "script[data-zego-uikit='true']"
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

export default function PatientJoinPage() {
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
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [showResumeButton, setShowResumeButton] = useState(false);
  const [displayName, setDisplayName] = useState(nameFromQuery);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zegoInstanceRef = useRef<ZegoUIKitPrebuiltInstance | null>(null);

  useEffect(() => {
    if (!displayName && nameFromQuery) {
      setDisplayName(nameFromQuery);
    }
  }, [displayName, nameFromQuery]);

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

    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const mediaPreference = await warmupPatientMediaDevices();
      if (mediaPreference.hint) {
        setHint(mediaPreference.hint);
      }
      const allowCameraOnJoin = mediaPreference.allowCamera && cameraEnabled;
      const allowMicrophoneOnJoin = mediaPreference.allowMicrophone && microphoneEnabled;

      const videoSession = await issuePatientMeetingVideoToken({
        meetingId: meetingId || undefined,
        inviteToken: inviteToken || undefined,
        shortCode: shortCode || undefined,
      });
      if (videoSession.provider !== "zego") {
        throw new Error("Meeting video provider is not ZEGO.");
      }
      if (!videoSession.app_id) {
        throw new Error("Missing ZEGO AppID from video session response.");
      }
      if (!containerRef.current) {
        throw new Error("Call container is not ready.");
      }

      const zego = await loadZegoUIKitScript();
      const kitToken = zego.generateKitTokenForProduction(
        videoSession.app_id,
        videoSession.token,
        videoSession.room_id,
        videoSession.user_id,
        normalizedName
      );
      const mountedInstance = zego.create(kitToken);
      zegoInstanceRef.current = mountedInstance;
      mountedInstance.joinRoom({
        container: containerRef.current,
        // Keep Zego pre-join so patient can review media state before entering.
        showPreJoinView: true,
        // Respect patient preference + actual permission availability.
        turnOnCameraWhenJoining: allowCameraOnJoin,
        turnOnMicrophoneWhenJoining: allowMicrophoneOnJoin,
        scenario: {
          mode: zego.VideoConference,
        },
      });
      setJoined(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to join call.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (zegoInstanceRef.current?.destroy) {
        zegoInstanceRef.current.destroy();
      }
      zegoInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!joined) {
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
    window.addEventListener("touchend", onGesture);
    window.addEventListener("click", onGesture);
    document.addEventListener("visibilitychange", onGesture);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("touchend", onGesture);
      window.removeEventListener("click", onGesture);
      document.removeEventListener("visibilitychange", onGesture);
    };
  }, [joined]);

  return (
    <main className="min-h-screen bg-slate-950 p-3 text-slate-100 md:p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <h1 className="text-lg font-semibold">Patient Video Room</h1>
        <p className="text-xs text-slate-400">
          Meeting: {meetingId || "-"} {shortCode ? `| Code: ${shortCode}` : ""}
        </p>

        {!joined ? (
          <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
            <p>1) Enter your name and choose camera/mic options.</p>
            <p>2) Tap Join Call.</p>
            <p>3) Allow Camera + Microphone when Safari asks.</p>
            <p>4) You can still join muted and turn on later.</p>
          </div>
        ) : null}

        {!joined ? (
          <div className="space-y-2">
            <label htmlFor="patient-display-name" className="text-xs text-slate-300">
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
              className="h-10 border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500"
              autoComplete="name"
            />
          </div>
        ) : null}

        {!joined ? (
          <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3">
            <p className="mb-2 text-xs text-slate-300">Before joining</p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-200">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-500"
                  checked={cameraEnabled}
                  onChange={(event) => {
                    setCameraEnabled(event.target.checked);
                  }}
                />
                Start with camera on
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-500"
                  checked={microphoneEnabled}
                  onChange={(event) => {
                    setMicrophoneEnabled(event.target.checked);
                  }}
                />
                Start with microphone on
              </label>
            </div>
          </div>
        ) : null}

        {hint ? (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-200">
            {hint}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {joined && showResumeButton ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
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

        {!joined ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                void handleJoin();
              }}
              disabled={loading || !displayName.trim()}
            >
              {loading ? "Joining..." : "Join Call"}
            </Button>
          </div>
        ) : null}

        <div className="relative min-h-[70vh] overflow-hidden rounded-xl border border-slate-800 bg-black">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
              Joining video room...
            </div>
          ) : null}
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>
    </main>
  );
}
