import type {
  AppearanceDensity,
  AppearanceSettings,
  AppearanceTheme,
} from "@/lib/appearance";
import { formatCompactDuration } from "@/lib/secure-session";

import type { SettingsLanguage } from "./settings-types";

export const SETTINGS_VALIDATION_TOAST_IDS = {
  verify2FA: "settings-verify-2fa-required",
  verify2FAInvalid: "settings-verify-2fa-invalid",
  reset2FA: "settings-reset-2fa-required",
  disable2FA: "settings-disable-2fa-required",
  resolveUser: "settings-resolve-user-required",
  emergencyReason: "settings-emergency-reason-required",
  adminInviteEmail: "settings-admin-invite-email-required",
  adminInviteReason: "settings-admin-invite-reason-required",
} as const;

export function tr(language: SettingsLanguage, en: string, th: string) {
  return language === "th" ? th : en;
}

export function isInvalidTwoFactorCodeError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as {
    detail?: unknown;
    message?: unknown;
  };
  if (
    record.detail &&
    typeof record.detail === "object" &&
    "code" in record.detail &&
    (record.detail as { code?: unknown }).code === "invalid_two_factor_code"
  ) {
    return true;
  }

  return (
    typeof record.message === "string" &&
    /invalid two-factor authentication code/i.test(record.message)
  );
}

export function extractSetupKey(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const parsed = new URL(uri);
    return parsed.searchParams.get("secret");
  } catch {
    return null;
  }
}

export function formatDateTime(
  value: string | null | undefined,
  language: SettingsLanguage,
): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "th" ? "th-TH" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTimeUntil(
  value: string | null | undefined,
  language: SettingsLanguage,
): string {
  if (!value) return "-";
  const expiresAt = new Date(value).getTime();
  if (Number.isNaN(expiresAt)) return "-";
  const remainingSeconds = Math.max(
    Math.floor((expiresAt - Date.now()) / 1000),
    0,
  );
  if (remainingSeconds <= 0) {
    return tr(language, "Expired", "หมดอายุแล้ว");
  }
  return language === "th"
    ? `อีก ${formatCompactDuration(remainingSeconds, language)}`
    : `${formatCompactDuration(remainingSeconds, language)} left`;
}

export function isSettingsPanelId(value: string | null): value is import("./settings-types").SettingsPanelId {
  return (
    value === "general" ||
    value === "account" ||
    value === "security" ||
    value === "admin"
  );
}

export function getAppearanceThemeCopy(language: SettingsLanguage): Record<
  AppearanceTheme,
  { title: string; description: string }
> {
  return {
    clinical: {
      title: tr(language, "Clinical", "Clinical"),
      description: tr(
        language,
        "Clean blue-led daily dashboard",
        "แดชบอร์ดฟ้าใสสำหรับใช้งานทุกวัน",
      ),
    },
    sky: {
      title: tr(language, "Sky", "Sky"),
      description: tr(
        language,
        "Light aqua blue with a fresher mood",
        "ฟ้าอมเขียวเบาๆ ดูสดและสบายขึ้น",
      ),
    },
    warm: {
      title: tr(language, "Warm", "Warm"),
      description: tr(
        language,
        "Soft warm-paper surfaces",
        "โทนอุ่นแบบกระดาษอ่อน ช่วยให้หน้าจอนุ่มลง",
      ),
    },
    calm: {
      title: tr(language, "Calm", "Calm"),
      description: tr(
        language,
        "Muted green for a quieter workspace",
        "โทนเขียวสงบ ลดความแข็งของหน้าจอทำงาน",
      ),
    },
    mint: {
      title: tr(language, "Mint", "Mint"),
      description: tr(
        language,
        "Fresh mint with a softer clinical feel",
        "เขียวมิ้นต์สดเบาๆ ดูสะอาดแต่ไม่แข็งเกินไป",
      ),
    },
    lavender: {
      title: tr(language, "Lavender", "Lavender"),
      description: tr(
        language,
        "Soft violet with a calmer premium tone",
        "ม่วงลาเวนเดอร์อ่อน ให้ความรู้สึกนุ่มและพรีเมียม",
      ),
    },
  };
}

export function getAppearanceDensityCopy(language: SettingsLanguage): Record<
  AppearanceDensity,
  { title: string; description: string }
> {
  return {
    comfortable: {
      title: tr(language, "Comfortable", "ปกติ"),
      description: tr(
        language,
        "More breathing room",
        "เว้นระยะมากขึ้น อ่านสบายตา",
      ),
    },
    compact: {
      title: tr(language, "Compact", "กระชับ"),
      description: tr(
        language,
        "Denser admin layout",
        "แน่นขึ้นเล็กน้อย เหมาะกับงานข้อมูลเยอะ",
      ),
    },
  };
}

export function getAppearanceSummary(
  language: SettingsLanguage,
  appearance: AppearanceSettings,
): string {
  const themeCopy = getAppearanceThemeCopy(language);
  const densityCopy = getAppearanceDensityCopy(language);
  return `${themeCopy[appearance.theme].title} • ${densityCopy[appearance.density].title}`;
}
