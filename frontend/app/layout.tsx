import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AuthInitializer } from "@/components/auth-initializer";
import { LanguageInitializer } from "@/components/language-initializer";
import { ProgressBarClient } from "@/components/progress-bar-client";
import { TranslationSafeguard } from "@/components/translation-safeguard";
import { I18nProvider } from "@/components/i18n-provider";
import { AppearanceInitializer } from "@/components/appearance-initializer";

export const metadata: Metadata = {
  title: "E Med Help SUT — Telemedicine Dashboard",
  description: "ระบบจัดการผู้ป่วยและนัดหมายแพทย์ทางไกล — E Med Help SUT",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
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
            {children}
            <Toaster />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
