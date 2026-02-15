import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AuthInitializer } from "@/components/auth-initializer";
import { ProgressBar } from "@/components/progress-bar";
import { TranslationSafeguard } from "@/components/translation-safeguard";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <ProgressBar />
          <TranslationSafeguard />
          <AuthInitializer />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
