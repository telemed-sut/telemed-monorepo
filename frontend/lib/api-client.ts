import { APP_LANGUAGE_STORAGE_KEY, resolveAppLanguage, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";
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
export type ApiLanguage = AppLanguage;
export type AuthErrorContext = "login" | "step-up" | "forgot-password" | "reset-password";
export type LoginRedirectReason = "token_expired" | "refresh_failed" | "session_missing";
type RawFetchResult<T> = { ok: boolean; status: number; data: T | null; error?: ApiError };
export type ApiFetchOptions = RequestInit & { skipCache?: boolean };

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
export const MAX_QUERY_LIMIT = 200;
const DEFAULT_ERROR_MESSAGE_TH = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
const DEFAULT_ERROR_MESSAGE_EN = "Something went wrong. Please try again.";
const THAI_CHARACTER_PATTERN = /[\u0E00-\u0E7F]/;

const INTERNAL_ERROR_PATTERN =
  /(traceback|pydantic|validationerror|sqlalchemy|stack trace|line \d+|value_error|type_error)/i;

const TRANSLATED_MESSAGE_RULES: Array<{
  pattern: RegExp;
  messages: Record<ApiLanguage, string>;
}> = [
  {
    pattern: /registration challenge expired|login challenge expired|challenge expired or not found|challenge.*not found/i,
    messages: {
      en: "Passkey setup expired. Please try again.",
      th: "ขั้นตอนตั้งค่า Passkey หมดเวลาแล้ว กรุณาลองใหม่อีกครั้ง",
    },
  },
  {
    pattern: /access denied|permission denied|forbidden|คุณไม่มีสิทธิ์ทำรายการนี้/i,
    messages: {
      en: "Access denied",
      th: "คุณไม่มีสิทธิ์ทำรายการนี้",
    },
  },
  {
    pattern: /temporarily blocked due to too many failed login attempts|your ip has been temporarily blocked|access denied\.\s*your ip has been temporarily blocked/i,
    messages: {
      en: "Too many failed attempts. Please wait and try again.",
      th: "IP ของคุณถูกบล็อกชั่วคราวจากการพยายามเข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่",
    },
  },
  {
    pattern: /doctors?\s+can\s+only\s+create\s+meetings?\s+for\s+assigned\s+patients?\.?/i,
    messages: {
      en: "Doctors can only create meetings for assigned patients.",
      th: "แพทย์สามารถสร้างนัดหมายได้เฉพาะผู้ป่วยที่ได้รับมอบหมายเท่านั้น",
    },
  },
  {
    pattern: /super admin only/i,
    messages: {
      en: "This action is limited to super admins.",
      th: "รายการนี้ทำได้เฉพาะผู้ดูแลระดับสูงเท่านั้น",
    },
  },
  {
    pattern: /security admin only/i,
    messages: {
      en: "This action is limited to security admins.",
      th: "รายการนี้ทำได้เฉพาะผู้ดูแลด้านความปลอดภัยเท่านั้น",
    },
  },
  {
    pattern: /recent (?:multi-factor )?verification required/i,
    messages: {
      en: "Recent verification is required for this action.",
      th: "ต้องยืนยันตัวตนใหม่อีกครั้งก่อนทำรายการนี้",
    },
  },
  {
    pattern: /\buser not found\b|ไม่พบข้อมูลผู้ใช้ที่ต้องการ/i,
    messages: {
      en: "Requested record was not found.",
      th: "ไม่พบข้อมูลผู้ใช้ที่ต้องการ",
    },
  },
  {
    pattern: /already exists|already in use|already assigned/i,
    messages: {
      en: "This record already exists.",
      th: "ข้อมูลนี้มีอยู่แล้วในระบบ",
    },
  },
  {
    pattern: /confirm_text=\"?purge\"?/i,
    messages: {
      en: "Type PURGE to confirm this action.",
      th: "ต้องพิมพ์คำยืนยัน PURGE ก่อนดำเนินการ",
    },
  },
  {
    pattern: /confirm_text=\"?delete\"?/i,
    messages: {
      en: "Type DELETE to confirm this action.",
      th: "ต้องพิมพ์คำยืนยัน DELETE ก่อนดำเนินการ",
    },
  },
  {
    pattern: /reason must be at least|purge reason must be at least/i,
    messages: {
      en: "Reason must be at least 8 characters.",
      th: "เหตุผลต้องมีอย่างน้อย 8 ตัวอักษร",
    },
  },
  {
    pattern: /temporary password must be at least/i,
    messages: {
      en: "Temporary password must be at least 8 characters.",
      th: "รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร",
    },
  },
  {
    pattern: /invite onboarding is restricted to supported roles in this phase|supported invite roles/i,
    messages: {
      en: "Invites are currently limited to supported roles.",
      th: "ขณะนี้ระบบอนุญาตส่งคำเชิญเฉพาะบทบาทที่รองรับเท่านั้น",
    },
  },
  {
    pattern: /invite.*expired|expired invite|link.*expired/i,
    messages: {
      en: "This invite has expired. Please request a new link.",
      th: "คำเชิญนี้หมดอายุแล้ว กรุณาสร้างลิงก์คำเชิญใหม่",
    },
  },
  {
    pattern: /invite.*closed|invite.*revoked|already revoked/i,
    messages: {
      en: "This invite is no longer active.",
      th: "คำเชิญนี้ไม่อยู่ในสถานะใช้งานแล้ว",
    },
  },
  {
    pattern: /too many requests|rate limit/i,
    messages: {
      en: "Too many requests. Please try again later.",
      th: "คุณทำรายการถี่เกินไป กรุณาลองใหม่อีกครั้ง",
    },
  },
  {
    pattern: /network error|failed to fetch|network request failed|ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้/i,
    messages: {
      en: "Unable to reach the server. Please check your connection and try again.",
      th: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
    },
  },
  {
    pattern: /invalid credentials|incorrect password|อีเมลหรือรหัสผ่านไม่ถูกต้อง/i,
    messages: {
      en: "Email or password is incorrect.",
      th: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    },
  },
  {
    pattern: /invalid two-factor authentication code/i,
    messages: {
      en: "Secure verification failed. Please try again.",
      th: "ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่",
    },
  },
  {
    pattern: /organization sso|admin account must continue with organization sso/i,
    messages: {
      en: "Please continue with Organization SSO.",
      th: "บัญชีผู้ดูแลต้องเข้าสู่ระบบผ่าน Organization SSO",
    },
  },
];

const TRANSLATED_CODE_MESSAGES: Record<
  string,
  Record<ApiLanguage, string>
> = {
  account_locked: {
    en: "Your account is temporarily locked. Please try again later.",
    th: "บัญชีถูกล็อกชั่วคราวจากการพยายามเข้าสู่ระบบผิดหลายครั้ง กรุณาลองใหม่ภายหลัง",
  },
  invalid_credentials: {
    en: "Email or password is incorrect.",
    th: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  },
  mfa_required: {
    en: "Secure verification is required.",
    th: "ต้องยืนยันตัวตนอีกครั้งก่อนดำเนินการต่อ",
  },
  mfa_verification_failed: {
    en: "Secure verification failed.",
    th: "ยืนยันตัวตนไม่สำเร็จ",
  },
  token_expired: {
    en: "Session expired. Please sign in again.",
    th: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  },
  rate_limited: {
    en: "Too many requests. Please try again later.",
    th: "คุณทำรายการถี่เกินไป กรุณาลองใหม่อีกครั้ง",
  },
};

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
    codes: ["account_locked"],
    messages: {
      en: "Your account is temporarily locked. Please try again later.",
      th: "บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง",
    },
  },
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
    codes: ["mfa_verification_failed"],
    patterns: [/invalid two-factor authentication code|invalid two-factor code/i],
    messages: {
      en: "Secure verification failed. Please try again.",
      th: "ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่",
    },
  },
  {
    contexts: ["login", "step-up"],
    codes: ["mfa_required"],
    messages: {
      en: "Secure verification is required.",
      th: "ต้องยืนยันตัวตนอีกครั้งก่อนดำเนินการต่อ",
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
    codes: ["token_expired"],
    patterns: [/invalid or expired reset token|invalid or expired token/i],
    messages: {
      en: "This reset link is invalid or has expired.",
      th: "ลิงก์รีเซ็ตนี้ไม่ถูกต้องหรือหมดอายุแล้ว",
    },
  },
  {
    contexts: ["forgot-password", "reset-password"],
    codes: ["rate_limited"],
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
const CACHE_TTL_MS = 30_000;
export const TOKEN_REFRESH_TIMEOUT_MS = 10_000;
const requestCache = new Map<string, { promise: Promise<RawFetchResult<unknown>>; timestamp: number }>();

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

function resolveApiLanguage(language?: ApiLanguage): ApiLanguage {
  if (language) return language;

  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
    if (saved) {
      return resolveAppLanguage(saved, window.navigator.language);
    }

    try {
      return resolveAppLanguage(
        useLanguageStore.getState().language,
        document.documentElement.lang
      );
    } catch {
      return resolveAppLanguage(
        document.documentElement.lang,
        window.navigator.language
      );
    }
  }

  return "th";
}

function translateKnownCode(
  code: string | undefined,
  language: ApiLanguage
): string | null {
  if (!code) return null;
  return TRANSLATED_CODE_MESSAGES[code.toLowerCase()]?.[language] ?? null;
}

function statusFallbackMessage(
  status: number | undefined,
  language: ApiLanguage,
  fallback: string
): string {
  if (language === "en") {
    if (status === 0) return "Unable to reach the server. Please check your connection and try again.";
    if (status === 400) return "The request is invalid. Please review the data and try again.";
    if (status === 401) return "Session expired. Please sign in again.";
    if (status === 403) return "Access denied";
    if (status === 404) return "The requested record was not found.";
    if (status === 409) return "The request conflicts with the current state. Please refresh and try again.";
    if (status === 422) return "The submitted data is invalid. Please review it and try again.";
    if (status === 423) return "Your account is temporarily locked. Please try again later.";
    if (status === 429) return "Too many requests. Please try again later.";
    if (typeof status === "number" && status >= 500) return "The server is temporarily unavailable. Please try again.";
    return fallback;
  }

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

function translateKnownMessage(
  message: string,
  language: ApiLanguage
): string | null {
  const normalized = message.trim();
  if (!normalized) return null;

  for (const rule of TRANSLATED_MESSAGE_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.messages[language];
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
  fallback?: string,
  language?: ApiLanguage,
): string {
  const resolvedLanguage = resolveApiLanguage(language);
  const defaultFallback =
    fallback ??
    (resolvedLanguage === "en"
      ? DEFAULT_ERROR_MESSAGE_EN
      : DEFAULT_ERROR_MESSAGE_TH);
  const sanitized = sanitizeMessage(rawMessage);
  if (sanitized) {
    const translated = translateKnownMessage(sanitized, resolvedLanguage);
    if (translated) return translated;
    if (resolvedLanguage === "en" && THAI_CHARACTER_PATTERN.test(sanitized)) {
      return statusFallbackMessage(status, resolvedLanguage, defaultFallback);
    }
    return sanitized;
  }
  return statusFallbackMessage(status, resolvedLanguage, defaultFallback);
}

export function getErrorMessage(
  error: unknown,
  fallback?: string,
  language?: ApiLanguage
): string {
  const resolvedLanguage = resolveApiLanguage(language);
  const defaultFallback =
    fallback ??
    (resolvedLanguage === "en"
      ? DEFAULT_ERROR_MESSAGE_EN
      : DEFAULT_ERROR_MESSAGE_TH);

  if (error instanceof Error) {
    const apiError = error as ApiError;
    const translatedCode = translateKnownCode(
      apiError.code || extractApiErrorCode(apiError.detail),
      resolvedLanguage
    );
    if (translatedCode) return translatedCode;
    return toUserFacingMessage(
      apiError.status,
      apiError.message,
      defaultFallback,
      resolvedLanguage
    );
  }
  if (typeof error === "string") {
    return toUserFacingMessage(
      undefined,
      error,
      defaultFallback,
      resolvedLanguage
    );
  }
  return defaultFallback;
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

function readCookieValue(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }

  return null;
}

export async function rawFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<RawFetchResult<T>> {
  const url = `${API_BASE_URL}${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  const bodyIsFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(bodyIsFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> || {}),
  };

  if (typeof window === "undefined" && token && isProbablyJwt(token)) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (typeof window !== "undefined" && !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const hasCsrfHeader = Object.keys(headers).some(
      (headerName) => headerName.toLowerCase() === "x-csrf-token",
    );
    if (!hasCsrfHeader) {
      const csrfToken = readCookieValue("csrf_token");
      if (csrfToken) {
        headers["X-CSRF-Token"] = csrfToken;
      }
    }
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
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("json");
  const hasBody = isJson || (contentLength !== "0" && contentLength !== null);

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

function getCacheKey(path: string, options: RequestInit = {}, token?: string): string {
  const method = (options.method ?? "GET").toUpperCase();
  const body = typeof options.body === "string" ? options.body : "";
  const authScope = token ?? "";
  return `${method}:${path}:${body}:${authScope}`;
}

async function cachedFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<RawFetchResult<T>> {
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return rawFetch<T>(path, options, token);
  }

  const key = getCacheKey(path, options, token);
  const cached = requestCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.promise as Promise<RawFetchResult<T>>;
  }

  const promise = rawFetch<T>(path, options, token).then((result) => {
    if (!result.ok) {
      requestCache.delete(key);
    }
    return result;
  });

  requestCache.set(key, {
    promise: promise as Promise<RawFetchResult<unknown>>,
    timestamp: Date.now(),
  });

  setTimeout(() => {
    const active = requestCache.get(key);
    if (active?.promise === (promise as Promise<RawFetchResult<unknown>>)) {
      requestCache.delete(key);
    }
  }, CACHE_TTL_MS + 1_000);

  return promise;
}

export function invalidateCache(urlPattern: string): void {
  for (const [key] of requestCache.entries()) {
    if (key.includes(urlPattern)) {
      requestCache.delete(key);
    }
  }
}

export function invalidateAllCache(): void {
  requestCache.clear();
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}, token?: string): Promise<T> {
  const { skipCache = false, ...requestOptions } = options;
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
    if (refreshed !== null) {
      activeToken = refreshed;
    }
  }

  const requestFn = skipCache ? rawFetch<T> : cachedFetch<T>;
  const result = await requestFn(path, requestOptions, activeToken);

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
    if (newToken !== null) {
      const retry = await requestFn(path, requestOptions, newToken);
      if (retry.ok) return retry.data as T;
      throw retry.error || result.error!;
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
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? globalThis.setTimeout(() => controller.abort(), TOKEN_REFRESH_TIMEOUT_MS)
      : null;

    try {
      const res = await rawFetch<LoginResponse>(
        "/auth/refresh",
        { method: "POST", signal: controller?.signal },
        currentToken
      );
      if (res.ok && res.data?.user) {
        if (typeof window !== "undefined") {
          try {
            const { useAuthStore } = await import("@/store/auth-store");
            useAuthStore.getState().setSession(res.data);
          } catch {
            // ignore store failures
          }
        }
        return "__cookie_session__";
      }
      return null;
    } catch {
      return null;
    } finally {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
