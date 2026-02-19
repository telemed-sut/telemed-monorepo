export type AppLanguage = "th" | "en";

export const APP_LANGUAGE_STORAGE_KEY = "app_language";

export const APP_LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: "th", label: "ไทย" },
  { value: "en", label: "English" },
];

export const APP_LOCALE_MAP: Record<AppLanguage, string> = {
  th: "th-TH",
  en: "en-US",
};

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return value === "th" || value === "en";
}

export function detectDefaultLanguage(localeInput?: string): AppLanguage {
  const locale = (localeInput || "").toLowerCase();
  if (locale.startsWith("th")) return "th";
  return "en";
}

export function applyDocumentLanguage(language: AppLanguage): void {
  if (typeof document === "undefined") return;
  const locale = APP_LOCALE_MAP[language];
  document.documentElement.lang = locale.split("-")[0] || "en";
}
