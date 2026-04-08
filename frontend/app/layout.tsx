import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AuthInitializer } from "@/components/auth-initializer";
import { LanguageInitializer } from "@/components/language-initializer";
import { ProgressBarClient } from "@/components/progress-bar-client";
import { TranslationSafeguard } from "@/components/translation-safeguard";
import { I18nProvider } from "@/components/i18n-provider";
import { AppearanceInitializer } from "@/components/appearance-initializer";
import { AgentationClient } from "@/components/agentation-client";
import { APP_LANGUAGE_COOKIE_KEY, resolveAppLanguage } from "@/store/language-config";

export const metadata: Metadata = {
  title: "E Med Help SUT — Telemedicine Dashboard",
  description: "ระบบจัดการผู้ป่วยและนัดหมายแพทย์ทางไกล — E Med Help SUT",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const detectedLang = resolveAppLanguage(
    cookieStore.get(APP_LANGUAGE_COOKIE_KEY)?.value
  );

  return (
    <html lang={detectedLang} suppressHydrationWarning>
      <body className="font-sans antialiased bg-background" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <I18nProvider>
            <AppearanceInitializer />
            <ProgressBarClient />
            <TranslationSafeguard />
            <AuthInitializer />
            <LanguageInitializer />
            <AgentationClient />
            {children}
            <Toaster />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
