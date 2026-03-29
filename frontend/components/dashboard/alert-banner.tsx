"use client";

import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

import { useOverviewStats } from "@/components/dashboard/overview-stats-context";

const I18N: Record<
  AppLanguage,
  {
    youHave: string;
    appointmentsToday: (count: number) => string;
    and: string;
    totalScheduled: string;
    consultations: string;
  }
> = {
  en: {
    youHave: "You have",
    appointmentsToday: (count) =>
      `${count} Appointment${count !== 1 ? "s" : ""} Today,`,
    and: "and",
    totalScheduled: "Total Scheduled",
    consultations: "consultations.",
  },
  th: {
    youHave: "วันนี้คุณมี",
    appointmentsToday: (count) => `${count} นัดหมาย`,
    and: "และมี",
    totalScheduled: "นัดหมายทั้งหมด",
    consultations: "",
  },
};

export function AlertBanner() {
  const language = useLanguageStore((state) => state.language);
  const t = I18N[language];
  const { stats } = useOverviewStats();
  const todayCount = stats?.kpis.today_consultations ?? 0;
  const pendingCount = stats?.totals.meetings ?? 0;

  return (
    <div className="flex items-start gap-3 sm:items-center">
      <span className="text-3xl">🩺</span>
      <p className="text-sm leading-relaxed sm:text-[0.95rem]">
        <span className="text-muted-foreground">{t.youHave} </span>
        <span className="font-semibold">{t.appointmentsToday(todayCount)}</span>
        <span> {t.and} </span>
        <span className="font-semibold">{pendingCount} {t.totalScheduled}</span>
        <span className="text-muted-foreground"> {t.consultations}</span>
      </p>
    </div>
  );
}
