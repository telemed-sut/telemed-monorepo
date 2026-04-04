"use client";

import Link from "next/link";
import { ShieldCheck, UsersRound, CalendarDays } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { AlertBanner } from "./alert-banner";
import { StatsCards } from "./stats-cards";
import { useDashboardStore } from "@/store/dashboard-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";
import { cn } from "@/lib/utils";

import { OverviewStatsProvider } from "@/components/dashboard/overview-stats-context";
import { FinancialFlowChart } from "./financial-flow-chart";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

function OverviewPrivacyCard() {
  const language = useLanguageStore((state) => state.language);

  return (
    <Card className="overflow-hidden border-border/70 bg-background/95 shadow-none">
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-200/70 bg-emerald-50 text-emerald-700">
            <ShieldCheck className="size-5" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-[1rem] leading-normal">
              {tr(
                language,
                "Protected Home Screen",
                "หน้าหลักแบบปกป้องข้อมูล",
              )}
            </CardTitle>
            <CardDescription className="max-w-2xl text-sm leading-6">
              {tr(
                language,
                "Patient contact details, registration codes, and care-team actions now stay inside dedicated workspaces instead of appearing on the home screen.",
                "ข้อมูลติดต่อผู้ป่วย รหัสลงทะเบียน และคำสั่งดูแลทีม จะถูกเก็บไว้ในหน้าทำงานเฉพาะแทนการแสดงบนหน้าหลัก",
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium text-foreground">
              {tr(language, "Patient details", "ข้อมูลผู้ป่วย")}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {tr(
                language,
                "Names, contact info, and addresses stay in the Patients directory.",
                "ชื่อ ข้อมูลติดต่อ และที่อยู่ จะอยู่ในหน้าผู้ป่วยเท่านั้น",
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium text-foreground">
              {tr(language, "Registration codes", "รหัสลงทะเบียน")}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {tr(
                language,
                "Sensitive app onboarding codes only appear when you open a patient record intentionally.",
                "รหัสสำหรับลงทะเบียนแอปจะแสดงเมื่อเปิดระเบียนผู้ป่วยโดยตั้งใจเท่านั้น",
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium text-foreground">
              {tr(language, "Care-team actions", "การจัดการทีมดูแล")}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {tr(
                language,
                "Assignment and workspace actions are moved out of the shared landing page.",
                "การมอบหมายและคำสั่งทำงานถูกย้ายออกจากหน้าหลักที่มองเห็นร่วมกัน",
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/patients"
            className={cn(buttonVariants(), "gap-1.5")}
          >
              <UsersRound className="size-4" />
              {tr(language, "Open Patients", "เปิดหน้าผู้ป่วย")}
          </Link>
          <Link
            href="/meetings"
            className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
          >
              <CalendarDays className="size-4" />
              {tr(language, "Open Meetings", "เปิดหน้าการนัดหมาย")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewContent() {
  const showAlertBanner = useDashboardStore((s) => s.showAlertBanner);
  const showStatsCards = useDashboardStore((s) => s.showStatsCards);
  const showChart = useDashboardStore((s) => s.showChart);
  const showTable = useDashboardStore((s) => s.showTable);

  return (
    <OverviewStatsProvider>
      <main className="flex-1 space-y-5 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
        {showAlertBanner && <AlertBanner />}
        {showStatsCards && <StatsCards />}
        {showChart && <FinancialFlowChart />}
        {showTable && <OverviewPrivacyCard />}
      </main>
    </OverviewStatsProvider>
  );
}
