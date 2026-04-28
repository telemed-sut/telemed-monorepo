import { getErrorMessage } from "@/lib/api";
import type { AppLanguage } from "@/store/language-config";

const THAI_CHARACTER_PATTERN = /[\u0E00-\u0E7F]/;
const ACCESS_DENIED_PATTERN =
  /access denied|permission denied|forbidden|คุณไม่มีสิทธิ์|ยังไม่ได้รับมอบหมาย/i;
const NETWORK_ERROR_PATTERN =
  /network error|network request failed|failed to fetch|ไม่สามารถเชื่อมต่อ|เครือข่าย/i;
const SESSION_EXPIRED_PATTERN = /session expired|หมดอายุการเข้าสู่ระบบ/i;

function tr(language: AppLanguage, en: string, th: string) {
  return language === "th" ? th : en;
}

function getErrorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;
}

function getRawErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

export function getLocalizedDashboardErrorMessage(
  error: unknown,
  language: AppLanguage,
  fallbackEn: string,
  fallbackTh: string
) {
  const status = getErrorStatus(error);
  const rawMessage = getRawErrorMessage(error);

  if (language === "th") {
    return getErrorMessage(error, fallbackTh, language);
  }

  if (status === 403 || ACCESS_DENIED_PATTERN.test(rawMessage)) {
    return tr(language, "Access denied", "คุณไม่มีสิทธิ์ทำรายการนี้");
  }

  if (NETWORK_ERROR_PATTERN.test(rawMessage)) {
    return tr(language, "Network request failed", "การเชื่อมต่อเครือข่ายล้มเหลว");
  }

  if (SESSION_EXPIRED_PATTERN.test(rawMessage)) {
    return tr(language, "Session expired", "เซสชันหมดอายุ");
  }

  if (status === 404 || !rawMessage || THAI_CHARACTER_PATTERN.test(rawMessage)) {
    return fallbackEn;
  }

  return rawMessage;
}
