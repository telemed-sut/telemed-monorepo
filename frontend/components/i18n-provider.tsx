"use client";

import { NextIntlClientProvider } from "next-intl";

import { getIntlMessages } from "@/lib/i18n/messages";
import { useLanguageStore } from "@/store/language-store";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const language = useLanguageStore((state) => state.language);

  return (
    <NextIntlClientProvider
      locale={language}
      messages={getIntlMessages(language)}
    >
      {children}
    </NextIntlClientProvider>
  );
}
