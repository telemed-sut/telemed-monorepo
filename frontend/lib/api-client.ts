import type { LoginResponse } from "./api-types";

// Browser requests should always use the Next.js same-origin proxy to avoid
// local-dev CORS drift between frontend and backend runtime environments.
export const API_BASE_URL =
  typeof window !== "undefined"
    ? "/api"
    : (
      process.env.NEXT_SERVER_API_BASE_URL ||
      process.env.NEXT_SERVER_API_PROXY_TARGET ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://localhost:8000"
    );

export type ApiError = Error & { status?: number; detail?: unknown; code?: string };
export type ApiLanguage = "en" | "th";
export type AuthErrorContext = "login" | "step-up" | "forgot-password" | "reset-password";
export type LoginRedirectReason = "token_expired" | "refresh_failed" | "session_missing";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
export const MAX_QUERY_LIMIT = 200;
const DEFAULT_ERROR_MESSAGE_TH = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
const COOKIE_SESSION_TOKEN = "__cookie_session__";

const INTERNAL_ERROR_PATTERN =
  /(traceback|pydantic|validationerror|sqlalchemy|stack trace|line \d+|value_error|type_error)/i;

const TRANSLATED_MESSAGE_RULES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /access denied|permission denied|forbidden/i, message: "คุณไม่มีสิทธิ์ทำรายการนี้" },
  {
    pattern: /temporarily blocked due to too many failed login attempts|your ip has been temporarily blocked|access denied\.\s*your ip has been temporarily blocked/i,
    message: "IP ของคุณถูกบล็อกชั่วคราวจากการพยายามเข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่",
  },
  {
    pattern: /doctors?\s+can\s+only\s+create\s+meetings?\s+for\s+assigned\s+patients?\.?/i,
    message: "แพทย์สามารถสร้างนัดหมายได้เฉพาะผู้ป่วยที่ได้รับมอบหมายเท่านั้น",
  },
  { pattern: /super admin only/i, message: "รายการนี้ทำได้เฉพาะผู้ดูแลระดับสูงเท่านั้น" },
  { pattern: /security admin only/i, message: "รายการนี้ทำได้เฉพาะผู้ดูแลด้านความปลอดภัยเท่านั้น" },
  { pattern: /recent multi-factor verification required/i, message: "ต้องยืนยันตัวตนแบบหลายปัจจัยใหม่อีกครั้งก่อนทำรายการนี้" },
  { pattern: /user not found|not found/i, message: "ไม่พบข้อมูลผู้ใช้ที่ต้องการ" },
  { pattern: /already exists|already in use|already assigned/i, message: "ข้อมูลนี้มีอยู่แล้วในระบบ" },
  { pattern: /confirm_text=\"?purge\"?/i, message: "ต้องพิมพ์คำยืนยัน PURGE ก่อนดำเนินการ" },
  { pattern: /confirm_text=\"?delete\"?/i, message: "ต้องพิมพ์คำยืนยัน DELETE ก่อนดำเนินการ" },
  { pattern: /reason must be at least|purge reason must be at least/i, message: "เหตุผลต้องมีอย่างน้อย 8 ตัวอักษร" },
  { pattern: /temporary password must be at least/i, message: "รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร" },
  { pattern: /invite onboarding is restricted to supported roles in this phase|supported invite roles/i, message: "ขณะนี้ระบบอนุญาตส่งคำเชิญเฉพาะบทบาทที่รองรับเท่านั้น" },
  { pattern: /invite.*expired|expired invite|link.*expired/i, message: "คำเชิญนี้หมดอายุแล้ว กรุณาสร้างลิงก์คำเชิญใหม่" },
  { pattern: /invite.*closed|invite.*revoked|already revoked/i, message: "คำเชิญนี้ไม่อยู่ในสถานะใช้งานแล้ว" },
  { pattern: /too many requests|rate limit/i, message: "คุณทำรายการถี่เกินไป กรุณาลองใหม่อีกครั้ง" },
  { pattern: /network error|failed to fetch|network request failed/i, message: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" },
  { pattern: /invalid credentials|incorrect password/i, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
  { pattern: /invalid two-factor authentication code/i, message: "รหัส 2FA หรือ Backup Code ไม่ถูกต้อง" },
  { pattern: /organization sso|admin account must continue with organization sso/i, message: "บัญชีผู้ดูแลต้องเข้าสู่ระบบผ่าน Organization SSO" },
];

const AUTH_ERROR_FALLBACKS: Record<AuthErrorContext, Record<ApiLanguage, string>> = {
  login: {
    en: "Unable to sign in. Please try again.",
    th: "ไม่สามารถเข้าสู่ระบบได้ โปรดลองอีกครั้ง",
  },
  "step-up": {
    en: "Unable to confirm your identity. Please try again.",
    th: "ไม่สามารถยืนยันตัวตนได้ โปรดลองอีกครั้ง",
  },
  "forgot-password": {
    en: "Unable to send reset link. Please try again.",
    th: "ไม่สามารถส่งลิงก์รีเซ็ตรหัสผ่านได้ โปรดลองอีกครั้ง",
  },
  "reset-password": {
    en: "Unable to update password. Please try again.",
    th: "ไม่สามารถอัปเดตรหัสผ่านได้ โปรดลองอีกครั้ง",
  },
};

const AUTH_ERROR_RULES: Array<{
  contexts: AuthErrorContext[];
  codes?: string[];
  statuses?: number[];
  patterns?: RegExp[];
  messages: Record<ApiLanguage, string>;
}> = [
  {
    contexts: ["login"],
    codes: ["invalid_credentials", "incorrect_email_or_password"],
    patterns: [/invalid credentials|incorrect password|incorrect email or password|password is incorrect/i],
    messages: {
      en: "Email or password is incorrect.",
      th: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    },
  },
  {
    contexts: ["step-up"],
    codes: ["invalid_credentials", "incorrect_email_or_password"],
    patterns: [/invalid credentials|incorrect password|incorrect email or password|password is incorrect/i],
    messages: {
      en: "Password for this account is incorrect.",
      th: "รหัสผ่านของบัญชีนี้ไม่ถูกต้อง",
    },
  },
  {
    contexts: ["login"],
    codes: ["admin_sso_required"],
    patterns: [/organization sso|admin account must continue with organization sso/i],
    messages: {
      en: "Please continue with Organization SSO.",
      th: "กรุณาเข้าสู่ระบบผ่าน Organization SSO",
    },
  },
  {
    contexts: ["login", "step-up"],
    patterns: [/invalid two-factor authentication code|invalid two-factor code/i],
    messages: {
      en: "Authenticator code or backup code is incorrect.",
      th: "รหัสจากแอปยืนยันตัวตนหรือรหัสสำรองไม่ถูกต้อง",
    },
  },
  {
    contexts: ["step-up"],
    codes: ["step_up_not_supported_for_sso"],
    patterns: [/step-up verification is not available for organization sso sessions/i],
    messages: {
      en: "Please refresh your organization sign-in first.",
      th: "กรุณายืนยันการเข้าสู่ระบบขององค์กรอีกครั้งก่อน",
    },
  },
  {
    contexts: ["login"],
    patterns: [
      /temporarily blocked due to too many failed login attempts|your ip has been temporarily blocked|access denied\.\s*your ip has been temporarily blocked/i,
    ],
    messages: {
      en: "Too many attempts. Please wait and try again.",
      th: "พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
    },
  },
  {
    contexts: ["forgot-password", "reset-password"],
    patterns: [/invalid or expired reset token|invalid or expired token/i],
    messages: {
      en: "This reset link is invalid or has expired.",
      th: "ลิงก์รีเซ็ตนี้ไม่ถูกต้องหรือหมดอายุแล้ว",
    },
  },
  {
    contexts: ["forgot-password", "reset-password"],
    statuses: [429],
    patterns: [/too many requests|rate limit/i],
    messages: {
      en: "Too many attempts. Please wait and try again.",
      th: "พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
    },
  },
  {
    contexts: ["login", "forgot-password", "reset-password"],
    statuses: [0],
    patterns: [/network error|failed to fetch|network request failed/i],
    messages: {
      en: "Unable to reach the server. Please check your connection and try again.",
      th: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
    },
  },
];

let refreshPromise: Promise<string | null> | null = null;

export function isProbablyJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export function clampPage(page?: number): number {
  if (!Number.isFinite(page)) return DEFAULT_PAGE;
  return Math.max(1, Math.floor(page as number));
}

export function clampLimit(limit?: number, max: number = MAX_QUERY_LIMIT): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  const normalized = Math.floor(limit as number);
  if (normalized < 1) return DEFAULT_LIMIT;
  return Math.min(normalized, max);
}

export function appendPagination(
  query: URLSearchParams,
  params: { page?: number; limit?: number },
  maxLimit: number = MAX_QUERY_LIMIT
) {
  query.append("page", clampPage(params.page).toString());
  query.append("limit", clampLimit(params.limit, maxLimit).toString());
}

export function parseApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim().length > 0) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return null;

        const record = entry as Record<string, unknown>;
        const message =
          (typeof record.msg === "string" && record.msg) ||
          (typeof record.message === "string" && record.message) ||
          null;
        if (!message) return null;
        return message;
      })
      .filter((item): item is string => Boolean(item));

    if (messages.length > 0) {
      return messages.join(" | ");
    }
    return null;
  }

  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    return (
      parseApiErrorDetail(record.detail) ||
      parseApiErrorDetail(record.message) ||
      parseApiErrorDetail(record.error)
    );
  }

  return null;
}

function extractApiErrorCode(detail: unknown): string | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const code = (detail as Record<string, unknown>).code;
  if (typeof code === "string" && code.length > 0) return code;
  return undefined;
}

function statusFallbackMessage(status?: number, fallback: string = DEFAULT_ERROR_MESSAGE_TH): string {
  if (status === 0) return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  if (status === 400) return "ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
  if (status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
  if (status === 403) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  if (status === 404) return "ไม่พบข้อมูลที่ต้องการ";
  if (status === 409) return "ข้อมูลขัดแย้งกับสถานะปัจจุบัน กรุณารีเฟรชแล้วลองใหม่";
  if (status === 423) return "บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
  if (status === 422) return "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบก่อนบันทึก";
  if (status === 429) return "คุณทำรายการถี่เกินไป กรุณาลองใหม่อีกครั้ง";
  if (typeof status === "number" && status >= 500) return "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
  return fallback;
}

function translateKnownMessage(message: string): string | null {
  const normalized = message.trim();
  if (!normalized) return null;

  for (const rule of TRANSLATED_MESSAGE_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.message;
    }
  }
  return null;
}

function sanitizeMessage(rawMessage: string | null | undefined): string | null {
  if (!rawMessage) return null;
  const trimmed = rawMessage.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  if (INTERNAL_ERROR_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function toUserFacingMessage(
  status: number | undefined,
  rawMessage: string | null | undefined,
  fallback: string = DEFAULT_ERROR_MESSAGE_TH,
): string {
  const sanitized = sanitizeMessage(rawMessage);
  if (sanitized) {
    const translated = translateKnownMessage(sanitized);
    if (translated) return translated;
    return sanitized;
  }
  return statusFallbackMessage(status, fallback);
}

export function getErrorMessage(error: unknown, fallback: string = DEFAULT_ERROR_MESSAGE_TH): string {
  if (error instanceof Error) {
    const apiError = error as ApiError;
    return toUserFacingMessage(apiError.status, apiError.message, fallback);
  }
  if (typeof error === "string") {
    return toUserFacingMessage(undefined, error, fallback);
  }
  return fallback;
}

export function getAuthErrorMessage(
  language: ApiLanguage,
  error: unknown,
  context: AuthErrorContext,
): string {
  const fallback = AUTH_ERROR_FALLBACKS[context][language];

  if (!(error instanceof Error)) {
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    return fallback;
  }

  const apiError = error as ApiError;
  const detailCode = extractApiErrorCode(apiError.detail)?.toLowerCase();
  const detailMessage = parseApiErrorDetail(apiError.detail);
  const rawMessage = sanitizeMessage(detailMessage) || sanitizeMessage(apiError.message) || "";

  for (const rule of AUTH_ERROR_RULES) {
    if (!rule.contexts.includes(context)) {
      continue;
    }

    const hasCodeRule = Boolean(rule.codes?.length);
    const hasStatusRule = Boolean(rule.statuses?.length);
    const hasPatternRule = Boolean(rule.patterns?.length);
    const codeMatch = hasCodeRule && detailCode ? rule.codes!.includes(detailCode) : false;
    const statusMatch =
      hasStatusRule && typeof apiError.status === "number"
        ? rule.statuses!.includes(apiError.status)
        : false;
    const patternMatch = hasPatternRule
      ? rule.patterns!.some((pattern) => pattern.test(rawMessage))
      : false;
    const primaryMatch =
      hasCodeRule || hasPatternRule
        ? codeMatch || patternMatch
        : statusMatch;
    const statusAllowed = !hasStatusRule || statusMatch;

    if (primaryMatch && statusAllowed) {
      return rule.messages[language];
    }
  }

  if (rawMessage && rawMessage !== AUTH_ERROR_FALLBACKS[context].en && rawMessage !== AUTH_ERROR_FALLBACKS[context].th) {
    return rawMessage;
  }

  return fallback;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (raw.length % 4 !== 0) raw += "=";

    let json = "";
    if (typeof globalThis.atob === "function") {
      json = globalThis.atob(raw);
    } else if (typeof Buffer !== "undefined") {
      json = Buffer.from(raw, "base64").toString("utf8");
    } else {
      return null;
    }

    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTokenExpiring(token: string, bufferSeconds = 300): boolean {
  try {
    const payload = decodeJwtPayload(token);
    if (!payload) return false;
    const exp = payload.exp;
    if (!exp || typeof exp !== "number") return false;
    const now = Math.floor(Date.now() / 1000);
    return exp - now < bufferSeconds;
  } catch {
    return false;
  }
}

export async function rawFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<{ ok: boolean; status: number; data: T | null; error?: ApiError }> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  if (typeof window === "undefined" && token && isProbablyJwt(token)) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: "include",
      headers,
    });
  } catch (err) {
    const networkMessage =
      err instanceof TypeError ? `Network error: ${err.message}` : "Network request failed";
    const error: ApiError = new Error(toUserFacingMessage(0, networkMessage));
    error.status = 0;
    return { ok: false, status: 0, data: null, error };
  }

  if (res.status === 204) {
    return { ok: true, status: 204, data: null as T };
  }

  const contentLength = res.headers.get("content-length");
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const hasBody = contentLength !== "0" && contentLength !== null ? true : isJson;

  let data: unknown = null;
  if (hasBody && isJson) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const payload = data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};
    const detail = payload.detail;
    const rawMessage =
      parseApiErrorDetail(detail) ||
      parseApiErrorDetail(payload.message) ||
      parseApiErrorDetail(payload.error) ||
      res.statusText ||
      "Request failed";
    const error: ApiError = new Error(toUserFacingMessage(res.status, rawMessage));
    error.status = res.status;
    error.detail = detail;
    const errorCode = extractApiErrorCode(detail);
    if (errorCode) {
      error.code = errorCode;
    }
    return { ok: false, status: res.status, data: null, error };
  }

  return { ok: true, status: res.status, data: data as T };
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let activeToken = token;
  const canAttemptRefresh = Boolean(activeToken);

  if (
    canAttemptRefresh &&
    path !== "/auth/refresh" &&
    path !== "/auth/login" &&
    path !== "/auth/step-up" &&
    path !== "/auth/logout" &&
    isTokenExpiring(activeToken!)
  ) {
    const refreshed = await tryRefreshToken(activeToken);
    if (refreshed) {
      activeToken = refreshed;
    }
  }

  const result = await rawFetch<T>(path, options, activeToken);

  if (result.ok) return result.data as T;

  if (
    canAttemptRefresh &&
    result.status === 401 &&
    path !== "/auth/refresh" &&
    path !== "/auth/login" &&
    path !== "/auth/step-up" &&
    path !== "/auth/logout"
  ) {
    const newToken = await tryRefreshToken(activeToken);
    if (newToken) {
      const retry = await rawFetch<T>(path, options, newToken);
      if (retry.ok) return retry.data as T;
      if (retry.error) throw retry.error;
    }
    forceLogout();
  }

  throw result.error!;
}

export function getLoginRedirectPath(reason: LoginRedirectReason = "session_missing"): string {
  const query = new URLSearchParams({
    error: "session_expired",
    reason,
  });
  return `/login?${query.toString()}`;
}

function forceLogout(reason: LoginRedirectReason = "refresh_failed") {
  if (typeof window === "undefined") return;

  import("@/store/auth-store").then(({ useAuthStore }) => {
    try {
      useAuthStore.getState().clearToken();
    } catch {
      // ignore
    }
  }).catch(() => {
    // ignore import failures on client
  });

  window.location.href = getLoginRedirectPath(reason);
}

async function tryRefreshToken(currentToken?: string): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await rawFetch<LoginResponse>("/auth/refresh", { method: "POST" }, currentToken);
      if (res.ok && res.data?.user) {
        if (typeof window !== "undefined") {
          try {
            const { useAuthStore } = await import("@/store/auth-store");
            useAuthStore.getState().setSession(res.data);
          } catch {
            // ignore store failures
          }
        }
        return COOKIE_SESSION_TOKEN;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
