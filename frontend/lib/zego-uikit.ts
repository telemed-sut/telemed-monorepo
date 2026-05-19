import type { ZegoUIKitPrebuilt } from "@zegocloud/zego-uikit-prebuilt";

import { generateSecureId } from "@/lib/secure-random";

export type ZegoUIKitPrebuiltInstance = ZegoUIKitPrebuilt;
export type ZegoUIKitPrebuiltStatic = typeof ZegoUIKitPrebuilt;

declare global {
  interface Window {
    ZegoUIKitPrebuilt?: ZegoUIKitPrebuiltStatic;
    __telemedZegoRuntimeGuardInstalled?: boolean;
  }
}

let zegoModulePromise: Promise<ZegoUIKitPrebuiltStatic> | null = null;

function stringifyRuntimeErrorReason(reason: unknown): string {
  if (typeof reason === "string") {
    return reason;
  }
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`;
  }
  if (reason && typeof reason === "object") {
    const record = reason as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const message = typeof record.message === "string" ? record.message : "";
    const stack = typeof record.stack === "string" ? record.stack : "";
    return `${name} ${message}\n${stack}`.trim();
  }
  return String(reason);
}

export function isZegoTelemetryCreateSpanNullError(reason: unknown): boolean {
  const normalized = stringifyRuntimeErrorReason(reason).toLowerCase();
  return (
    normalized.includes("cannot read properties of null") &&
    normalized.includes("createspan")
  );
}

export function installZegoRuntimeErrorGuard(): void {
  if (typeof window === "undefined" || window.__telemedZegoRuntimeGuardInstalled) {
    return;
  }

  window.__telemedZegoRuntimeGuardInstalled = true;

  const suppressEvent = (
    event: Event & {
      error?: unknown;
      reason?: unknown;
      message?: string;
    }
  ) => {
    const reason = event.error ?? event.reason ?? event.message;
    if (!isZegoTelemetryCreateSpanNullError(reason)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener("error", suppressEvent, true);
  window.addEventListener("unhandledrejection", suppressEvent, true);
}

function runZegoCallbackSafely<T extends unknown[]>(
  callback: (...args: T) => void,
  args: T
): void {
  try {
    callback(...args);
  } catch (error: unknown) {
    if (isZegoTelemetryCreateSpanNullError(error)) {
      return;
    }
    throw error;
  }
}

export function destroyZegoInstanceSafely(
  instance: Pick<ZegoUIKitPrebuiltInstance, "destroy">
): void {
  if (typeof window === "undefined") {
    instance.destroy();
    return;
  }

  installZegoRuntimeErrorGuard();

  const originalSetTimeout = window.setTimeout.bind(window);
  const wrappedSetTimeout = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (typeof handler === "function") {
      return originalSetTimeout(
        () => runZegoCallbackSafely(handler as (...args: unknown[]) => void, args),
        timeout
      );
    }

    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof window.setTimeout;

  window.setTimeout = wrappedSetTimeout;
  try {
    instance.destroy();
  } catch (error: unknown) {
    if (!isZegoTelemetryCreateSpanNullError(error)) {
      throw error;
    }
  } finally {
    window.setTimeout = originalSetTimeout as typeof window.setTimeout;
  }
}

type NavigatorConnection = {
  effectiveType?: string;
  saveData?: boolean;
};

type NavigatorWithConnection = Navigator & {
  connection?: NavigatorConnection;
  mozConnection?: NavigatorConnection;
  webkitConnection?: NavigatorConnection;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export type CallNetworkProfile = "slow" | "standard";

// ── Timeout + Retry Utilities ──────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const ZEGO_SDK_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_ATTEMPTS = 1;
const RETRY_BASE_DELAY_MS = 1_500;

/**
 * Wraps a promise with a timeout guard.
 * Rejects with a descriptive error if the promise takes longer than `ms`.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "Operation"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
      }
    }, ms);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      }
    );
  });
}

export function markPromiseHandled<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}

/**
 * Returns true when the rejection looks like a transient network problem
 * (fetch TypeError, timeout, or 5xx) — safe to retry.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch network failure
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("timed out") ||
      msg.includes("network") ||
      msg.includes("failed to fetch") ||
      msg.includes("load failed") ||
      msg.includes("aborted")
    );
  }
  return false;
}

/**
 * Retries a thunk up to `attempts` times on retryable errors.
 * Uses exponential backoff starting at RETRY_BASE_DELAY_MS.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = DEFAULT_RETRY_ATTEMPTS,
  _label = "Operation"
): Promise<T> {
  void _label;
  let lastError: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (i < attempts && isRetryableError(error)) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// ── Startup Metrics ──────────────────────────────────────────

export interface StartupStageTimings {
  mediaWarmupMs: number | null;
  apiTokenMs: number | null;
  sdkLoadMs: number | null;
  roomJoinMs: number | null;
  totalMs: number | null;
  networkProfile: CallNetworkProfile;
  audience: "doctor" | "patient";
}

export interface CallStartupRecord extends StartupStageTimings {
  id: string;
  recordedAt: string;
  status: "success" | "failed";
  route: "doctor-call" | "patient-join";
  meetingId?: string | null;
  errorMessage?: string | null;
}

const CALL_STARTUP_HISTORY_STORAGE_KEY = "telemed.call-startup-history";
const CALL_STARTUP_HISTORY_LIMIT = 30;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function generateCallStartupRecordId(): string {
  return generateSecureId();
}

function parseCallStartupHistory(raw: string | null): CallStartupRecord[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CallStartupRecord[]) : [];
  } catch {
    return [];
  }
}

export function readCallStartupHistory(): CallStartupRecord[] {
  if (!canUseStorage()) {
    return [];
  }

  return parseCallStartupHistory(window.localStorage.getItem(CALL_STARTUP_HISTORY_STORAGE_KEY));
}

export function clearCallStartupHistory(): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(CALL_STARTUP_HISTORY_STORAGE_KEY);
}

export function recordCallStartupHistory(
  record: Omit<CallStartupRecord, "id" | "recordedAt">
): CallStartupRecord {
  const nextRecord: CallStartupRecord = {
    ...record,
    id: generateCallStartupRecordId(),
    recordedAt: new Date().toISOString(),
  };

  if (!canUseStorage()) {
    return nextRecord;
  }

  const current = readCallStartupHistory();
  const next = [nextRecord, ...current].slice(0, CALL_STARTUP_HISTORY_LIMIT);
  window.localStorage.setItem(CALL_STARTUP_HISTORY_STORAGE_KEY, JSON.stringify(next));
  return nextRecord;
}

export class CallStartupMetrics {
  private marks = new Map<string, number>();
  private durations = new Map<string, number>();
  private audience: "doctor" | "patient";
  private networkProfile: CallNetworkProfile;

  constructor(audience: "doctor" | "patient", networkProfile: CallNetworkProfile) {
    this.audience = audience;
    this.networkProfile = networkProfile;
    this.mark("start");
  }

  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  measure(name: string, startMark: string, endMark?: string): number {
    const start = this.marks.get(startMark);
    const end = endMark ? this.marks.get(endMark) : performance.now();
    if (start == null || end == null) return -1;
    const duration = Math.round(end - start);
    this.durations.set(name, duration);
    return duration;
  }

  summarize(): StartupStageTimings {
    return {
      mediaWarmupMs: this.durations.get("media-warmup") ?? null,
      apiTokenMs: this.durations.get("api-token") ?? null,
      sdkLoadMs: this.durations.get("sdk-load") ?? null,
      roomJoinMs: this.durations.get("room-join") ?? null,
      totalMs: this.durations.get("total") ?? null,
      networkProfile: this.networkProfile,
      audience: this.audience,
    };
  }

  logSummary(): void {
    this.measure("total", "start");
  }

  recordSummary(options: {
    route: "doctor-call" | "patient-join";
    status: "success" | "failed";
    meetingId?: string | null;
    errorMessage?: string | null;
  }): CallStartupRecord {
    this.measure("total", "start");
    const summary = this.summarize();
    const record = recordCallStartupHistory({
      ...summary,
      route: options.route,
      status: options.status,
      meetingId: options.meetingId ?? null,
      errorMessage: options.errorMessage ?? null,
    });
    return record;
  }
}

// ── Adaptive Warmup Helpers ──────────────────────────────────

/**
 * Returns true when the current browser is iOS Safari.
 * Only iOS Safari requires the 800ms hardware release delay.
 */
export function detectIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iP(hone|ad|od)/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS|Chrome/.test(ua);
  return isIos && isSafari;
}

/**
 * Returns getUserMedia constraints adapted to the network profile.
 * Slow networks use 320×240 to minimize device initialization time.
 */
export function getAdaptiveMediaConstraints(
  networkProfile: CallNetworkProfile
): MediaStreamConstraints {
  if (networkProfile === "slow") {
    return {
      video: { facingMode: "user", width: 320, height: 240 },
      audio: true,
    };
  }
  return {
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: true,
  };
}

/**
 * How long to wait for iOS Safari to release the hardware lock.
 * Non-Safari browsers don't need this delay at all.
 */
export function getMediaReleaseDelay(): number {
  return detectIosSafari() ? 800 : 50;
}

// ── ZEGO SDK Load ──────────────────────────────────────────

export async function loadZegoUIKitPrebuilt(): Promise<ZegoUIKitPrebuiltStatic> {
  if (typeof window === "undefined") {
    throw new Error("Browser environment is required.");
  }

  installZegoRuntimeErrorGuard();

  if (window.ZegoUIKitPrebuilt) {
    return window.ZegoUIKitPrebuilt;
  }

  if (!zegoModulePromise) {
    zegoModulePromise = withTimeout(
      import("@zegocloud/zego-uikit-prebuilt")
        .then((mod) => {
          if (!mod.ZegoUIKitPrebuilt) {
            throw new Error("ZEGO UIKit bundle loaded but export is missing.");
          }
          window.ZegoUIKitPrebuilt = mod.ZegoUIKitPrebuilt;
          return mod.ZegoUIKitPrebuilt;
        }),
      ZEGO_SDK_LOAD_TIMEOUT_MS,
      "ZEGO SDK load"
    ).catch((error: unknown) => {
      zegoModulePromise = null;
      throw error instanceof Error
        ? error
        : new Error("Unable to load ZEGO UIKit bundle.");
    });
  }

  return zegoModulePromise;
}

export function preloadZegoUIKitPrebuilt(): void {
  if (typeof window === "undefined") {
    return;
  }

  installZegoRuntimeErrorGuard();

  void loadZegoUIKitPrebuilt().catch(() => {
    // Ignore prefetch failures; the real join flow will surface user-facing errors.
  });
}

export function scheduleZegoUIKitPreload(options?: {
  enabled?: boolean;
  timeoutMs?: number;
  fallbackDelayMs?: number;
}): () => void {
  if (typeof window === "undefined" || options?.enabled === false) {
    return () => {};
  }

  const idleWindow = window as WindowWithIdleCallback;
  const timeoutMs = options?.timeoutMs ?? 2_000;
  const fallbackDelayMs = options?.fallbackDelayMs ?? 1_200;

  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(() => {
      preloadZegoUIKitPrebuilt();
    }, { timeout: timeoutMs });

    return () => {
      idleWindow.cancelIdleCallback?.(handle);
    };
  }

  const timer = window.setTimeout(() => {
    preloadZegoUIKitPrebuilt();
  }, fallbackDelayMs);

  return () => {
    window.clearTimeout(timer);
  };
}

// ── Network Profile ──────────────────────────────────────────

export function getCallNetworkProfile(): CallNetworkProfile {
  if (typeof navigator === "undefined") {
    return "standard";
  }

  const connection =
    (navigator as NavigatorWithConnection).connection ||
    (navigator as NavigatorWithConnection).mozConnection ||
    (navigator as NavigatorWithConnection).webkitConnection;

  if (connection?.saveData) {
    return "slow";
  }

  const effectiveType = connection?.effectiveType?.toLowerCase() || "";
  if (
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    effectiveType === "3g"
  ) {
    return "slow";
  }

  return "standard";
}

// ── Video Resolution ──────────────────────────────────────────

export function getDefaultZegoVideoResolution(
  zego: ZegoUIKitPrebuiltStatic,
  options?: {
    networkProfile?: CallNetworkProfile;
    audience?: "doctor" | "patient";
  }
) {
  const networkProfile = options?.networkProfile ?? "standard";
  const audience = options?.audience ?? "doctor";

  if (networkProfile === "slow") {
    return zego.VideoResolution_360P;
  }

  if (audience === "patient") {
    return zego.VideoResolution_480P;
  }

  return zego.VideoResolution_720P;
}

// ── Constants re-exported for pages ──────────────────────────

export { DEFAULT_TIMEOUT_MS as API_TIMEOUT_MS };
