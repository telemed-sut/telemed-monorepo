import en from "@/messages/en.json";
import th from "@/messages/th.json";
import type { AppLanguage } from "@/store/language-config";

type IntlMessageObject = Record<string, unknown>;

export const APP_INTL_MESSAGES: Record<AppLanguage, IntlMessageObject> = {
  en,
  th,
};

export function getIntlMessages(language: AppLanguage): IntlMessageObject {
  return APP_INTL_MESSAGES[language] ?? APP_INTL_MESSAGES.en;
}
