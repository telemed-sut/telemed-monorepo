/**
 * Simple translation helper for EN/TH bilingual strings.
 * Returns the Thai string if locale is "th", otherwise English.
 */
export function t(locale: string, en: string, th: string): string {
  return locale === "th" ? th : en;
}
