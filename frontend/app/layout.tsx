import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthInitializer } from "@/components/auth-initializer";
import { LanguageInitializer } from "@/components/language-initializer";
import { ProgressBarClient } from "@/components/progress-bar-client";
import { TranslationSafeguard } from "@/components/translation-safeguard";
import { I18nProvider } from "@/components/i18n-provider";
import { AppearanceInitializer } from "@/components/appearance-initializer";
import { AgentationClient } from "@/components/agentation-client";
import { ToasterClient } from "@/components/toaster-client";
import { APP_LANGUAGE_COOKIE_KEY, resolveAppLanguage } from "@/store/language-config";

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
  fallback: ["Segoe UI", "Noto Sans", "Helvetica Neue", "Arial", "sans-serif"],
});

const metadataBase = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
);

export const metadata: Metadata = {
  metadataBase,
  title: "E Med Help SUT — Telemedicine Dashboard",
  description: "ระบบจัดการผู้ป่วยและนัดหมายแพทย์ทางไกล — E Med Help SUT",
  openGraph: {
    title: "E Med Help SUT — Telemedicine Dashboard",
    description: "ระบบจัดการผู้ป่วยและนัดหมายแพทย์ทางไกล — E Med Help SUT",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "E Med Help SUT dashboard preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "E Med Help SUT — Telemedicine Dashboard",
    description: "ระบบจัดการผู้ป่วยและนัดหมายแพทย์ทางไกล — E Med Help SUT",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/brand-icon.ico" },
    ],
    shortcut: ["/favicon.ico"],
    apple: ["/favicon.ico"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const nonce = headerList.get("x-nonce") ?? undefined;
  const cookieStore = await cookies();
  const detectedLang = resolveAppLanguage(
    cookieStore.get(APP_LANGUAGE_COOKIE_KEY)?.value
  );

  return (
    <html lang={detectedLang} suppressHydrationWarning>
      <body
        className={`${notoSansThai.variable} font-sans antialiased bg-background`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
          nonce={nonce}
        >
          <I18nProvider>
            <AppearanceInitializer />
            <ProgressBarClient />
            <TranslationSafeguard />
            <AuthInitializer />
            <LanguageInitializer />
            <AgentationClient />
            {children}
            <ToasterClient />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
