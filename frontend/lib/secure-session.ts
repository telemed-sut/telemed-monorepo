import type { AppLanguage } from "@/store/language-config";

export const SECURE_SESSION_WINDOW_SECONDS = 4 * 60 * 60;

interface SecureSessionState {
  known: boolean;
  active: boolean;
  remainingSeconds: number;
}

export function getSecureSessionState(
  mfaAuthenticatedAt: string | null | undefined,
  maxAgeSeconds = SECURE_SESSION_WINDOW_SECONDS,
  nowMs = Date.now(),
): SecureSessionState {
  if (!mfaAuthenticatedAt) {
    return { known: false, active: false, remainingSeconds: 0 };
  }

  const authenticatedAtMs = new Date(mfaAuthenticatedAt).getTime();
  if (Number.isNaN(authenticatedAtMs)) {
    return { known: false, active: false, remainingSeconds: 0 };
  }

  const remainingSeconds = Math.max(
    Math.floor((authenticatedAtMs + maxAgeSeconds * 1000 - nowMs) / 1000),
    0,
  );

  return {
    known: true,
    active: remainingSeconds > 0,
    remainingSeconds,
  };
}

export function formatCompactDuration(
  totalSeconds: number,
  language: AppLanguage,
): string {
  const normalized = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(normalized / 86_400);
  const hours = Math.floor((normalized % 86_400) / 3_600);
  const minutes = Math.floor((normalized % 3_600) / 60);
  const seconds = normalized % 60;

  if (days > 0) {
    return language === "th"
      ? `${days}วัน ${hours}ชม.`
      : `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return language === "th"
      ? `${hours}ชม. ${minutes}น.`
      : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return language === "th" ? `${minutes}น.` : `${minutes}m`;
  }
  return language === "th" ? `${seconds}วิ` : `${seconds}s`;
}
