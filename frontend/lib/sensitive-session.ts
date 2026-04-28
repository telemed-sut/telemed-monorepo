import { getErrorMessage, type ApiError } from "@/lib/api";

const RECENT_SENSITIVE_SESSION_PATTERN = /recent multi-factor verification required/i;

export function isRecentSensitiveSessionError(error: unknown): boolean {
  if (error instanceof Error) {
    const apiError = error as ApiError;
    if (typeof apiError.detail === "string" && RECENT_SENSITIVE_SESSION_PATTERN.test(apiError.detail)) {
      return true;
    }
    if (apiError.message && RECENT_SENSITIVE_SESSION_PATTERN.test(apiError.message)) {
      return true;
    }
  }

  return RECENT_SENSITIVE_SESSION_PATTERN.test(getErrorMessage(error, ""));
}
